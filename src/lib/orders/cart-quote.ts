/**
 * One cart quote for the guest cart, the signed-in cart and checkout, so every
 * screen shows the same delivery / minimum-order / coupon messages (QA E5, U4, M6).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";
import {
  computeDeliveryFee,
  estimateCartDelivery,
  getDeliverySettings,
  type DeliverySettings,
  type StoreLocation,
} from "@/lib/orders/delivery-fee";
import { validateCoupon, type CouponAddress } from "@/lib/orders/coupons";
import {
  checkoutBlockers,
  collectCartIssues,
  freeDeliveryStatus,
  lineStockNote,
  minimumOrderStatus,
} from "@/lib/orders/cart-summary";
import { fullCodStatus } from "@/lib/orders/full-cod";
import { getFullCodMaxOrderAmount } from "@/lib/orders/full-cod-settings";

export type QuoteDestination = {
  city: string;
  area?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  houseBuilding?: string | null;
  phone?: string | null;
};

export type CartQuoteCoupon = {
  code: string;
  applied: boolean;
  discount: number;
  message: string;
  reason?: string;
  shortBy?: number;
  minimumOrder?: number;
};

export async function buildCartQuote(opts: {
  itemCount: number;
  subtotal: number;
  stores: StoreLocation[];
  allProductsFreeDelivery: boolean;
  stockIssues: string[];
  couponCode?: string | null;
  userId?: string | null;
  /** null = address not known yet (cart) */
  destination: QuoteDestination | null;
  settings?: DeliverySettings;
  /** StoreSettings.fullCodMaxOrderAmount (read from the DB when omitted) */
  fullCodMaxOrderAmount?: number;
}) {
  const settings = opts.settings ?? (await getDeliverySettings());
  const fullCodLimit = opts.fullCodMaxOrderAmount ?? (await getFullCodMaxOrderAmount());
  const subtotal = Math.round(opts.subtotal * 100) / 100;

  let coupon: CartQuoteCoupon | null = null;
  let discount = 0;
  const code = (opts.couponCode || "").trim();
  if (code && opts.itemCount > 0) {
    const address: CouponAddress | null = opts.destination
      ? {
          houseBuilding: opts.destination.houseBuilding,
          area: opts.destination.area,
          city: opts.destination.city,
          phone: opts.destination.phone,
        }
      : null;
    const r = await validateCoupon(code, subtotal, opts.userId || undefined, { address });
    if (r.valid) {
      discount = r.discount;
      coupon = { code: r.code, applied: true, discount: r.discount, message: r.message };
    } else {
      coupon = {
        code: code.toUpperCase(),
        applied: false,
        discount: 0,
        message: r.error,
        reason: r.reason,
        shortBy: r.shortBy,
        minimumOrder: r.minimumOrder,
      };
    }
  }

  const productTotal = Math.max(0, subtotal - discount);
  const dest = opts.destination;
  const delivery = computeDeliveryFee(
    {
      city: dest?.city || "",
      area: dest?.area || undefined,
      latitude: dest?.latitude ?? null,
      longitude: dest?.longitude ?? null,
      productsSubtotal: subtotal,
      stores: opts.stores,
      allProductsFreeDelivery: opts.allProductsFreeDelivery,
    },
    settings
  );
  const estimate = estimateCartDelivery({
    productsSubtotal: subtotal,
    allProductsFreeDelivery: opts.allProductsFreeDelivery,
    stores: opts.stores,
    settings,
  });

  // The fee is known when we have the address, or when it cannot depend on it
  const deliveryKnown = Boolean(dest) || estimate.kind !== "FROM";
  const hasItems = opts.itemCount > 0;
  const feeNow = hasItems && deliveryKnown ? delivery.fee : 0;
  // Owner decision 9: small orders may pay products + delivery fee in cash
  const fullCodBase = fullCodStatus(productTotal, fullCodLimit);
  const fullCodRelevant = hasItems && fullCodBase.enabled && !delivery.isFree;
  const fullCod = {
    ...fullCodBase,
    eligible: fullCodRelevant && fullCodBase.eligible,
    /** Shown on cart / checkout when the delivery fee could be paid in cash */
    message: fullCodRelevant ? fullCodBase.message : null,
  };
  const deliveryMessage = !hasItems
    ? ""
    : delivery.isFree
    ? delivery.reason
    : deliveryKnown
      ? fullCod.eligible
        ? `Delivery fee: Rs ${delivery.fee.toLocaleString("en-PK")} (pay online, or in cash with full cash on delivery)`
        : `Delivery fee: Rs ${delivery.fee.toLocaleString("en-PK")} (paid online)`
      : estimate.message;

  const minimum = minimumOrderStatus(subtotal, settings.minimumOrderAmount);
  const freeDelivery = freeDeliveryStatus(
    subtotal,
    settings.freeDeliveryThreshold,
    opts.allProductsFreeDelivery
  );
  const blockers = checkoutBlockers({
    itemCount: opts.itemCount,
    issues: opts.stockIssues,
    minimum,
  });

  return {
    subtotal,
    productsSubtotal: subtotal,
    discount,
    productTotal,
    deliveryFee: feeNow,
    deliveryKnown,
    deliveryFeeFrom: estimate.fee,
    deliveryMessage,
    deliveryReason: delivery.reason,
    deliveryBasis: delivery.basis,
    isFreeDelivery: delivery.isFree,
    freeDeliveryThreshold: settings.freeDeliveryThreshold,
    allProductsFreeDelivery: opts.allProductsFreeDelivery,
    distanceKm: delivery.distanceKm,
    oneWayKm: delivery.oneWayKm,
    ratePerKm: settings.ratePerKm,
    maxDeliveryFee: settings.maxDeliveryFee,
    total: productTotal + feeNow,
    minimumOrder: minimum,
    freeDelivery,
    coupon,
    fullCod,
    couponError: coupon && !coupon.applied ? coupon.message : undefined,
    stockIssues: opts.stockIssues,
    checkoutBlockers: blockers,
    canCheckout: blockers.length === 0,
  };
}

