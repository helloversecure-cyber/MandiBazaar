/**
 * Payment receipt (PaymentProof) review rules — QA P6 / EDGE-04. Pure, unit tested.
 * Used by the Payments page (to show the right buttons) AND by the API (to reject).
 */

const TERMINAL = ["CANCELLED", "FAILED", "RETURNED"];

/** Receipt image must be an uploaded file or an https URL. */
export function isUsableImageUrl(url: string | null | undefined): boolean {
  const u = (url || "").trim();
  if (!u) return false;
  if (u.startsWith("/uploads/")) return u.length > "/uploads/".length;
  return /^https:\/\/[^\s/]+\/\S+/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S+/i.test(u);
}

export type ProofDecision = {
  canApprove: boolean;
  /** Order is closed but the customer may have paid: record + queue a refund */
  canRefund: boolean;
  blockedReason: string | null;
};

export function proofDecisionFor(
  proof: { status: string; riderId?: string | null; imageUrl: string },
  order: {
    orderStatus: string;
    productPaymentStatus: string;
    deliveryFeePaymentStatus: string;
  }
): ProofDecision {
  if (proof.status !== "PENDING_REVIEW") {
    return { canApprove: false, canRefund: false, blockedReason: "Already reviewed" };
  }
  const refunded =
    order.productPaymentStatus === "REFUNDED" || order.deliveryFeePaymentStatus === "REFUNDED";
  if (TERMINAL.includes(order.orderStatus) || refunded) {
    return {
      canApprove: false,
      canRefund: TERMINAL.includes(order.orderStatus) && isUsableImageUrl(proof.imageUrl),
      blockedReason: refunded
        ? "This order was refunded — do not approve this receipt."
        : `This order is ${order.orderStatus.toLowerCase()} — do not approve. If the money really arrived in the JazzCash Till, record it and refund the customer; otherwise decline.`,
    };
  }
  if (!isUsableImageUrl(proof.imageUrl)) {
    return {
      canApprove: false,
      canRefund: false,
      blockedReason: "The receipt image is missing or blank — decline and ask for a clear receipt.",
    };
  }
  const isRiderProof = !!proof.riderId;
  if (!isRiderProof && order.orderStatus !== "PENDING_PAYMENT") {
    return {
      canApprove: false,
      canRefund: false,
      blockedReason: "This order is already paid and confirmed — this looks like a duplicate receipt. Decline it.",
    };
  }
  return { canApprove: true, canRefund: false, blockedReason: null };
}
