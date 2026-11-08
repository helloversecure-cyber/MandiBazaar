import { NextRequest } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import {
  getStripe,
  getStripeWebhookSecret,
  isStripeConfigured,
  processStripeCheckoutCompleted,
  processStripePaymentIntentSucceeded,
} from "@/lib/payments/stripe";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";

export const runtime = "nodejs";

async function notifyStripeResult(result: {
  success: boolean;
  orderId?: string;
  alreadyProcessed?: boolean;
  needsRefundReview?: boolean;
  paymentId?: string;
  paidAmount?: number;
}) {
  if (!result.success || !result.orderId || result.alreadyProcessed) return;
  const order = await prisma.order.findUnique({
    where: { id: result.orderId },
  });
  if (!order) return;
  if (result.needsRefundReview) {
    if (result.paymentId && result.paidAmount) {
      const { ensureLatePaymentRefund } = await import("@/lib/orders/refunds");
      await ensureLatePaymentRefund({
        orderId: result.orderId,
        paymentId: result.paymentId,
        amount: result.paidAmount,
      });
    }
    await notifyOrderEvent(
      order.id,
      "PAYMENT_LATE_ON_CLOSED_ORDER",
      "Payment needs review",
      `A Stripe payment arrived for closed order ${order.orderNumber}. Refund has been queued.`
    );
    return;
  }
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

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) return apiError("Stripe is disabled", 503);
  const webhookSecret = getStripeWebhookSecret();
  const body = await req.text();
  const sig = headers().get("stripe-signature");

  let event: Stripe.Event;

  try {
    if (webhookSecret && sig) {
      event = getStripe().webhooks.constructEvent(body, sig, webhookSecret);
    } else if (process.env.NODE_ENV !== "production") {
      event = JSON.parse(body) as Stripe.Event;
    } else {
      return apiError("Webhook secret not configured", 500);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    console.error("[stripe webhook]", msg);
    return apiError(`Webhook Error: ${msg}`, 400);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await notifyStripeResult(await processStripeCheckoutCompleted(session));
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      await notifyStripeResult(await processStripePaymentIntentSucceeded(intent));
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      await prisma.paymentTransaction.updateMany({
        where: { txnRefNo: session.id, status: "INITIATED" },
        data: { status: "EXPIRED" },
      });
      await prisma.payment.updateMany({
        where: { reference: session.id, status: "INITIATED" },
        data: { status: "EXPIRED" },
      });
    }

    return apiSuccess({ received: true });
  } catch (e) {
    console.error("[stripe webhook handler]", e);
    return apiError("Webhook handler failed", 500);
  }
}
