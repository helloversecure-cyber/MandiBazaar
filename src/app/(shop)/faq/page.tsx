import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "@/components/shop/InfoPage";
import { getSiteInfo, rupees } from "@/lib/shop/site-info";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers about ordering, delivery fees, payment, returns and stores on MandiBazaar.",
};

export default async function FaqPage() {
  const site = await getSiteInfo();
  const faqs: { q: string; a: React.ReactNode }[] = [
    {
      q: "How do I place an order?",
      a: "Add products to your cart, go to checkout, choose your delivery address and payment option, and place the order. You can add products from more than one store in the same cart.",
    },
    {
      q: "How much is delivery?",
      a: `Delivery is charged per kilometre (${rupees(site.ratePerKm)}/km, go + return) from the store to your address. Orders of ${rupees(site.freeDeliveryThreshold)} or more get free delivery, and some products are marked "Free delivery" by their store.${site.minimumOrderAmount > 0 ? ` The minimum order is ${rupees(site.minimumOrderAmount)}.` : ""}`,
    },
    {
      q: "How can I pay?",
      a: "The delivery fee is paid online when you place the order (card, or JazzCash with a receipt). You can pay for the products online or in cash to the rider on delivery.",
    },
    {
      q: "Can I pay everything in cash on delivery?",
      a: "Products can be paid in cash on delivery. The delivery fee is always paid online, unless your order has free delivery.",
    },
    {
      q: "When will my order arrive?",
      a: "Delivery is within 48 hours after your order is confirmed. You can follow it under My orders.",
    },
    {
      q: "Something arrived damaged or wrong. What do I do?",
      a: (
        <>
          Report it within 24 hours of delivery with a photo. See the{" "}
          <Link href="/return-policy" className="font-semibold text-brand-600 hover:underline">Return &amp; refund policy</Link>.
        </>
      ),
    },
    {
      q: "How long do refunds take?",
      a: "Approved refunds are sent to the original payment method within 7 working days.",
    },
    {
      q: "Can I search in Urdu?",
      a: "Yes. You can search in English, Roman Urdu (daal, chawal, atta) or Urdu (دال، چاول، آٹا).",
    },
    {
      q: "Who sells the products?",
      a: (
        <>
          Local stores approved by MandiBazaar. Each product shows its store; see{" "}
          <Link href="/stores" className="font-semibold text-brand-600 hover:underline">all stores</Link>.
        </>
      ),
    },
    {
      q: "I own a store. How do I sell here?",
      a: (
        <>
          Go to <Link href="/store" className="font-semibold text-brand-600 hover:underline">Sell on MandiBazaar</Link>{" "}
          to create a store account. Our team reviews every store before its products go live.
        </>
      ),
    },
  ];

  return (
    <InfoPage title="Frequently asked questions" intro="Quick answers about ordering on MandiBazaar.">
      <div className="divide-y divide-surface-border rounded-xl border border-line">
        {faqs.map((f) => (
          <details key={f.q} className="group p-4 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 font-semibold text-ink">
              {f.q}
              <span className="shrink-0 text-brand-600 transition group-open:rotate-45">+</span>
            </summary>
            <div className="mt-2 text-ink-muted">{f.a}</div>
          </details>
        ))}
      </div>
      <p>
        Still need help? <Link href="/contact" className="font-semibold text-brand-600 hover:underline">Contact us</Link>.
      </p>
    </InfoPage>
  );
}
