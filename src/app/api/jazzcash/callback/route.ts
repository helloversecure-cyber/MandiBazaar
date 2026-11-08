import { NextRequest } from "next/server";
import { processJazzCashCallback, simulateSuccessfulPayment } from "@/lib/payments/jazzcash";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";

async function handleCallback(payload: Record<string, string>) {
  const result = await processJazzCashCallback(payload);

  if (result.success && result.orderId && !result.alreadyProcessed) {
    const order = await prisma.order.findUnique({ where: { id: result.orderId } });
    if (order) {
      if (result.needsRefundReview) {
        if (result.paymentId && result.paidAmount) {
          const { ensureLatePaymentRefund } = await import(
            "@/lib/orders/refunds"
          );
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
          `A JazzCash payment arrived for closed order ${order.orderNumber}. Refund has been queued.`
        );
      } else {
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
    }
  }

  return result;
}

/** JazzCash redirects here (GET or POST) */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let payload: Record<string, string> = {};

    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else {
      const form = await req.formData();
      form.forEach((value, key) => {
        payload[key] = String(value);
      });
    }

    const result = await handleCallback(payload);
    const order = result.orderId
      ? await prisma.order.findUnique({ where: { id: result.orderId } })
      : null;

    const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    if (result.success && order) {
      if (result.needsRefundReview) {
        return Response.redirect(
          `${base}/account/orders/${order.orderNumber}?notice=payment_review`,
          303
        );
      }
      return Response.redirect(
        `${base}/checkout/confirmation?order=${order.orderNumber}`,
        303
      );
    }
    return Response.redirect(
      `${base}/checkout/payment?error=${encodeURIComponent(result.message)}&order=${order?.orderNumber || ""}&orderId=${order?.id || ""}`,
      303
    );
  } catch {
    const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return Response.redirect(`${base}/checkout/payment?error=verification_failed`, 303);
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const payload: Record<string, string> = {};
  sp.forEach((v, k) => {
    payload[k] = v;
  });

  if (!payload.pp_TxnRefNo) {
    return apiError("Invalid callback");
  }

  const result = await handleCallback(payload);
  return apiSuccess(result);
}

/** Dev-only: simulate JazzCash success when credentials are missing */
export async function PUT(req: Request) {
  if (process.env.NODE_ENV === "production" && process.env.JAZZCASH_ALLOW_SIMULATE !== "true") {
    return apiError("Not available", 403);
  }
  try {
    const { txnRefNo } = await req.json();
    if (!txnRefNo) return apiError("txnRefNo required");
    const result = await simulateSuccessfulPayment(txnRefNo);
    if (result.success && result.orderId && !result.alreadyProcessed) {
      await notifyOrderEvent(
        result.orderId,
        "ORDER_CONFIRMED",
        "Order confirmed",
        "Your payment was verified and order confirmed."
      );
    }
    return apiSuccess(result);
  } catch {
    return apiError("Simulation failed", 500);
  }
}
