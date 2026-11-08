import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { InfoPage, InfoSection } from "@/components/shop/InfoPage";
import { formatPhone, getSiteInfo, whatsappLink } from "@/lib/shop/site-info";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Get help with an order, a delivery or your MandiBazaar account.",
};

export default async function ContactPage() {
  const site = await getSiteInfo();
  const rows: { icon: typeof Mail; label: string; value: string; href?: string; external?: boolean }[] = [];
  if (site.whatsapp) {
    rows.push({
      icon: MessageCircle,
      label: "WhatsApp",
      value: formatPhone(site.whatsapp),
      href: whatsappLink(site.whatsapp),
      external: true,
    });
  }
  if (site.phone) {
    rows.push({ icon: Phone, label: "Phone", value: formatPhone(site.phone), href: `tel:${site.phone}` });
  }
  rows.push({ icon: Mail, label: "Email", value: site.email, href: `mailto:${site.email}` });
  rows.push({ icon: MapPin, label: "Address", value: site.address });

  return (
    <InfoPage
      title="Contact us"
      intro="Questions about an order, a delivery, a refund or your account? Get in touch and include your order number (for example ORD-20261107-000123) so we can help faster."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => {
          const body = (
            <>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <r.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold uppercase tracking-wide text-ink-subtle">{r.label}</span>
                <span className="block break-words font-semibold text-ink">{r.value}</span>
              </span>
            </>
          );
          return r.href ? (
            <a
              key={r.label}
              href={r.href}
              {...(r.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="flex items-center gap-3 rounded-xl border border-line p-4 transition hover:border-brand-200 hover:bg-brand-50/40"
            >
              {body}
            </a>
          ) : (
            <div key={r.label} className="flex items-center gap-3 rounded-xl border border-line p-4">
              {body}
            </div>
          );
        })}
      </div>
      <InfoSection title="Before you write">
        <p>
          Many answers are in our <Link href="/faq" className="font-semibold text-brand-600 hover:underline">FAQ</Link>.
          For damaged or wrong items, see the{" "}
          <Link href="/return-policy" className="font-semibold text-brand-600 hover:underline">Return &amp; refund policy</Link>{" "}
          — please report them within 24 hours of delivery with a photo.
        </p>
        <p>
          You can follow your orders any time under{" "}
          <Link href="/account/orders" className="font-semibold text-brand-600 hover:underline">My orders</Link>.
        </p>
      </InfoSection>
      <InfoSection title="Store owners">
        <p>
          Want to sell on MandiBazaar? Start at{" "}
          <Link href="/store" className="font-semibold text-brand-600 hover:underline">Sell on MandiBazaar</Link>.
        </p>
      </InfoSection>
    </InfoPage>
  );
}
