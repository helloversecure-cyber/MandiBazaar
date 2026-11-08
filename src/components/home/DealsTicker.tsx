import Link from "next/link";
import { Zap, Percent, Truck, Store } from "lucide-react";

/**
 * Homepage ticker. Every line is built from live data (QA A3): the flash-sale line
 * only when real discounts exist, the coupon line only when that coupon is active.
 */
export function DealsTicker({
  maxDiscount,
  coupon,
  freeDeliveryThreshold,
  storeCount,
}: {
  /** Biggest real discount % right now (0 = no deals → line hidden). */
  maxDiscount: number;
  /** An active, public coupon to advertise, or null. */
  coupon: { code: string; firstOrderOnly: boolean } | null;
  freeDeliveryThreshold: number;
  storeCount: number;
}) {
  const items: { icon: typeof Zap; text: string; href: string }[] = [];
  if (maxDiscount > 0) {
    items.push({
      icon: Zap,
      text: `Deals — up to ${maxDiscount}% off on groceries`,
      href: "/products?sort=discount",
    });
  }
  if (coupon) {
    items.push({
      icon: Percent,
      text: coupon.firstOrderOnly
        ? `Use code ${coupon.code} on your first order`
        : `Use code ${coupon.code} at checkout`,
      href: "/products",
    });
  }
  items.push({
    icon: Truck,
    text: `Free delivery on orders of Rs. ${Math.round(freeDeliveryThreshold).toLocaleString("en-PK")} or more`,
    href: "/products",
  });
  if (storeCount > 0) {
    items.push({
      icon: Store,
      text: `Shop from ${storeCount} local store${storeCount === 1 ? "" : "s"}`,
      href: "/stores",
    });
  }

  // Repeat so the marquee always fills the screen.
  const loop = [...items, ...items, ...(items.length < 3 ? [...items, ...items] : [])];

  return (
    <div className="overflow-hidden border-b border-orange-200/60 bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50">
      <div className="animate-marquee flex w-max gap-8 py-2">
        {loop.map((item, i) => (
          <Link
            key={i}
            href={item.href}
            aria-hidden={i >= items.length ? true : undefined}
            tabIndex={i >= items.length ? -1 : undefined}
            className="flex shrink-0 items-center gap-2 text-xs font-semibold text-orange-800 transition hover:text-deal-600 sm:text-sm"
          >
            <item.icon className="h-3.5 w-3.5 text-deal-500" />
            {item.text}
            <span className="text-orange-300">•</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
