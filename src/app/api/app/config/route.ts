import { getSession } from "@/lib/auth/auth";
import { listBiddingAllowedFor } from "@/lib/lists/settings";
import { isStripeConfigured, getStripePublishableKey, getStripeMode } from "@/lib/payments/stripe";
import { isJazzCashConfigured } from "@/lib/payments/jazzcash";
import { getJazzCashQrPublicConfig } from "@/lib/payments/jazzcash-qr";
import { apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Startup config for the Android app: version gate, feature switches and which
 * payment methods are on. Works signed in (features for that user) or not.
 * APP_MIN_VERSION blocks older app builds; APP_LATEST_VERSION suggests an update.
 */
export async function GET() {
  const session = await getSession().catch(() => null);
  const stripe = isStripeConfigured();
  return apiSuccess({
    minAppVersion: process.env.APP_MIN_VERSION || "1.0.0",
    latestAppVersion: process.env.APP_LATEST_VERSION || process.env.APP_MIN_VERSION || "1.0.0",
    playStoreUrl: "https://play.google.com/store/apps/details?id=pk.mandibazaar.app",
    features: {
      listBidding: await listBiddingAllowedFor(session?.user?.email),
    },
    payments: {
      cashOnDelivery: true,
      stripe: { enabled: stripe, mode: stripe ? getStripeMode() : null, publishableKey: stripe ? getStripePublishableKey() : null },
      jazzcash: { enabled: isJazzCashConfigured() },
      jazzcashQr: getJazzCashQrPublicConfig(),
    },
    support: { email: "hello@mandibazaar.pk", web: process.env.NEXT_PUBLIC_APP_URL || "https://www.mandibazaar.pk" },
    links: {
      privacy: "/privacy",
      terms: "/terms",
      deleteAccount: "/delete-account",
    },
  });
}
