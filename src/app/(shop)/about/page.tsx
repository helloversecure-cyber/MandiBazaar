import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage, InfoSection, InfoList } from "@/components/shop/InfoPage";

export const metadata: Metadata = {
  title: "About us",
  description: "MandiBazaar is an online marketplace where local Pakistani grocery stores sell to customers near them.",
};

export default function AboutPage() {
  return (
    <InfoPage
      title="About MandiBazaar"
      intro="MandiBazaar is an online marketplace that brings local grocery and mandi stores to your phone. You order from one or more stores in a single cart, and a rider brings your order to your door."
    >
      <InfoSection title="What we do">
        <p>
          Independent stores list their products — daal, rice, atta, spices, ghee, fruit, vegetables and everyday
          groceries — and set their own prices. MandiBazaar handles the website, orders, payments and delivery
          coordination so stores can focus on their products.
        </p>
      </InfoSection>
      <InfoSection title="How it works">
        <InfoList
          items={[
            "Browse products or search in English, Roman Urdu or Urdu.",
            "Add items to your cart and choose a delivery address.",
            "Pay the delivery fee online (card or JazzCash). Pay for the products online or in cash to the rider.",
            "The store prepares your order and a rider delivers it.",
          ]}
        />
      </InfoSection>
      <InfoSection title="Stores on MandiBazaar">
        <p>
          Every store is reviewed by our team before its products appear in the shop. Product names, photos,
          descriptions and prices are provided by the stores. See{" "}
          <Link href="/stores" className="font-semibold text-brand-600 hover:underline">all stores</Link>.
        </p>
        <p>
          Own a store?{" "}
          <Link href="/store" className="font-semibold text-brand-600 hover:underline">Sell on MandiBazaar</Link>.
        </p>
      </InfoSection>
      <InfoSection title="Where we are">
        <p>MandiBazaar is based in Lahore, Pakistan.</p>
      </InfoSection>
    </InfoPage>
  );
}
