import {
  OrderStatus,
  PaymentMethod,
  ProductPaymentStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  lockAndValidateCouponInTx,
  recordCouponUsageInTx,
  releaseCouponUsageForOrder,
  validateCoupon,
} from "@/lib/orders/coupons";
import { computeDeliveryFee, getDeliverySettings } from "@/lib/orders/delivery-fee";
import { releaseReservedStock, reserveStock } from "@/lib/inventory/stock";
import { generateOrderNumber, toNumber } from "@/lib/utils";
import { collectCartIssues, lineStockNote, minimumOrderStatus } from "@/lib/orders/cart-summary";
import { MSG, normalizePkMobile } from "@/lib/validators/pk";
import { writeAuditLog } from "@/lib/audit";
import {
  STRIPE_MIN_AMOUNT_PKR,
  onlineAmountFor,
  stripeMinimumMessage,
} from "@/lib/payments/card-minimum";
import {
  buildJazzCashPaymentForm,
  generateTxnRefNo,
  isJazzCashConfigured,
} from "@/lib/payments/jazzcash";
import {
  createStripePaymentIntent,
  isStripeConfigured,
} from "@/lib/payments/stripe";
import {
  getJazzCashQrPublicConfig,
  getJazzCashTillId,
  isJazzCashQrEnabled,
} from "@/lib/payments/jazzcash-qr";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { resolveFullCodChoice } from "@/lib/orders/full-cod";
import { getFullCodMaxOrderAmount } from "@/lib/orders/full-cod-settings";
import { getAcceptedRequestForCheckout, linkRequestToOrder } from "@/lib/orders/bidding";
import { recordOrderConfirmedLedger } from "@/lib/finance/ledger";

export type CheckoutErrorCode =
  | "EMPTY_CART"
  | "CART_ISSUES"
  | "CART_CHANGED"
  | "MIN_ORDER"
  | "COUPON"
  | "CARD_MINIMUM"
  | "PAYMENT_START_FAILED"
  | "FULL_COD"
  | "NO_RIDER"
  | "VALIDATION";

/** Checkout failure with a machine-readable code (the route returns it to the UI). */
export class CheckoutError extends Error {
  code: CheckoutErrorCode;
  fieldErrors?: Record<string, string>;
  constructor(message: string, code: CheckoutErrorCode, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "CheckoutError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Payment could not be started for a just-created order: cancel it, release the
 * reserved stock and the coupon use, cancel the started payment rows and put the
 * products back into the customer's cart. No-op unless the order is still unpaid
 * PENDING_PAYMENT.
 */
async function rollbackUnstartedCheckout(orderId: string, userId: string, reason: string) {
  const done = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, payments: { where: { status: "SUCCESS" }, select: { id: true } } },
    });
    if (!order || order.orderStatus !== OrderStatus.PENDING_PAYMENT || order.payments.length > 0) {
      return null;
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        orderStatus: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: `Payment could not be started: ${reason}`.slice(0, 500),
      },
    });
    await tx.storeFulfillment.updateMany({
      where: { orderId },
      data: { status: OrderStatus.CANCELLED },
    });
    for (const item of order.items) {
      if (!item.productId) continue;
      await releaseReservedStock(tx, {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        orderId,
        createdById: userId,
      });
    }
    await releaseCouponUsageForOrder(tx, orderId);
    await tx.payment.updateMany({
      where: { orderId, status: { in: ["PENDING", "INITIATED", "PROCESSING"] } },
      data: { status: "CANCELLED" },
    });
    await tx.paymentTransaction.updateMany({
      where: { orderId, status: { in: ["PENDING", "INITIATED", "PROCESSING"] } },
      data: { status: "CANCELLED" },
    });

    // Put the products back in the cart
    const cart = await tx.cart.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    for (const item of order.items) {
      if (!item.productId) continue;
      const existing = await tx.cartItem.findFirst({
        where: { cartId: cart.id, productId: item.productId, variantId: item.variantId || null },
      });
      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { quantity: Math.max(existing.quantity, item.quantity) },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            productId: item.productId,
            variantId: item.variantId || null,
            quantity: item.quantity,
          },
        });
      }
    }
    return order.orderNumber;
  });

  if (done) {
    await writeAuditLog({
      userId,
      action: "CHECKOUT_PAYMENT_START_FAILED",
      entity: "Order",
      entityId: orderId,
      newValue: { orderNumber: done, reason },
    }).catch(() => {});
  }
}

