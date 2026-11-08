import Link from "next/link";
import { ProductCard, ProductCardData } from "@/components/products/ProductCard";
import { ArrowRight, Flame, Sparkles, TrendingUp, Star, ShoppingBag, type LucideIcon } from "lucide-react";

type RailVariant = "flash" | "default" | "new";

/** Calm, cohesive accent per section — a tinted icon chip, not a loud banner. */
const VARIANT: Record<RailVariant, { icon: LucideIcon; chip: string; badge?: string; badgeChip?: string }> = {
  flash: {
    icon: Flame,
    chip: "bg-accent-50 text-accent-600",
    badge: "DEALS",
    badgeChip: "bg-accent-500 text-white",
  },
  new: {
    icon: Sparkles,
    chip: "bg-brand-50 text-brand-600",
    badge: "NEW",
    badgeChip: "bg-brand-600 text-white",
  },
  default: {
    icon: TrendingUp,
    chip: "bg-slate-100 text-ink-muted",
  },
};

/** One shared, quiet section header used across every home rail/grid. */
function SectionHeader({
  title,
  href,
  icon: Icon,
  chip,
  badge,
  badgeChip,
}: {
  title: string;
  href: string;
  icon: LucideIcon;
  chip: string;
  badge?: string;
  badgeChip?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-sm ring-1 ring-black/5 ${chip}`}>
          <Icon className="h-5 w-5" strokeWidth={2.3} />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-black tracking-tight text-ink sm:text-2xl">{title}</h2>
            {badge && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black tracking-wider ${badgeChip}`}>
                {badge}
              </span>
            )}
          </div>
          <span className="mt-1 block h-1 w-10 rounded-full bg-gradient-to-r from-brand-500 to-accent-500" />
        </div>
      </div>
      <Link
        href={href}
        className="press group flex shrink-0 items-center gap-1 rounded-full border border-line bg-card px-3.5 py-2 text-xs font-bold text-ink-muted shadow-sm transition hover:border-brand-300 hover:text-brand-700 sm:text-sm"
      >
        See all
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

/** Strip the leading emoji/glyph a caller may still pass in the title. */
function cleanTitle(title: string): string {
  return title.replace(/^[^A-Za-z0-9]+/, "").trim() || title;
}

export function ProductScrollRail({
  title,
  href,
  products,
  variant = "default",
}: {
  title: string;
  href: string;
  products: ProductCardData[];
  variant?: RailVariant;
}) {
  if (!products.length) return null;
  const v = VARIANT[variant];

  return (
    <section className="mx-auto max-w-7xl px-3 py-4 lg:px-4 lg:py-5">
      <SectionHeader
        title={cleanTitle(title)}
        href={href}
        icon={v.icon}
        chip={v.chip}
        badge={v.badge}
        badgeChip={v.badgeChip}
      />
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {products.map((p) => (
          <div key={p.id} className="w-[155px] shrink-0 sm:w-[172px]">
            <ProductCard product={p} compact />
          </div>
        ))}
      </div>
    </section>
  );
}

const GRID_ICON: Record<string, LucideIcon> = {
  "🔥": Flame,
  "⭐": Star,
  "🛒": ShoppingBag,
  "✨": Sparkles,
};

export function ProductGridSection({
  title,
  href,
  products,
  emoji,
}: {
  title: string;
  href: string;
  products: ProductCardData[];
  emoji?: string;
}) {
  if (!products.length) return null;
  const Icon = (emoji && GRID_ICON[emoji]) || Star;

  return (
    <section className="mx-auto max-w-7xl px-3 py-4 lg:px-4 lg:py-5">
      <SectionHeader
        title={cleanTitle(title)}
        href={href}
        icon={Icon}
        chip="bg-brand-50 text-brand-600"
      />
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-4 lg:grid-cols-5">
        {products.slice(0, 10).map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
