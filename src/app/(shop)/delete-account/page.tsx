import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage, InfoSection, InfoList, POLICY_LAST_UPDATED } from "@/components/shop/InfoPage";

export const metadata: Metadata = {
  title: "Delete your account",
  description: "How to delete your MandiBazaar account and what happens to your data.",
};

/** Public page linked from the Google Play listing (Play requires a web link for account deletion). */
export default function DeleteAccountInfoPage() {
  return (
    <InfoPage
      title="Delete your account"
      lastUpdated={POLICY_LAST_UPDATED}
      intro="You can close your MandiBazaar account at any time, from the website or the Android app."
    >
      <InfoSection title="How to delete it">
        <InfoList
          items={[
            <>
              On the website: sign in, then open{" "}
              <Link href="/account/delete" className="font-semibold text-brand-600 hover:underline">
                My account → Delete account
              </Link>
              .
            </>,
            "In the MandiBazaar app: Account → Delete account.",
            <>
              Can&apos;t sign in? Email{" "}
              <a href="mailto:hello@mandibazaar.pk" className="font-semibold text-brand-600 hover:underline">
                hello@mandibazaar.pk
              </a>{" "}
              from the email address on your account.
            </>,
          ]}
        />
      </InfoSection>
      <InfoSection title="What happens">
        <InfoList
          items={[
            "Your account is closed straight away and you are signed out everywhere.",
            "Lists you sent to stores are cancelled.",
            "MandiBazaar then removes your name, phone number, addresses and other personal details.",
            "Order, payment and payout records are kept only as long as the law requires.",
            "Store and rider accounts with open orders, payouts or cash to settle are closed by our team after settlement.",
          ]}
        />
      </InfoSection>
    </InfoPage>
  );
}