export type JazzCashQrCheckout = {
  amountPkr: number;
  tillId: string;
  merchantName: string;
  qrImageUrl: string;
  ussdHint: string;
  orderId: string;
  orderNumber: string;
};

export type ProductPaymentChoice =
  | "ONLINE"
  | "STRIPE"
  | "JAZZCASH"
  | "CASH_ON_DELIVERY"
  /** Products + delivery fee in cash to the rider (small orders only) */
  | "FULL_COD";

function wantsOnlineProducts(choice: ProductPaymentChoice): boolean {
  return choice === "ONLINE" || choice === "STRIPE" || choice === "JAZZCASH";
}

function pendingOnlineAmount(order: {
  deliveryFee: unknown;
  subtotal: unknown;
  discount: unknown;
  grandTotal: unknown;
  deliveryFeePaymentStatus: string;
  productPaymentStatus: string;
}): number {
  const feePending = ["PENDING", "INITIATED", "FAILED"].includes(
    order.deliveryFeePaymentStatus
  );
  const productPending =
    order.productPaymentStatus === "PENDING" ||
    order.productPaymentStatus === "FAILED";
  const deliveryFee = Number(order.deliveryFee);
  const productTotal = Math.max(
    0,
    Number(order.subtotal) - Number(order.discount)
  );
  if (feePending && productPending) return Number(order.grandTotal);
  if (feePending) return deliveryFee;
  if (productPending) return productTotal;
  return 0;
}

function buildJazzCashQrCheckoutPayload(order: {
  id: string;
  orderNumber: string;
  deliveryFee: unknown;
  subtotal: unknown;
  discount: unknown;
  grandTotal: unknown;
  deliveryFeePaymentStatus: string;
  productPaymentStatus: string;
}): JazzCashQrCheckout {
  const cfg = getJazzCashQrPublicConfig();
  if (!cfg.enabled) {
    throw new Error("JazzCash QR payment is not available");
  }
  return {
    amountPkr: pendingOnlineAmount(order),
    tillId: cfg.tillId,
    merchantName: cfg.merchantName,
    qrImageUrl: cfg.qrImageUrl,
    ussdHint: cfg.ussdHint,
    orderId: order.id,
    orderNumber: order.orderNumber,
  };
}

export type CheckoutAddress = {
  label?: string;
  fullName: string;
  phone: string;
  houseBuilding: string;
  street?: string;
  area: string;
  city: string;
  province: string;
  postalCode?: string;
  nearbyLandmark?: string;
  deliveryInstructions?: string;
  latitude?: number | null;
  longitude?: number | null;
};

export type CheckoutInput = {
  userId: string;
  addressId?: string;
  address?: CheckoutAddress;
  couponCode?: string;
  productPaymentChoice: ProductPaymentChoice;
  /** Prefer Stripe card or JazzCash Till/QR receipt flow */
  onlineProvider?: "STRIPE" | "JAZZCASH_QR";
  notes?: string;
  idempotencyKey: string;
};

function effectivePrice(price: Prisma.Decimal, salePrice: Prisma.Decimal | null) {
  const p = toNumber(price);
  const s = salePrice != null ? toNumber(salePrice) : null;
  return s != null && s < p ? s : p;
}

