"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Sparkles, ArrowRight, Truck, Store, ShieldCheck } from "lucide-react";
import { safeLinkOr } from "@/lib/validators/safe-link";

export type HeroSlideData = {
  id?: string;
  imageUrl: string;
  tag: string;
  title: string;
  sub: string;
  cta: string;
  href: string;
  accent: string;
  stat: string;
};

type Promo = { label: string; sub: string; href: string; gradient: string; emoji: string };

/** Promo tiles under the carousel — built from live numbers, no fake deadlines (QA A3). */
function buildPromos(freeDeliveryThreshold: number, maxDiscount: number): Promo[] {
  const promos: Promo[] = [
    {
      label: "Free Delivery",
      sub: `Orders of Rs. ${Math.round(freeDeliveryThreshold).toLocaleString("en-PK")} or more`,
      href: "/products",
      gradient: "from-brand-600 to-emerald-800",
      emoji: "🚚",
    },
  ];
  if (maxDiscount > 0) {
    promos.push({
      label: "Deals",
      sub: `Up to ${maxDiscount}% off`,
      href: "/products?sort=discount",
      gradient: "from-red-500 to-orange-500",
      emoji: "⚡",
    });
  } else {
    promos.push({
      label: "Local Stores",
      sub: "Browse every store",
      href: "/stores",
      gradient: "from-red-500 to-orange-500",
      emoji: "🛒",
    });
  }
  promos.push({
    label: "Sell on MandiBazaar",
    sub: "Open your store",
    href: "/store",
    gradient: "from-accent-500 to-amber-500",
    emoji: "🏪",
  });
  return promos;
}