export type GuestLineInput = { productId: string; variantId?: string | null; quantity: number };

function effectivePrice(price: Prisma.Decimal, salePrice: Prisma.Decimal | null) {
  const p = toNumber(price);
  const s = salePrice != null ? toNumber(salePrice) : null;
  return s != null && s < p ? s : p;
}

/**
 * Price a guest (localStorage) cart from the DB: live prices, stock, store status.
 * Unknown products are returned in `missing` so the client can drop them.
 */
export async function priceGuestCart(lines: GuestLineInput[]) {
  const ids = Array.from(new Set(lines.map((l) => l.productId))).slice(0, 100);
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        include: {
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
          variants: true,
          store: {
            select: { id: true, name: true, status: true, latitude: true, longitude: true, city: true },
          },
        },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing: GuestLineInput[] = [];
  const storeMap = new Map<string, StoreLocation & { name: string }>();
  let subtotal = 0;

  const items = [];
  for (const l of lines) {
    const product = byId.get(l.productId);
    const variant = l.variantId ? product?.variants.find((v) => v.id === l.variantId) : null;
    if (!product || (l.variantId && !variant)) {
      missing.push(l);
      continue;
    }
    const store = product.store;
    const storeOpen = store.status === "APPROVED";
    storeMap.set(store.id, {
      storeId: store.id,
      name: store.name,
      latitude: store.latitude,
      longitude: store.longitude,
      city: store.city,
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
    const productActive = product.status === "ACTIVE" && (!variant || variant.isActive !== false);
    const quantity = Math.max(1, Math.floor(Number(l.quantity) || 1));
    subtotal += unitPrice * quantity;
    const line = {
      id: `${product.id}:${variant?.id || ""}`,
      productId: product.id,
      variantId: variant?.id || null,
      storeId: store.id,
      storeName: store.name,
      name: product.name,
      variantName: variant?.name || null,
      unit: variant?.unit || product.unit,
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
      available,
      imageUrl: product.images[0]?.url || null,
      freeDelivery: Boolean(product.freeDelivery),
      storeOpen,
      productActive,
    };
    items.push({ ...line, stockNote: lineStockNote(line) });
  }

  return {
    items,
    missing,
    subtotal: Math.round(subtotal * 100) / 100,
    stockIssues: collectCartIssues(items),
    stores: Array.from(storeMap.values()).map(({ storeId, latitude, longitude, city }) => ({
      storeId,
      latitude,
      longitude,
      city,
    })),
    allProductsFreeDelivery: items.length > 0 && items.every((i) => i.freeDelivery),
  };
}
