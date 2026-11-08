import Link from "next/link";
import { Truck, ShieldCheck, RotateCcw, Headphones } from "lucide-react";

/** Homepage service badges — only true, checkable claims (QA A3). */
export function ServiceBar({
  freeDeliveryThreshold,
  supportLine,
}: {
  freeDeliveryThreshold: number;
  /** e.g. "WhatsApp 0300 1234567" or the support email. */
  supportLine: string;
}) {
  const items = [
    {
      icon: Truck,
      label: "Free Delivery",
      sub: `On Rs. ${Math.round(freeDeliveryThreshold).toLocaleString("en-PK")}+`,
      color: "from-brand-500 to-emerald-600",
      href: "/faq",
    },
    {
      icon: ShieldCheck,
      label: "Approved Stores",
      sub: "Checked by MandiBazaar",
      color: "from-emerald-600 to-teal-600",
      href: "/stores",
    },
    {
      icon: RotateCcw,
      label: "Easy Returns",
      sub: "Damaged or wrong items",
      color: "from-teal-500 to-green-600",
      href: "/return-policy",
    },
    {
      icon: Headphones,
      label: "Customer support",
      sub: supportLine,
      color: "from-orange-500 to-amber-500",
      href: "/contact",
    },
  ];
  return (
    <section className="border-y border-line bg-card">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-3 py-4 sm:grid-cols-4 lg:px-4">
        {items.map(({ icon: Icon, label, sub, color, href }) => (
          <Link
            key={label}
            href={href}
            className="flex min-w-0 items-center gap-3 rounded-xl bg-app/80 px-3 py-2.5 transition hover:bg-slate-100"
          >
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${color} shadow-md`}
            >
              <Icon className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-ink sm:text-sm">{label}</p>
              <p className="truncate text-[10px] text-ink-subtle sm:text-xs">{sub}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
