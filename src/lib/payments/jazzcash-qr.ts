/**
 * Manual JazzCash Till / QR payments until merchant API credentials arrive.
 * Customer pays via QR or Till ID, then uploads a receipt for admin review.
 */

export function getJazzCashTillId() {
  return (process.env.JAZZCASH_TILL_ID || "980803336").trim();
}

export function getJazzCashTillMerchantName() {
  return (process.env.JAZZCASH_TILL_MERCHANT_NAME || "ybs services").trim();
}

export function getJazzCashTillQrImageUrl() {
  return (
    process.env.JAZZCASH_TILL_QR_IMAGE_URL ||
    "/payments/jazzcash-till-qr.jpg"
  ).trim();
}

/** Off only when explicitly disabled — on by default as JazzCash API fallback. */
export function isJazzCashQrEnabled() {
  if (process.env.JAZZCASH_QR_ENABLED === "false") return false;
  return Boolean(getJazzCashTillId());
}

export function getJazzCashQrPublicConfig() {
  if (!isJazzCashQrEnabled()) {
    return { enabled: false as const };
  }
  return {
    enabled: true as const,
    tillId: getJazzCashTillId(),
    merchantName: getJazzCashTillMerchantName(),
    qrImageUrl: getJazzCashTillQrImageUrl(),
    ussdHint: `Dial *786*10# and enter TILL ID ${getJazzCashTillId()} to pay via JazzCash.`,
  };
}
