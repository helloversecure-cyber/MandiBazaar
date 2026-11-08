import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage, InfoSection, InfoList, POLICY_LAST_UPDATED } from "@/components/shop/InfoPage";

export const metadata: Metadata = {
  title: "Terms & conditions",
  description: "The terms for using MandiBazaar and buying from stores on the marketplace.",
};

export default function TermsPage() {
  return (
    <InfoPage
      title="Terms & conditions"
      lastUpdated={POLICY_LAST_UPDATED}
      intro="These terms apply when you use the MandiBazaar website and place orders. By using the site you agree to them."
    >
      <InfoSection title="1. About the marketplace">
        <p>
          MandiBazaar is a marketplace. Products are sold by independent stores that have been approved by
          MandiBazaar. Each store is responsible for its product information, quality and prices. MandiBazaar
          runs the website, takes payments and coordinates delivery.
        </p>
      </InfoSection>
      <InfoSection title="2. Your account">
        <InfoList
          items={[
            "Give accurate details (name, mobile number, delivery address).",
            "Keep your password private. You are responsible for orders placed from your account.",
            "We may suspend accounts used for fraud, abuse or repeated fake orders.",
          ]}
        />
      </InfoSection>
      <InfoSection title="3. Prices, stock and orders">
        <InfoList
          items={[
            "Prices are in Pakistani Rupees (PKR) and are set by the stores.",
            "Stock is limited. An order is confirmed only after it is accepted; if an item becomes unavailable we will tell you and you will not be charged for it.",
            "Product photos are for illustration; weight and packaging may vary slightly.",
            "A minimum order amount may apply. It is shown before you check out.",
          ]}
        />
      </InfoSection>
      <InfoSection title="4. Payment and delivery">
        <InfoList
          items={[
            "The delivery fee is paid online (card or JazzCash) when you place the order, unless the order qualifies for free delivery.",
            "Products can be paid online or in cash to the rider on delivery, where offered at checkout.",
            "Delivery fees are calculated per kilometre (go + return) as shown at checkout.",
            "Please make sure someone is available at the address to receive the order.",
          ]}
        />
      </InfoSection>
      <InfoSection title="5. Returns and refunds">
        <p>
          Returns and refunds follow our{" "}
          <Link href="/return-policy" className="font-semibold text-brand-600 hover:underline">Return &amp; refund policy</Link>.
        </p>
      </InfoSection>
      <InfoSection title="6. Coupons and offers">
        <p>
          Coupons and deals have their own conditions (minimum order, dates, usage limits) shown when you apply
          them. We may withdraw an offer that is misused.
        </p>
      </InfoSection>
      <InfoSection title="7. Acceptable use">
        <p>
          Do not misuse the site, try to access other people&apos;s accounts or data, or post false reviews.
        </p>
      </InfoSection>
      <InfoSection title="8. Liability">
        <p>
          We take reasonable care to keep the site working and information accurate, but we cannot guarantee it
          will always be available or error-free. Nothing in these terms limits rights you have under Pakistani law.
        </p>
      </InfoSection>
      <InfoSection title="9. Changes and contact">
        <p>
          We may update these terms; the date above shows the latest version. Questions:{" "}
          <Link href="/contact" className="font-semibold text-brand-600 hover:underline">contact us</Link>.
          These terms are governed by the laws of Pakistan.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
