import Link from "next/link";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";

/** Shared layout for About / Contact / FAQ / policy pages (QA A5). */
export function InfoPage({
  title,
  intro,
  lastUpdated,
  children,
}: {
  title: string;
  intro?: string;
  lastUpdated?: string;
  children: React.ReactNode;
}) {
  return (
    <ShopContainer width="sm">
      <Breadcrumbs items={[{ label: title }]} />
      <article className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-8">
        <h1 className="text-2xl font-extrabold text-ink md:text-3xl">{title}</h1>
        {lastUpdated && (
          <p className="mt-1 text-xs font-medium text-ink-subtle">Last updated: {lastUpdated}</p>
        )}
        {intro && <p className="mt-3 text-sm leading-relaxed text-ink-muted">{intro}</p>}
        <div className="mt-6 space-y-6 text-sm leading-relaxed text-ink-muted">{children}</div>
      </article>
      <nav aria-label="Help pages" className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-ink-subtle">
        {[
          ["/about", "About us"],
          ["/contact", "Contact us"],
          ["/faq", "FAQ"],
          ["/return-policy", "Return & refund policy"],
          ["/terms", "Terms & conditions"],
          ["/privacy", "Privacy policy"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="hover:text-brand-600 hover:underline">
            {label}
          </Link>
        ))}
      </nav>
    </ShopContainer>
  );
}

export function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-bold text-ink">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function InfoList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

/** Date shown at the top of Terms / Privacy / Returns. Update when the text changes. */
export const POLICY_LAST_UPDATED = "7 November 2026";
