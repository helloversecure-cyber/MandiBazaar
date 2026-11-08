import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { cartItemSchema } from "@/lib/validators/schemas";
import { recalculateCart } from "@/lib/orders/checkout";
import { computeDeliveryFee, getDeliverySettings } from "@/lib/orders/delivery-fee";
import { buildCartQuote, type QuoteDestination } from "@/lib/orders/cart-quote";
import { getAcceptedRequestForCheckout } from "@/lib/orders/bidding";
import { apiError, apiSuccess } from "@/lib/utils";

/** Non-blocking: free stock from abandoned PENDING_PAYMENT orders (TTL-aligned). */
function kickExpireSweep() {
  void import("@/lib/orders/expire-pending")
    .then(({ sweepExpiredPendingPayments }) =>
      sweepExpiredPendingPayments({ limit: 50 })
    )
    .catch(() => {});
}

async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

/**
 * Cart + quote. Query params:
 *   coupon=CODE            validate a coupon (reason returned in `coupon` / `couponError`)
 *   addressId=…            quote delivery for a saved address
 *   defaultAddress=1       quote for the customer's default saved address (cart page)
 *   city / area / latitude / longitude   quote for a new address (checkout)
 *   quotes=1               also return a delivery quote per saved address
 */
export async function GET(req: Request) {
  try {
    kickExpireSweep();
    const session = await getSession();
    if (!session?.user?.id) return apiError("Please sign in to view your cart", 401);
    const userId = session.user.id;

    const { items, subtotal, stockIssues, stores, allProductsFreeDelivery } =
      await recalculateCart(userId);
    const url = new URL(req.url);
    const couponCode = url.searchParams.get("coupon") || undefined;
    const addressId = url.searchParams.get("addressId") || undefined;
    const wantQuotes = url.searchParams.get("quotes") === "1";
    const wantDefault = url.searchParams.get("defaultAddress") === "1";

    const cityParam = url.searchParams.get("city");
    let destination: QuoteDestination | null = null;
    let resolvedAddressId: string | null = null;

    const num = (v: string | null) =>
      v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;

    if (addressId || wantDefault) {
      const addr = addressId
        ? await prisma.address.findFirst({ where: { id: addressId, userId } })
        : await prisma.address.findFirst({
            where: { userId },
            orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
          });
      if (addr) {
        resolvedAddressId = addr.id;
        destination = {
          city: addr.city,
          area: addr.area || null,
          latitude: addr.latitude,
          longitude: addr.longitude,
          houseBuilding: addr.houseBuilding,
          phone: addr.phone,
        };
      }
    }
    if (!destination && cityParam) {
      destination = {
        city: cityParam,
        area: url.searchParams.get("area") || null,
        latitude: num(url.searchParams.get("latitude")),
        longitude: num(url.searchParams.get("longitude")),
        houseBuilding: url.searchParams.get("houseBuilding") || null,
        phone: url.searchParams.get("phone") || null,
      };
    }

    const settings = await getDeliverySettings();
    const storeLocations = stores.map((s) => ({
      storeId: s.storeId,
      latitude: s.latitude,
      longitude: s.longitude,
      city: s.city,
    }));

    const quote = await buildCartQuote({
      itemCount: items.length,
      subtotal,
      stores: storeLocations,
      allProductsFreeDelivery,
      stockIssues,
      couponCode,
      userId,
      destination,
      settings,
    });

    let addressQuotes:
      | {
          addressId: string;
          deliveryFee: number;
          isFree: boolean;
          reason: string;
          oneWayKm: number;
          distanceKm: number;
        }[]
      | undefined;

    if (wantQuotes) {
      const addrs = await prisma.address.findMany({
        where: { userId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });
      // Cap quotes so a huge address book cannot hammer fee calc
      addressQuotes = addrs.slice(0, 25).map((a) => {
        const q = computeDeliveryFee(
          {
            city: a.city,
            area: a.area || undefined,
            latitude: a.latitude,
            longitude: a.longitude,
            productsSubtotal: subtotal,
            stores: storeLocations,
            allProductsFreeDelivery,
          },
          settings
        );
        return {
          addressId: a.id,
          deliveryFee: q.fee,
          isFree: q.isFree,
          reason: q.reason,
          oneWayKm: q.oneWayKm,
          distanceKm: q.distanceKm,
        };
      });
    }

    // Rider bidding: if the customer has accepted a rider's bid, the summary must
    // show THAT fee (and total), not the km estimate — so the screen matches the
    // amount the order will actually charge.
    const acceptedBid = await getAcceptedRequestForCheckout(userId);

    return apiSuccess({
      items,
      stores,
      ...quote,
      ...(acceptedBid
        ? {
            deliveryFee: acceptedBid.fee,
            total: Math.round((quote.productTotal + acceptedBid.fee) * 100) / 100,
            deliveryBid: { fee: acceptedBid.fee },
          }
        : {}),
      addressQuotes,
      quoteFor: destination
        ? { city: destination.city, area: destination.area || null, addressId: resolvedAddressId }
        : null,
    });
  } catch (e) {
    console.error("[cart GET]", e);
    return apiError("Failed to load cart", 500);
  }
}

export async function POST(req: Request) {
  try {
    kickExpireSweep();
    const session = await getSession();
    if (!session?.user?.id) return apiError("Please sign in to add items", 401);

    const body = await req.json();
    const parsed = cartItemSchema.safeParse(body);
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid item");

    const { productId, variantId, quantity, capToStock } = parsed.data;
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true, store: { select: { name: true, status: true } } },
    });
    if (!product || product.status !== "ACTIVE") {
      return apiError("This product is currently unavailable");
    }
    if (product.store.status !== "APPROVED") {
      return apiError(`${product.store.name} is not taking orders right now.`);
    }

    let available = product.stockQuantity - product.reservedStock;
    if (variantId) {
      const variant = product.variants.find((v) => v.id === variantId);
      if (!variant || !variant.isActive) return apiError("Selected variant is unavailable");
      available = variant.stockQuantity - variant.reservedStock;
    }
    available = Math.max(0, available);
    if (available <= 0) {
      return apiError("This product is currently out of stock.");
    }

    const cart = await getOrCreateCart(session.user.id);
    const existing = await prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        productId,
        variantId: variantId || null,
      },
    });

    // U2: never more than the available stock
    const current = existing?.quantity ?? 0;
    let newQty = current + quantity;
    let notice: string | undefined;
    if (newQty > available) {
      if (!capToStock || current >= available) {
        return apiError(
          current > 0
            ? `Only ${available} available — you already have ${current} in your cart.`
            : `Only ${available} available in stock.`
        );
      }
      newQty = available;
      notice = `Only ${available} of ${product.name} available — quantity set to ${available}.`;
    }

    if (existing) {
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    } else {
      await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId,
          variantId: variantId || null,
          quantity: newQty,
        },
      });
    }

    const cartData = await recalculateCart(session.user.id);
    return apiSuccess({ ...cartData, notice }, 201);
  } catch {
    return apiError("Could not add item to cart", 500);
  }
}

