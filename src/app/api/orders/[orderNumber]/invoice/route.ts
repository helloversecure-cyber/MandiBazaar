import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, toNumber } from "@/lib/utils";
import { buildInvoicePdf } from "@/lib/orders/invoice-pdf";

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

    const order = await prisma.order.findFirst({
      where: {
        orderNumber: params.orderNumber,
        ...(isAdmin
          ? {}
          : isStoreOwner
            ? {
                OR: [
                  { customerId: session.user.id },
                  {
                    fulfillments: {
                      some: { store: { ownerId: session.user.id } },
                    },
                  },
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

    const address =
      (order.deliveryAddressSnapshot as Record<string, string | null>) || {};

    const pdf = buildInvoicePdf({
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      orderStatus: order.orderStatus,
      paymentMethod: order.paymentMethod,
      deliveryFeePaymentStatus: order.deliveryFeePaymentStatus,
      subtotal: toNumber(order.subtotal),
      discount: toNumber(order.discount),
      deliveryFee: toNumber(order.deliveryFee),
      grandTotal: toNumber(order.grandTotal),
      deliveryFeePaid: toNumber(order.deliveryFeePaid),
      productAmountPaid: toNumber(order.productAmountPaid),
      remainingAmount: toNumber(order.remainingAmount),
      couponCode: order.couponCode,
      customer: order.customer,
      deliveryAddressSnapshot: address,
      items: order.items.map((i) => ({
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
