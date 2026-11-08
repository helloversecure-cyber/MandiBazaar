import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage, InfoSection, InfoList, POLICY_LAST_UPDATED } from "@/components/shop/InfoPage";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What personal information MandiBazaar collects, why, and how it is protected.",
};

export default function PrivacyPage() {
  return (
    <InfoPage
      title="Privacy policy"
      lastUpdated={POLICY_LAST_UPDATED}
      intro="This policy explains what information we collect when you use MandiBazaar and how we use it."
    >
      <InfoSection title="Information we collect">
        <InfoList
          items={[
            "Account details: name, mobile number, email (if given) and password (stored encrypted).",
            "Delivery details: addresses and, if you share it, map location.",
            "Order details: products, amounts, payment status and delivery history.",
            "Payment receipts you upload. Card details are handled by our card payment provider and are not stored by MandiBazaar.",
            "Basic technical data such as device and browser type, used to keep the site secure and working.",
          ]}
        />
      </InfoSection>
      <InfoSection title="How we use it">
        <InfoList
          items={[
            "To process and deliver your orders and handle payments and refunds.",
            "To share the details needed for delivery (name, phone, address) with the store and rider handling your order.",
            "To send order updates and answer your questions.",
            "To prevent fraud and keep accounts secure.",
          ]}
        />
      </InfoSection>
      <InfoSection title="Sharing">
        <p>
          We do not sell your personal information. We share it only with the stores and riders fulfilling your
          order, payment providers, and authorities when the law requires it.
        </p>
      </InfoSection>
      <InfoSection title="Keeping your data safe">
        <p>
          Access to personal data is limited to people who need it for their work. Passwords are stored encrypted.
          No system is completely secure, so please keep your password private.
        </p>
      </InfoSection>
      <InfoSection title="Your choices">
        <InfoList
          items={[
            "You can view and update your details and addresses in My account.",
            "You can ask us to delete your account. Some order records may be kept where the law requires it.",
          ]}
        />
      </InfoSection>
      <InfoSection title="Contact">
        <p>
          Questions about privacy?{" "}
          <Link href="/contact" className="font-semibold text-brand-600 hover:underline">Contact us</Link>.
          We may update this policy; the date above shows the latest version.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