export async function PATCH(req: Request) {
  try {
    kickExpireSweep();
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const body = await req.json();
    const { itemId, quantity, variantId } = body as {
      itemId: string;
      quantity?: number;
      variantId?: string | null;
    };
    if (typeof itemId !== "string" || !itemId) return apiError("Cart item not found", 404);
    if (
      quantity !== undefined &&
      (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity > 1000)
    ) {
      return apiError("Quantity must be a whole number");
    }

    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId: session.user.id } },
      include: { product: { include: { variants: true } }, variant: true },
    });
    if (!item) return apiError("Cart item not found", 404);

    if (quantity !== undefined) {
      if (quantity <= 0) {
        await prisma.cartItem.delete({ where: { id: itemId } });
      } else {
        // U2: cap at available stock (reducing is always allowed)
        const targetVariantId = variantId !== undefined ? variantId : item.variantId;
        const variant = targetVariantId
          ? item.product.variants.find((v) => v.id === targetVariantId)
          : null;
        if (targetVariantId && !variant) return apiError("Selected variant is unavailable");
        const available = Math.max(
          0,
          variant
            ? variant.stockQuantity - variant.reservedStock
            : item.product.stockQuantity - item.product.reservedStock
        );
        if (quantity > item.quantity && quantity > available) {
          return apiError(
            available <= 0
              ? `${item.product.name} is out of stock.`
              : `Only ${available} left of ${item.product.name}.`
          );
        }
        await prisma.cartItem.update({
          where: { id: itemId },
          data: { quantity, ...(variantId !== undefined ? { variantId } : {}) },
        });
      }
    } else if (variantId !== undefined) {
      await prisma.cartItem.update({
        where: { id: itemId },
        data: { variantId },
      });
    }

    return apiSuccess(await recalculateCart(session.user.id));
  } catch {
    return apiError("Could not update cart", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    kickExpireSweep();
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const url = new URL(req.url);
    const itemId = url.searchParams.get("itemId");
    if (itemId) {
      await prisma.cartItem.deleteMany({
        where: { id: itemId, cart: { userId: session.user.id } },
      });
    } else {
      await prisma.cartItem.deleteMany({
        where: { cart: { userId: session.user.id } },
      });
    }
    return apiSuccess(await recalculateCart(session.user.id));
  } catch {
    return apiError("Could not remove item", 500);
  }
}