function SlideImage({
  src,
  alt,
  active,
  priority,
}: {
  src: string;
  alt: string;
  active: boolean;
  priority?: boolean;
}) {
  const remote = src.startsWith("http://") || src.startsWith("https://");
  const dataOrLocal = src.startsWith("data:") || src.startsWith("/");

  if (remote) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        className={`object-cover ${active ? "animate-ken-burns" : ""}`}
        priority={priority}
        sizes="100vw"
        unoptimized={
          src.includes("aws.neon.tech") || src.includes("neon.tech")
            ? false
            : true
        }
      />
    );
  }

  if (dataOrLocal) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full object-cover ${
          active ? "animate-ken-burns" : ""
        }`}
      />
    );
  }

  return null;
}

const HERO_MESH =
  "radial-gradient(at 18% 22%, rgba(16,185,129,0.55) 0px, transparent 55%)," +
  "radial-gradient(at 82% 18%, rgba(20,184,166,0.45) 0px, transparent 50%)," +
  "radial-gradient(at 70% 85%, rgba(245,158,11,0.32) 0px, transparent 50%)," +
  "radial-gradient(at 30% 80%, rgba(5,150,105,0.5) 0px, transparent 55%)";

const FALLBACK_PILLS = [
  { label: "Vegetables", href: "/products?q=vegetables" },
  { label: "Fruits", href: "/products?q=fruits" },
  { label: "Daal", href: "/products?q=daal" },
  { label: "Rice", href: "/products?q=rice" },
  { label: "Atta", href: "/products?q=atta" },
  { label: "Dairy", href: "/products?q=dairy" },
];

/** Vibrant, immersive branded hero shown when there are no custom DB slides:
 *  animated mesh gradient, morphing blobs, a glass search bar, quick category
 *  pills and floating stat chips. */
function BrandedHero({
  freeDeliveryThreshold,
  maxDiscount,
  storeCount = 0,
  categories = [],
}: {
  freeDeliveryThreshold: number;
  maxDiscount: number;
  storeCount?: number;
  categories?: { name: string; slug: string }[];
}) {
  const [q, setQ] = useState("");
  const freeAmt = Math.round(freeDeliveryThreshold).toLocaleString("en-PK");
  const pills = categories.length
    ? categories.slice(0, 6).map((c) => ({ label: c.name, href: `/products?category=${encodeURIComponent(c.slug)}` }))
    : FALLBACK_PILLS;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    window.location.href = term ? `/products?q=${encodeURIComponent(term)}` : "/products";
  }

  return (
    <div className="relative overflow-hidden rounded-3xl bg-[#032a20] shadow-[0_30px_80px_-24px_rgba(2,44,34,0.7)] ring-1 ring-black/20">
      {/* Animated mesh gradient */}
      <div
        className="animate-mesh pointer-events-none absolute inset-0"
        style={{ backgroundImage: HERO_MESH, backgroundSize: "150% 150%" }}
      />
      {/* Morphing blobs */}
      <div className="animate-blob pointer-events-none absolute -left-10 top-6 h-56 w-56 rounded-full bg-emerald-400/30 blur-3xl" />
      <div className="animate-blob-2 pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-teal-300/25 blur-3xl" />
      <div className="animate-blob-3 pointer-events-none absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl" />
      {/* Dot grid */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)", backgroundSize: "24px 24px" }}
      />

      <div className="relative px-5 py-14 text-center sm:px-10 sm:py-16 md:py-20">
        <span className="animate-fade-up mx-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-100 ring-1 ring-white/20 backdrop-blur">
          <Sparkles className="h-3.5 w-3.5" /> Pakistan&apos;s local marketplace
        </span>

        <h1 className="animate-fade-up mx-auto mt-5 max-w-3xl text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-5xl md:text-6xl lg:text-7xl">
          Your mandi,{" "}
          <span className="bg-gradient-to-r from-emerald-300 via-amber-200 to-teal-200 bg-clip-text text-transparent">
            delivered fresh
          </span>
        </h1>
        <p className="animate-fade-up mx-auto mt-4 max-w-xl text-sm text-emerald-50/85 sm:text-base md:text-lg">
          Daal, atta, rice, fruits and more from trusted local stores — one cart, one delivery.
        </p>

        {/* Glass search */}
        <form onSubmit={submit} className="animate-fade-up mx-auto mt-7 flex max-w-xl items-center gap-2 rounded-2xl bg-white/95 p-1.5 shadow-2xl ring-1 ring-white/40 backdrop-blur-md sm:rounded-full">
          <Sparkles className="ml-3 hidden h-4 w-4 shrink-0 text-brand-500 sm:block" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search daal, atta, rice, fruits…"
            aria-label="Search products"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            className="press inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 sm:rounded-full"
          >
            Search <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        {/* Quick category pills */}
        <div className="animate-fade-up mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="text-xs font-semibold text-emerald-100/70">Popular:</span>
          {pills.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/20 backdrop-blur transition hover:bg-white/20"
            >
              {p.label}
            </Link>
          ))}
        </div>

        {/* Floating stat chips */}
        <div className="animate-float-chip pointer-events-none absolute left-4 top-16 hidden items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 text-left ring-1 ring-white/20 backdrop-blur-md lg:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white"><Truck className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-bold text-white">Free delivery</p>
            <p className="text-[10px] text-emerald-100/80">On Rs. {freeAmt}+</p>
          </div>
        </div>
        {storeCount > 0 && (
          <div className="animate-float-chip-2 pointer-events-none absolute right-4 top-24 hidden items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 text-left ring-1 ring-white/20 backdrop-blur-md lg:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white"><Store className="h-4 w-4" /></span>
            <div>
              <p className="text-xs font-bold text-white">{storeCount} local {storeCount === 1 ? "store" : "stores"}</p>
              <p className="text-[10px] text-emerald-100/80">Verified by MandiBazaar</p>
            </div>
          </div>
        )}
        <div className="animate-float-chip-2 pointer-events-none absolute bottom-6 right-6 hidden items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 text-left ring-1 ring-white/20 backdrop-blur-md lg:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-white"><ShieldCheck className="h-4 w-4" /></span>
          <div>
            <p className="text-xs font-bold text-white">{maxDiscount > 0 ? `Up to ${maxDiscount}% off` : "Fresh daily"}</p>
            <p className="text-[10px] text-emerald-100/80">{maxDiscount > 0 ? "Live deals" : "Delivered in 48h"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroCarousel({
  slides,
  freeDeliveryThreshold = 5000,
  maxDiscount = 0,
  storeCount = 0,
  categories = [],
}: {
  slides: HeroSlideData[];
  freeDeliveryThreshold?: number;
  maxDiscount?: number;
  storeCount?: number;
  categories?: { name: string; slug: string }[];
}) {
  const promos = buildPromos(freeDeliveryThreshold, maxDiscount);
  const [idx, setIdx] = useState(0);
  const count = slides.length;

  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % count), 5500);
    return () => clearInterval(t);
  }, [count]);

  useEffect(() => {
    if (idx >= count) setIdx(0);
  }, [count, idx]);

  return (
    <section className="bg-gradient-to-b from-slate-100 to-app dark:from-slate-900">
      <div className="mx-auto max-w-7xl px-3 py-3 lg:px-4 lg:py-4">
        {count ? (
        <div className="relative overflow-hidden rounded-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.35)] ring-1 ring-black/5">
          {slides.map((s, i) => (
            <div
              key={s.id || `${s.title}-${i}`}
              className={`transition-all duration-700 ease-in-out ${
                i === idx
                  ? "relative z-[1] opacity-100"
                  : "absolute inset-0 z-0 opacity-0"
              }`}
            >
              <div className="relative aspect-[16/7] overflow-hidden bg-slate-900 sm:aspect-[16/6] md:aspect-[16/5]">
                <SlideImage
                  src={s.imageUrl}
                  alt={s.title}
                  active={i === idx}
                  priority={i === 0}
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/10" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

                <div className="absolute inset-0 flex flex-col justify-center px-6 sm:px-10 md:px-14">
                  {s.tag ? (
                    <span
                      className={`animate-fade-up mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-gradient-to-r ${
                        s.accent || "from-brand-600 via-emerald-600 to-teal-500"
                      } px-3 py-1 text-[10px] font-black tracking-widest text-white shadow-lg sm:text-xs`}
                    >
                      <Sparkles className="h-3 w-3" />
                      {s.tag}
                    </span>
                  ) : null}
                  <h2 className="animate-fade-up max-w-lg text-3xl font-black leading-[1.1] text-white drop-shadow-lg sm:text-4xl md:text-5xl lg:text-6xl">
                    {s.title}
                  </h2>
                  {s.sub ? (
                    <p className="animate-fade-up mt-3 max-w-md text-sm text-white/90 sm:text-base">
                      {s.sub}
                    </p>
                  ) : null}
                  <div className="animate-fade-up mt-6 flex flex-wrap items-center gap-3">
                    <Link
                      href={safeLinkOr(s.href)}
                      className="shine-hover rounded-xl bg-card px-6 py-3 text-sm font-black text-ink shadow-xl transition hover:scale-105 hover:bg-accent-500 hover:text-white"
                    >
                      {(s.cta || "Shop now") + " →"}
                    </Link>
                    {s.stat ? (
                      <span className="rounded-full bg-card/15 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md">
                        {s.stat}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIdx((i) => (i - 1 + count) % count)}
                className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-card/95 p-2.5 shadow-lg backdrop-blur transition hover:scale-110 hover:bg-card"
                aria-label="Previous"
              >
                <ChevronLeft className="h-5 w-5 text-ink" />
              </button>
              <button
                type="button"
                onClick={() => setIdx((i) => (i + 1) % count)}
                className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-card/95 p-2.5 shadow-lg backdrop-blur transition hover:scale-110 hover:bg-card"
                aria-label="Next"
              >
                <ChevronRight className="h-5 w-5 text-ink" />
              </button>
              <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-2">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIdx(i)}
                    className={`rounded-full transition-all duration-300 ${
                      i === idx
                        ? "h-2 w-8 bg-card shadow-md"
                        : "h-2 w-2 bg-card/40 hover:bg-card/70"
                    }`}
                    aria-label={`Slide ${i + 1}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        ) : (
          <BrandedHero
            freeDeliveryThreshold={freeDeliveryThreshold}
            maxDiscount={maxDiscount}
            storeCount={storeCount}
            categories={categories}
          />
        )}

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {promos.map((b) => (
            <Link
              key={b.label}
              href={b.href}
              className={`shine-hover group relative overflow-hidden rounded-xl bg-gradient-to-br ${b.gradient} p-4 text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-xl`}
            >
              <div className="absolute -right-4 -top-4 text-5xl opacity-20 transition group-hover:scale-125 group-hover:opacity-30">
                {b.emoji}
              </div>
              <p className="relative font-black">{b.label}</p>
              <p className="relative text-xs text-white/80">{b.sub}</p>
              <span className="relative mt-2 inline-block text-sm font-bold opacity-80 group-hover:opacity-100">
                Shop →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
