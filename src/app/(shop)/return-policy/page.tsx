import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage, InfoSection, InfoList, POLICY_LAST_UPDATED } from "@/components/shop/InfoPage";

export const metadata: Metadata = {
  title: "Return & refund policy",
  description: "How returns and refunds work on MandiBazaar for damaged, wrong or missing items.",
};

export default function ReturnPolicyPage() {
  return (
    <InfoPage
      title="Return & refund policy"
      lastUpdated={POLICY_LAST_UPDATED}
      intro="We want every order to arrive as expected. Because most products are groceries and fresh food, returns are accepted for the reasons below."
    >
      <InfoSection title="What can be returned">
        <InfoList
          items={[
            "Items that arrive damaged, leaking, spoiled or expired.",
            "Wrong items (different product, size or quantity from what you ordered).",
            "Items that are missing from your order.",
          ]}
        />
        <p>
          Change-of-mind returns are not accepted for food and fresh produce once delivered. Please check your
          order when the rider hands it over.
        </p>
      </InfoSection>
      <InfoSection title="How to report a problem">
        <InfoList
          items={[
            "Report it within 24 hours of delivery.",
            "Share your order number and a clear photo of the item (and its packaging or label).",
            <>
              Contact us through the details on the{" "}
              <Link href="/contact" className="font-semibold text-brand-600 hover:underline">Contact us</Link> page.
            </>,
            "Keep the item until the request is resolved — we or the store may arrange to collect it.",
          ]}
        />
      </InfoSection>
      <InfoSection title="Refunds">
        <InfoList
          items={[
            "Once a request is approved, the refund is made to the original payment method (card, JazzCash, or bank/JazzCash transfer for cash payments) within 7 working days.",
            "We may offer a replacement instead of a refund when the store has the item in stock.",
            "The delivery fee is refunded when the whole order is cancelled before dispatch, or when the whole order was wrong or unusable.",
          ]}
        />
      </InfoSection>
      <InfoSection title="Cancellations">
        <p>
          You can ask to cancel an order before it is dispatched. Orders already on the way cannot be cancelled,
          but you can report a problem after delivery as described above.
        </p>
      </InfoSection>
      <InfoSection title="Questions">
        <p>
          See the <Link href="/faq" className="font-semibold text-brand-600 hover:underline">FAQ</Link> or{" "}
          <Link href="/contact" className="font-semibold text-brand-600 hover:underline">contact us</Link>.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
