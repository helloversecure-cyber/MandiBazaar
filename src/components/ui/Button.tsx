import Link from "next/link";
import { cn } from "@/lib/utils";

export function Button({
  children,
  href,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  href?: string;
  variant?: "primary" | "secondary" | "ghost" | "outline" | "deal";
  size?: "sm" | "md" | "lg";
}) {
  const base =
    "inline-flex items-center justify-center font-semibold transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none";
  const sizes = {
    sm: "rounded-lg px-4 py-2 text-xs",
    md: "rounded-xl px-6 py-3 text-sm",
    lg: "rounded-xl px-8 py-3.5 text-base",
  };
  const variants = {
    primary:
      "bg-brand-600 text-white shadow-sm hover:bg-brand-700 hover:shadow-md active:scale-[0.98]",
    secondary:
      "bg-accent-500 text-white shadow-sm hover:bg-accent-600 active:scale-[0.98]",
    deal: "bg-deal-gradient text-white shadow-sm hover:opacity-95 active:scale-[0.98]",
    ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
    outline:
      "border-2 border-slate-200 bg-white text-slate-800 hover:border-brand-300 hover:bg-brand-50",
  };
  const cls = cn(base, sizes[size], variants[variant], className);
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button className={cls} {...props}>
      {children}
    </button>
  );
}
