import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/auth";
import {
  getStripe,
  processStripePaymentIntentSucceeded,
} from "@/lib/payments/stripe";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";

/** Client confirms PaymentIntent after card form succeeds (covers local/dev without webhook). */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Please sign in", 401);

  try {
    const body = await req.json();
    const paymentIntentId =
      typeof body.paymentIntentId === "string" ? body.paymentIntentId.trim() : "";
    if (!paymentIntentId) return apiError("paymentIntentId required");

    const intent = await getStripe().paymentIntents.retrieve(paymentIntentId);
    const orderId = intent.metadata?.orderId;
    if (!orderId) return apiError("Invalid payment intent", 400);

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId: session.user.id },
    });
    if (!order) return apiError("Order not found", 404);

    if (intent.status !== "succeeded") {
      return apiError(`Payment not complete (${intent.status})`, 400);
    }

    const result = await processStripePaymentIntentSucceeded(intent);

    if (result.success && !result.alreadyProcessed && result.needsRefundReview) {
      if (result.paymentId && result.paidAmount) {
        const { ensureLatePaymentRefund } = await import("@/lib/orders/refunds");
        await ensureLatePaymentRefund({
          orderId: order.id,
          paymentId: result.paymentId,
          amount: result.paidAmount,
        });
      }
    }

    if (result.success && !result.alreadyProcessed && !result.needsRefundReview) {
      await notifyOrderEvent(
        order.id,
        "PAYMENT_SUCCESS",
        "Payment successful",
        `Payment verified for order ${order.orderNumber}. Your order is confirmed.`
      );
      await notifyOrderEvent(
        order.id,
        "ORDER_CONFIRMED",
        "Order confirmed",
        `Your order ${order.orderNumber} has been confirmed.`
      );
    }

    return apiSuccess({
      orderNumber: order.orderNumber,
      orderId: order.id,
      alreadyProcessed: result.alreadyProcessed || false,
      needsRefundReview: result.needsRefundReview || false,
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Confirm failed", 400);
  }
}
