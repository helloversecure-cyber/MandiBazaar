import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { notifyOrderEvent } from "@/lib/notifications/service";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import { isUsableImageUrl } from "@/lib/orders/proof-review";

/** Customer submits JazzCash Till/QR payment receipt for admin review */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Please sign in", 401);

  const rl = rateLimit(`payment-proof:${session.user.id}`, 15, 60_000);
  if (!rl.ok) return apiError("Too many uploads. Please wait a moment.", 429);

  try {
    const body = await req.json();
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    const imageUrl =
      typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";

    if (!orderId) return apiError("orderId required");
    if (!isUsableImageUrl(imageUrl)) {
      return apiError("Please upload a valid receipt image");
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId: session.user.id },
      include: {
        paymentProofs: {
          where: { status: "PENDING_REVIEW" },
          take: 1,
        },
      },
    });
    if (!order) return apiError("Order not found", 404);
    if (order.orderStatus !== "PENDING_PAYMENT") {
      return apiError("This order does not need a payment receipt right now");
    }
    if (order.paymentProofs.length > 0) {
      return apiError(
        "A receipt is already waiting for admin review. Please wait."
      );
    }

    const proof = await prisma.paymentProof.create({
      data: {
        orderId: order.id,
        imageUrl,
        notes: notes || "Customer JazzCash Till/QR receipt",
        status: "PENDING_REVIEW",
        uploadedById: session.user.id,
      },
    });

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
