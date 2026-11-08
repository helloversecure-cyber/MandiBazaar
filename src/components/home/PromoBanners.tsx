import Image from "next/image";
import Link from "next/link";

export type PromoBanner = {
  href: string;
  image: string;
  title: string;
  badge: string;
  unitsSold: number;
};

const STYLES = [
  {
    gradient: "from-emerald-600/90 via-teal-500/60 to-transparent",
    ring: "ring-emerald-400/30",
  },
  {
    gradient: "from-orange-600/90 via-red-500/50 to-transparent",
    ring: "ring-orange-400/30",
  },
  {
    gradient: "from-sky-700/90 via-teal-600/50 to-transparent",
    ring: "ring-sky-400/30",
  },
] as const;

/** Top-selling category cards — only render when `banners` has items from real sales. */
export function PromoBannerGrid({ banners }: { banners: PromoBanner[] }) {
  if (!banners.length) return null;

  return (
    <section className="mx-auto max-w-7xl px-3 py-3 lg:px-4">
      <div className="mb-2 flex items-end justify-between gap-2 px-0.5">
        <div>
          <h2 className="text-base font-black text-ink sm:text-lg">
            Hot categories
          </h2>
          <p className="text-xs text-ink-subtle">
            Based on what customers are buying most
          </p>
        </div>
      </div>
      <div
        className={`grid grid-cols-1 gap-3 ${
          banners.length === 1
            ? "sm:grid-cols-1 sm:max-w-md"
            : banners.length === 2
              ? "sm:grid-cols-2"
              : "sm:grid-cols-3"
        }`}
      >
        {banners.map((b, i) => {
          const style = STYLES[i % STYLES.length];
          return (
            <Link
              key={b.href}
              href={b.href}
              className={`shine-hover group relative aspect-[2.2/1] overflow-hidden rounded-2xl shadow-md ring-2 ${style.ring} transition hover:-translate-y-1 hover:shadow-xl sm:aspect-[2/1]`}
            >
              <Image
                src={b.image}
                alt={b.title}
                fill
                className="object-cover transition duration-500 group-hover:scale-110"
                sizes="(max-width:768px) 100vw, 33vw"
              />
              <div
                className={`absolute inset-0 bg-gradient-to-t ${style.gradient}`}
              />
              <div className="absolute inset-0 flex flex-col justify-end p-4">
                <span className="mb-1.5 w-fit rounded-lg bg-card px-2.5 py-1 text-[10px] font-black text-deal-600 shadow">
                  {b.badge}
                </span>
                <p className="text-lg font-black text-white drop-shadow-md">
                  {b.title}
                </p>
                <span className="mt-1 text-xs font-semibold text-white/80 opacity-0 transition group-hover:opacity-100">
                  Shop now →
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Deals banner — real max discount only, no fake "weekend / limited time" claims (QA A3). */
export function FullWidthBanner({ maxDiscount, dealCount }: { maxDiscount: number; dealCount: number }) {
  if (maxDiscount <= 0) return null;
  return (
    <section className="mx-auto max-w-7xl px-3 py-3 lg:px-4">
      <Link
        href="/products?sort=discount"
        className="shine-hover group relative block overflow-hidden rounded-2xl shadow-[0_16px_50px_-12px_rgba(239,68,68,0.4)] ring-2 ring-deal-500/20"
      >
        <div className="relative aspect-[5/2] sm:aspect-[4/1]">
          <Image
            src="https://images.unsplash.com/photo-1607082348824-0a960f6860b1?w=1200&q=80"
            alt="Deals from local stores"
            fill
            className="object-cover transition duration-700 group-hover:scale-105"
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-deal-600/95 via-orange-500/80 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-between px-6 sm:px-12">
            <div>
              <p className="text-xs font-black tracking-[0.25em] text-white/90 sm:text-sm">
                DEALS FROM LOCAL STORES
              </p>
              <p className="mt-1 text-2xl font-black text-white drop-shadow-lg sm:text-4xl md:text-5xl">
                Save up to {maxDiscount}%
              </p>
              <p className="mt-1 hidden text-sm text-white/85 sm:block">
                {dealCount} product{dealCount === 1 ? "" : "s"} on discount right now
              </p>
            </div>
            <span className="hidden rounded-2xl bg-card px-6 py-3 text-sm font-black text-deal-600 shadow-xl transition group-hover:scale-105 sm:inline-block">
              Grab Deals →
            </span>
          </div>
          <div className="absolute -right-10 top-1/2 hidden h-40 w-40 -translate-y-1/2 rounded-full bg-card/10 blur-2xl sm:block" />
        </div>
      </Link>
    </section>
  );
}