export async function recalculateCart(userId: string) {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: {
      items: {
        include: {
          product: {
            include: {
              images: { orderBy: { sortOrder: "asc" }, take: 1 },
              // Only what checkout needs — this object is returned to the customer
              // via /api/cart, so never include payout/identity fields.
              store: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  latitude: true,
                  longitude: true,
                  city: true,
                  addressLine: true,
                },
              },
            },
          },
          variant: true,
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    return {
      cart: null,
      items: [],
      subtotal: 0,
      priceChanges: [] as string[],
      stockIssues: [] as string[],
      stores: [] as {
        storeId: string;
        name: string;
        latitude: number | null;
        longitude: number | null;
        city: string;
        addressLine: string;
      }[],
      allProductsFreeDelivery: false,
    };
  }

  const priceChanges: string[] = [];
  let subtotal = 0;
  const storeMap = new Map<
    string,
    {
      storeId: string;
      name: string;
      latitude: number | null;
      longitude: number | null;
      city: string;
      addressLine: string;
    }
  >();

  const items = cart.items.map((item) => {
    const product = item.product;
    const variant = item.variant;
    const store = product.store;
    const storeOpen = store.status === "APPROVED";

    storeMap.set(store.id, {
      storeId: store.id,
      name: store.name,
      latitude: store.latitude,
      longitude: store.longitude,
      city: store.city,
      addressLine: store.addressLine,
    });

    const unitPrice = variant
      ? effectivePrice(variant.price, variant.salePrice)
      : effectivePrice(product.price, product.salePrice);
    const available = Math.max(
      0,
      variant
        ? variant.stockQuantity - variant.reservedStock
        : product.stockQuantity - product.reservedStock
    );
    const productActive =
      product.status === "ACTIVE" && (!variant || variant.isActive !== false);

    subtotal += unitPrice * item.quantity;

    const line = {
      id: item.id,
      productId: product.id,
      storeId: store.id,
      storeName: store.name,
      variantId: variant?.id || null,
      name: product.name,
      variantName: variant?.name || null,
      sku: variant?.sku || product.sku,
      unit: variant?.unit || product.unit,
      quantity: item.quantity,
      unitPrice,
      lineTotal: unitPrice * item.quantity,
      available,
      imageUrl: product.images[0]?.url || null,
      isOrganic: product.isOrganic,
      freeDelivery: Boolean(product.freeDelivery),
      storeOpen,
      productActive,
    };
    return { ...line, stockNote: lineStockNote(line) };
  });

  // One message per closed store (EDGE-03), one per problem product (U2)
  const stockIssues = collectCartIssues(items);

  return {
    cart,
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    priceChanges,
    stockIssues,
    stores: Array.from(storeMap.values()),
    allProductsFreeDelivery:
      items.length > 0 && items.every((i) => i.freeDelivery),
  };
}

