import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import { isUsableImageUrl } from "@/lib/orders/proof-review";
import { isOwnUploadUrl } from "@/lib/uploads/neon-storage";

/** Customer submits JazzCash Till/QR payment receipt for admin review */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Please sign in", 401);

  const rl = await rateLimit(`payment-proof:${session.user.id}`, 15, 60_000);
  if (!rl.ok) return apiError("Too many uploads. Please wait a moment.", 429);

  try {
    const body = await req.json();
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const imageUrl =
      typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";

    if (!orderId) return apiError("orderId required");
    // L5: only a receipt uploaded through our own /api/upload is accepted.
    if (!isUsableImageUrl(imageUrl) || !isOwnUploadUrl(imageUrl)) {
      return apiError("Please upload a valid receipt image");
    }

    // L6: lock the order row so two submits at once can't both see "no pending
    // receipt" and create two (the second waits, then sees the first).
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Order" WHERE id = ${orderId} AND "customerId" = ${session.user.id} FOR UPDATE`;
      if (locked.length === 0) return { ok: false, error: apiError("Order not found", 404) } as const;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { id: true, orderNumber: true, orderStatus: true },
      });
      if (order.orderStatus !== "PENDING_PAYMENT") {
        return { ok: false, error: apiError("This order does not need a payment receipt right now") } as const;
      }
      const pending = await tx.paymentProof.count({ where: { orderId: order.id, status: "PENDING_REVIEW" } });
      if (pending > 0) {
        return { ok: false, error: apiError("A receipt is already waiting for admin review. Please wait.") } as const;
      }
      const proof = await tx.paymentProof.create({
        data: {
          orderId: order.id,
          imageUrl,
          notes: notes || "Customer JazzCash Till/QR receipt",
          status: "PENDING_REVIEW",
          uploadedById: session.user.id,
        },
      });
      return { ok: true, order, proof } as const;
    });
    if (!outcome.ok) return outcome.error;
    const { order, proof } = outcome;

    await writeAuditLog({
      userId: session.user.id,
      action: "PAYMENT_PROOF_SUBMITTED",
      entity: "PaymentProof",
      entityId: proof.id,
      newValue: { orderId: order.id, orderNumber: order.orderNumber },
    });

    await notifyOrderEvent(
      order.id,
      "PAYMENT_PROOF_SUBMITTED",
      "Payment receipt received",
      `We received your JazzCash receipt for order ${order.orderNumber}. MandiBazaar will verify it shortly.`
    );

    return apiSuccess({
      proofId: proof.id,
      orderNumber: order.orderNumber,
      status: proof.status,
      message:
        "Receipt submitted. Your order will be confirmed after MandiBazaar verifies the payment.",
    });
  } catch (e) {
    console.error("[payment-proof]", e);
    return apiError(toUserMessage(e), 400);
  }
}
