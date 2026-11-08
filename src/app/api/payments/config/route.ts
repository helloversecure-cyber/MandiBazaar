import {
  getStripeMode,
  getStripePublishableKey,
  isStripeConfigured,
} from "@/lib/payments/stripe";
import { STRIPE_MIN_AMOUNT_PKR } from "@/lib/payments/card-minimum";
import { isJazzCashConfigured } from "@/lib/payments/jazzcash";
import { getJazzCashQrPublicConfig } from "@/lib/payments/jazzcash-qr";
import { apiSuccess } from "@/lib/utils";

/** Public payment provider config for checkout UI */
export async function GET() {
  const stripe = isStripeConfigured();
  const jazzcash = isJazzCashConfigured();
  const jazzcashQr = getJazzCashQrPublicConfig();
  return apiSuccess({
    stripe: {
      enabled: stripe,
      mode: stripe ? getStripeMode() : null,
      publishableKey: stripe ? getStripePublishableKey() : null,
      /** Card payments below this amount are refused (QA M12) */
      minAmountPkr: STRIPE_MIN_AMOUNT_PKR,
    },
    jazzcash: { enabled: jazzcash },
    jazzcashQr,
    /** Preferred online method for customers */
    preferredOnline: stripe
      ? "STRIPE"
      : jazzcash
        ? "JAZZCASH"
        : jazzcashQr.enabled
          ? "JAZZCASH_QR"
          : "NONE",
  });
}
