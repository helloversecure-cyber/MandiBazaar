import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, toNumber } from "@/lib/utils";
import { buildInvoicePdf } from "@/lib/orders/invoice-pdf";
import { getUserStoreIds } from "@/lib/stores/access";

export async function GET(
  _req: NextRequest,
  { params }: { params: { orderNumber: string } }
) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const role = session.user.role || "";
    const isAdmin = [
      "SUPER_ADMIN",
      "ADMIN",
      "ORDER_MANAGER",
      "DELIVERY_MANAGER",
    ].includes(role);
    const isStoreOwner = role === "STORE_OWNER";
    // APPROVED stores this user owns or belongs to (empty for non-owners). Used
    // both to scope access (a suspended store can't pull invoices) and to limit
    // what a store owner sees on an order they didn't place.
    const storeIds = isStoreOwner ? await getUserStoreIds(session.user.id) : [];

    const order = await prisma.order.findFirst({
      where: {
        orderNumber: params.orderNumber,
        ...(isAdmin
          ? {}
          : isStoreOwner
            ? {
                OR: [
                  { customerId: session.user.id },
                  { items: { some: { storeId: { in: storeIds } } } },
                ],
              }
            : { customerId: session.user.id }),
      },
      include: {
        items: true,
        customer: { select: { fullName: true, phone: true, email: true } },
      },
    });

    if (!order) return apiError("Order not found", 404);

    // A store owner viewing an order they didn't place sees only their own
    // store's line items, the delivery area (never the full home address) and
    // no customer contact — matching the store orders list.
    const asStore = isStoreOwner && order.customerId !== session.user.id;
    const items = asStore
      ? order.items.filter((i) => storeIds.includes(i.storeId))
      : order.items;
    const fullAddress =
      (order.deliveryAddressSnapshot as Record<string, string | null>) || {};
    const address = asStore
      ? { area: fullAddress.area ?? null, city: fullAddress.city ?? null }
      : fullAddress;
    const customer = asStore
      ? { fullName: null, phone: null, email: null }
      : order.customer;

    // For a store owner's view, scope the money to their own line items so the
    // combined order totals (and other stores' revenue) are never exposed.
    const storeSubtotal = items.reduce((s, i) => s + toNumber(i.finalPrice), 0);

    const pdf = buildInvoicePdf({
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      orderStatus: order.orderStatus,
      paymentMethod: order.paymentMethod,
      deliveryFeePaymentStatus: order.deliveryFeePaymentStatus,
      subtotal: asStore ? storeSubtotal : toNumber(order.subtotal),
      discount: asStore ? 0 : toNumber(order.discount),
      deliveryFee: asStore ? 0 : toNumber(order.deliveryFee),
      grandTotal: asStore ? storeSubtotal : toNumber(order.grandTotal),
      deliveryFeePaid: asStore ? 0 : toNumber(order.deliveryFeePaid),
      productAmountPaid: asStore ? 0 : toNumber(order.productAmountPaid),
      remainingAmount: asStore ? 0 : toNumber(order.remainingAmount),
      couponCode: asStore ? null : order.couponCode,
      customer,
      deliveryAddressSnapshot: address,
      items: items.map((i) => ({
        productName: i.productName,
        storeName: i.storeName,
        variantName: i.variantName,
        quantity: i.quantity,
        unit: i.unit,
        unitPrice: toNumber(i.unitPrice),
        finalPrice: toNumber(i.finalPrice),
      })),
    });

    const filename = `MandiBazaar-Invoice-${order.orderNumber}.pdf`;

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Invoice PDF error", e);
    return apiError("Failed to generate invoice", 500);
  }
}