export async function createCheckoutOrder(input: CheckoutInput) {
  // Best-effort: release stock from abandoned unpaid checkouts (Hobby cron is daily only)
  try {
    const { sweepExpiredPendingPayments } = await import(
      "@/lib/orders/expire-pending"
    );
    await sweepExpiredPendingPayments({ force: true, limit: 100 });
  } catch {
    /* non-blocking */
  }

  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { payments: true, items: true },
  });
  if (existing) {
    if (existing.customerId !== input.userId) {
      throw new Error("This checkout session is not valid. Please refresh the page and try again.");
    }
    if (existing.orderStatus === "CANCELLED" || existing.orderStatus === "FAILED") {
      // e.g. payment could not be started and the order was rolled back
      throw new Error("This checkout attempt was cancelled. Please try again.");
    }
    // Abandoned payment: rebuild Stripe/JazzCash/QR checkout
    if (existing.orderStatus === "PENDING_PAYMENT") {
      const preferQr = input.onlineProvider === "JAZZCASH_QR";
      const metaTill = existing.payments.some((p) => {
        const m = p.metadata as Record<string, unknown> | null;
        return m?.flow === "till_qr" || m?.provider === "jazzcash_till_qr";
      });
      if (
        (preferQr || metaTill || (!isStripeConfigured() && !isJazzCashConfigured())) &&
        isJazzCashQrEnabled()
      ) {
        return {
          order: existing,
          reused: true as const,
          paymentForm: null,
          stripeCheckout: null,
          jazzcashQr: buildJazzCashQrCheckoutPayload(existing),
        };
      }
      if (isStripeConfigured() && !preferQr) {
        const { resumeStripePayment } = await import("@/lib/payments/stripe");
        const resumed = await resumeStripePayment(existing.id, input.userId);
        return {
          order: resumed.order,
          reused: true as const,
          paymentForm: null,
          stripeCheckout: {
            url: null,
            sessionId: resumed.checkout.paymentIntentId,
            clientSecret: resumed.checkout.clientSecret,
            publishableKey: resumed.checkout.publishableKey,
            mode: resumed.checkout.mode,
            amountPkr: resumed.checkout.amountPkr,
          },
          jazzcashQr: null,
        };
      }
      if (isJazzCashConfigured() && !preferQr) {
        const { resumeOrderPayment } = await import("@/lib/payments/jazzcash");
        const resumed = await resumeOrderPayment(existing.id, input.userId);
        return {
          order: resumed.order,
          reused: true as const,
          paymentForm: resumed.paymentForm,
          stripeCheckout: null,
          jazzcashQr: null,
        };
      }
      if (isJazzCashQrEnabled()) {
        return {
          order: existing,
          reused: true as const,
          paymentForm: null,
          stripeCheckout: null,
          jazzcashQr: buildJazzCashQrCheckoutPayload(existing),
        };
      }
      throw new Error(
        "Online payment is temporarily unavailable. Please try again later or contact MandiBazaar support."
      );
    }
    return {
      order: existing,
      reused: true as const,
      paymentForm: null,
      stripeCheckout: null,
      jazzcashQr: null,
    };
  }

  const { items, subtotal, stockIssues, stores, allProductsFreeDelivery } =
    await recalculateCart(input.userId);
  // M9: never place an order without products (e.g. cart emptied in another tab)
  if (items.length === 0) {
    throw new CheckoutError("Your cart is empty. Add products before checking out.", "EMPTY_CART");
  }
  if (stockIssues.length > 0) {
    throw new CheckoutError(stockIssues.join(" "), "CART_ISSUES");
  }

  let addressSnapshot: CheckoutAddress;
  let destLat: number | null = null;
  let destLon: number | null = null;

  if (input.addressId) {
    const addr = await prisma.address.findFirst({
      where: { id: input.addressId, userId: input.userId },
    });
    if (!addr) throw new Error("Address not found");
    destLat = addr.latitude;
    destLon = addr.longitude;
    addressSnapshot = {
      label: addr.label,
      fullName: addr.fullName,
      phone: addr.phone,
      houseBuilding: addr.houseBuilding,
      street: addr.street || undefined,
      area: addr.area,
      city: addr.city,
      province: addr.province,
      postalCode: addr.postalCode || undefined,
      nearbyLandmark: addr.nearbyLandmark || undefined,
      deliveryInstructions: addr.deliveryInstructions || undefined,
      latitude: addr.latitude,
      longitude: addr.longitude,
    };
  } else if (input.address) {
    const phone = normalizePkMobile(input.address.phone);
    if (!phone) {
      throw new CheckoutError(MSG.mobile, "VALIDATION", { "address.phone": MSG.mobile });
    }
    addressSnapshot = { ...input.address, phone };
    destLat = input.address.latitude ?? null;
    destLon = input.address.longitude ?? null;
  } else {
    throw new Error("Delivery address is required");
  }

  const deliverySettings = await getDeliverySettings();

  // U4: minimum order on the products subtotal (before coupon)
  const minimum = minimumOrderStatus(subtotal, deliverySettings.minimumOrderAmount);
  if (!minimum.met) {
    throw new CheckoutError(minimum.message || "Minimum order not met", "MIN_ORDER");
  }

  // T4: re-validate the coupon on the server (again inside the transaction below)
  let discount = 0;
  let couponCode: string | undefined;
  let couponId: string | undefined;
  const couponAddress = {
    houseBuilding: addressSnapshot.houseBuilding,
    area: addressSnapshot.area,
    city: addressSnapshot.city,
    phone: addressSnapshot.phone,
  };
  if (input.couponCode && input.couponCode.trim()) {
    const couponResult = await validateCoupon(input.couponCode, subtotal, input.userId, {
      address: couponAddress,
    });
    if (!couponResult.valid) {
      throw new CheckoutError(couponResult.error, "COUPON", { couponCode: couponResult.error });
    }
    discount = couponResult.discount;
    couponCode = couponResult.code;
    couponId = couponResult.couponId;
  }

  // Coupon reduces products only; delivery rules use the subtotal BEFORE discount
  const productTotal = Math.max(0, subtotal - discount);
  const delivery = computeDeliveryFee(
    {
      city: addressSnapshot.city,
      area: addressSnapshot.area,
      latitude: destLat,
      longitude: destLon,
      productsSubtotal: subtotal,
      stores: stores.map((s) => ({
        storeId: s.storeId,
        latitude: s.latitude,
        longitude: s.longitude,
        city: s.city,
      })),
      allProductsFreeDelivery,
    },
    deliverySettings
  );

  // Rider bidding is offered on every order: if the customer accepted a rider's
  // bid, that amount IS the delivery fee (and the rider's earning). When no rider
  // is online / no bid is accepted, the order falls back to the standard delivery
  // fee and the store prepares it — a rider is assigned once one is available.
  const rawAcceptedBid = await getAcceptedRequestForCheckout(input.userId);
  // Only honor an accepted bid if the order still matches what the rider bid on.
  // A customer could accept a cheap bid on a small/near cart, then add stores or
  // check out to a farther address — the snapshot fee/rider no longer apply, so we
  // drop the bid entirely (fee + rider + link) and fall back to the standard fee.
  const acceptedBid = (() => {
    if (!rawAcceptedBid) return null;
    const snap = rawAcceptedBid.summary ?? {};
    const snapStores =
      typeof snap.storeCount === "number" ? snap.storeCount : stores.length;
    const snapDist =
      typeof snap.distanceKm === "number" ? snap.distanceKm : delivery.distanceKm;
    // Store set changed, or the drop is materially farther than bid on.
    if (stores.length !== snapStores) return null;
    if (delivery.distanceKm > snapDist + 0.5 && delivery.distanceKm > snapDist * 1.15) {
      return null;
    }
    return rawAcceptedBid;
  })();
  const deliveryFee = acceptedBid ? acceptedBid.fee : delivery.fee;
  const grandTotal = productTotal + deliveryFee;
  const payProductsOnline = wantsOnlineProducts(input.productPaymentChoice);

  // Owner decision 9: small orders may pay products + delivery fee in cash.
  // Re-checked here (setting on, products total after coupon ≤ limit).
  const fullCodCheck = resolveFullCodChoice({
    choice: input.productPaymentChoice,
    productTotal,
    deliveryFee,
    limit: input.productPaymentChoice === "FULL_COD" ? await getFullCodMaxOrderAmount() : 0,
  });
  if (fullCodCheck.error) throw new CheckoutError(fullCodCheck.error, "FULL_COD");
  const fullCod = fullCodCheck.fullCod;
  const needsOnlinePayment = (deliveryFee > 0 && !fullCod) || payProductsOnline;
  const cashDueOnDelivery = payProductsOnline ? 0 : productTotal + (fullCod ? deliveryFee : 0);

  const preferQr = input.onlineProvider === "JAZZCASH_QR";
  const useStripe = isStripeConfigured() && !preferQr;
  const useJazzCash = !useStripe && !preferQr && isJazzCashConfigured();
  const useJazzCashQr =
    (preferQr || (!useStripe && !useJazzCash)) && isJazzCashQrEnabled();

  // Never create PENDING_PAYMENT / reserve stock when no real gateway is wired.
  if (needsOnlinePayment && !useStripe && !useJazzCash && !useJazzCashQr) {
    throw new Error(
      "Online payment is temporarily unavailable. Please try again later or contact MandiBazaar support."
    );
  }

  const onlineAmount = onlineAmountFor({
    deliveryFee,
    productTotal,
    payProductsOnline,
  });

  // M12/M13: check the card minimum BEFORE creating the order, so a refused
  // card amount never leaves an unpaid order (or an emptied cart) behind.
  if (needsOnlinePayment && useStripe && onlineAmount < STRIPE_MIN_AMOUNT_PKR) {
    throw new CheckoutError(
      stripeMinimumMessage({
        onlineAmount,
        deliveryFee,
        payProductsOnline,
        jazzCashAvailable: isJazzCashQrEnabled() || isJazzCashConfigured(),
      }),
      "CARD_MINIMUM"
    );
  }

  const productPaymentStatus: ProductPaymentStatus = payProductsOnline
    ? "PENDING"
    : "CASH_ON_DELIVERY";

  let paymentMethod: PaymentMethod = "CASH_ON_DELIVERY";
  if (needsOnlinePayment) {
    if (payProductsOnline && deliveryFee > 0) {
      paymentMethod = useStripe ? "STRIPE" : "MIXED";
    } else if (payProductsOnline) {
      paymentMethod = useStripe ? "STRIPE" : "JAZZCASH";
    } else {
      // Delivery fee online + COD products
      paymentMethod = "MIXED";
    }
  }

  const order = await prisma.$transaction(async (tx) => {
    // T4: lock the coupon row and re-check every rule with fresh data
    if (couponId && couponCode) {
      const locked = await lockAndValidateCouponInTx(tx, {
        code: couponCode,
        productsSubtotal: subtotal,
        userId: input.userId,
        address: couponAddress,
      });
      if (locked.couponId !== couponId || locked.discount !== discount) {
        throw new CheckoutError(
          "Your coupon discount changed. Please review your order and try again.",
          "COUPON"
        );
      }
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const countToday = await tx.order.count({
      where: { createdAt: { gte: todayStart } },
    });
    const orderNumber = generateOrderNumber(countToday + 1);

    const created = await tx.order.create({
      data: {
        orderNumber,
        customerId: input.userId,
        subtotal,
        discount,
        deliveryFee,
        deliveryDistanceKm: delivery.distanceKm || null,
        grandTotal,
        deliveryFeePaid: 0,
        productAmountPaid: 0,
        // Cash still due on delivery (products, + the fee for full COD)
        remainingAmount: productTotal + (fullCod ? deliveryFee : 0),
        paymentMethod,
        deliveryFeePaymentStatus:
          deliveryFee === 0 ? "PAID" : fullCod ? "CASH_ON_DELIVERY" : "PENDING",
        productPaymentStatus,
        orderStatus: needsOnlinePayment ? "PENDING_PAYMENT" : "CONFIRMED",
        couponCode,
        couponDiscount: discount,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        // Pre-assign the rider the customer picked via bidding (if any).
        riderId: acceptedBid?.riderId ?? null,
        deliveryAddressSnapshot: addressSnapshot,
        estimatedDeliveryAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        items: {
          create: items.map((item) => ({
            storeId: item.storeId,
            storeName: item.storeName,
            productId: item.productId,
            productName: item.name,
            sku: item.sku,
            variantId: item.variantId,
            variantName: item.variantName,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: 0,
            finalPrice: item.lineTotal,
            imageUrl: item.imageUrl,
          })),
        },
      },
      include: { items: true, payments: true, customer: true },
    });

    // Rider bidding: lock in the chosen rider + their fee, and link the auction
    // to this order so it can't be reused.
    if (acceptedBid) {
      await tx.delivery.create({
        data: {
          orderId: created.id,
          riderId: acceptedBid.riderId,
          riderFee: acceptedBid.fee,
        },
      });
      await linkRequestToOrder(tx, acceptedBid.requestId, created.id);
    }

    // Per-store fulfillments (multi-store cart)
    const byStore = new Map<string, typeof items>();
    for (const item of items) {
      const list = byStore.get(item.storeId) || [];
      list.push(item);
      byStore.set(item.storeId, list);
    }

    for (const [storeId, storeItems] of Array.from(byStore.entries())) {
      const storeMeta = stores.find((s) => s.storeId === storeId)!;
      await tx.storeFulfillment.create({
        data: {
          orderId: created.id,
          storeId,
          status: needsOnlinePayment ? "PENDING_PAYMENT" : "CONFIRMED",
          subtotal: storeItems.reduce(
            (sum: number, i: (typeof items)[number]) => sum + i.lineTotal,
            0
          ),
          itemCount: storeItems.reduce(
            (sum: number, i: (typeof items)[number]) => sum + i.quantity,
            0
          ),
          pickupAddress: {
            name: storeMeta.name,
            addressLine: storeMeta.addressLine,
            city: storeMeta.city,
            latitude: storeMeta.latitude,
            longitude: storeMeta.longitude,
          },
        },
      });
    }

    for (const item of items) {
      await reserveStock(tx, {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        orderId: created.id,
        createdById: input.userId,
      });
    }

    if (couponId) {
      // Counted when the order is placed; released only if cancelled before payment
      await recordCouponUsageInTx(tx, {
        couponId,
        userId: input.userId,
        orderId: created.id,
        discount,
      });
    }

    // M9: if another tab already placed this cart, this delete finds nothing → roll back
    const cleared = await tx.cartItem.deleteMany({
      where: { cart: { userId: input.userId } },
    });
    if (cleared.count !== items.length) {
      throw new CheckoutError(
        "Your cart changed while you were checking out. Please review your cart and try again.",
        "CART_CHANGED"
      );
    }

    // COD / fully-cash orders are confirmed at creation — snapshot the financial
    // ledger now (online orders are snapshotted when the payment is approved).
    if (!needsOnlinePayment) {
      await recordOrderConfirmedLedger(tx, created.id);
    }

    return created;
  });

  let paymentForm = null;
  let stripeCheckout: {
    url: string | null;
    sessionId: string;
    clientSecret?: string;
    publishableKey: string;
    mode: string;
    amountPkr?: number;
  } | null = null;
  let jazzcashQr: JazzCashQrCheckout | null = null;

  if (needsOnlinePayment) {
    try {
      const payDelivery = deliveryFee > 0;
      const payProducts = payProductsOnline;
      const amount =
        payDelivery && payProducts
          ? grandTotal
          : payDelivery
            ? deliveryFee
            : productTotal;

      const paymentType =
        payDelivery && payProducts
          ? "FULL_PAYMENT"
          : payDelivery
            ? "DELIVERY_FEE"
            : "PRODUCT_AMOUNT";

      if (useStripe) {
        const intent = await createStripePaymentIntent({
          orderId: order.id,
          orderNumber: order.orderNumber,
          amountPkr: amount,
          paymentType,
          customerEmail: order.customer?.email,
          customerPhone: order.customer?.phone,
          idempotencyKey: `${input.idempotencyKey}:${paymentType}:stripe`,
        });
        stripeCheckout = {
          url: null,
          sessionId: intent.paymentIntentId,
          clientSecret: intent.clientSecret,
          publishableKey: intent.publishableKey,
          mode: intent.mode,
          amountPkr: intent.amountPkr,
        };
        await prisma.order.update({
          where: { id: order.id },
          data: {
            deliveryFeePaymentStatus: payDelivery
              ? "INITIATED"
              : order.deliveryFeePaymentStatus,
            paymentMethod:
              payProducts && !payDelivery
                ? "STRIPE"
                : payProducts
                  ? "STRIPE"
                  : "MIXED",
          },
        });
      } else if (useJazzCash) {
        // JazzCash merchant credentials are present
        const txnRefNo = generateTxnRefNo("MB");
        const payment = await prisma.payment.create({
          data: {
            orderId: order.id,
            type: paymentType,
            method: "JAZZCASH",
            amount,
            status: "INITIATED",
            reference: txnRefNo,
          },
        });

        await prisma.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            orderId: order.id,
            txnRefNo,
            amount,
            status: "INITIATED",
            idempotencyKey: `${input.idempotencyKey}:${paymentType}`,
            requestPayload: {},
          },
        });

        await prisma.order.update({
          where: { id: order.id },
          data: {
            deliveryFeePaymentStatus: payDelivery
              ? "INITIATED"
              : order.deliveryFeePaymentStatus,
          },
        });

        paymentForm = buildJazzCashPaymentForm({
          amount,
          billReference: order.orderNumber,
          description: `MandiBazaar order ${order.orderNumber}`,
          txnRefNo,
        });

        await prisma.paymentTransaction.update({
          where: { txnRefNo },
          data: { requestPayload: paymentForm.fields },
        });
      } else if (useJazzCashQr) {
        await prisma.payment.create({
          data: {
            orderId: order.id,
            type: paymentType,
            method: "JAZZCASH",
            amount,
            status: "INITIATED",
            reference: `till_qr_${order.orderNumber}_${Date.now()}`,
            metadata: {
              provider: "jazzcash_till_qr",
              flow: "till_qr",
              tillId: getJazzCashTillId(),
            },
          },
        });
        await prisma.order.update({
          where: { id: order.id },
          data: {
            deliveryFeePaymentStatus: payDelivery
              ? "INITIATED"
              : order.deliveryFeePaymentStatus,
          },
        });
        jazzcashQr = buildJazzCashQrCheckoutPayload(order);
      } else {
        throw new Error(
          "Online payment is temporarily unavailable. Please try again later."
        );
      }
    } catch (e) {
      // M12/M13: payment could not be started — cancel this fresh order, release
      // stock + coupon and put the products back in the cart, so the customer can
      // retry with another payment choice instead of being stuck on a dead order.
      const reason = e instanceof Error ? e.message : "Payment could not be started";
      await rollbackUnstartedCheckout(order.id, input.userId, reason).catch((err) => {
        console.error("[checkout] rollback failed", order.orderNumber, err);
      });
      throw new CheckoutError(
        `${reason} Your cart has been kept — please try again.`,
        "PAYMENT_START_FAILED"
      );
    }
  } else {
    await notifyOrderEvent(
      order.id,
      "ORDER_CONFIRMED",
      "Order confirmed",
      fullCod
        ? `Your order ${order.orderNumber} has been confirmed. Pay Rs. ${cashDueOnDelivery} in cash to the rider (products + delivery fee).`
        : `Your order ${order.orderNumber} has been confirmed. Pay Rs. ${cashDueOnDelivery} to the rider.`
    );
  }

  return {
    order,
    reused: false as const,
    paymentForm,
    stripeCheckout,
    jazzcashQr,
  };
}
