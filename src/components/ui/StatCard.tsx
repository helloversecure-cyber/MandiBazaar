import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatTone = "brand" | "accent" | "info" | "success" | "danger" | "neutral";

const ICON_TONES: Record<StatTone, string> = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300",
  accent: "bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-400",
  info: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
  success: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  danger: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300",
  neutral: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300",
};

/** Headline metric tile for dashboards — theme-aware. */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "brand",
  hint,
  trend,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  hint?: React.ReactNode;
  trend?: { value: string; direction: "up" | "down" };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "hover-lift rounded-2xl border border-line bg-card p-5 shadow-card",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
        {Icon && (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
              ICON_TONES[tone]
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
          </span>
        )}
      </div>
      <p className="num-tabular mt-3 text-2xl font-extrabold text-ink">{value}</p>
      {(hint || trend) && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          {trend && (
            <span
              className={cn(
                "font-semibold",
                trend.direction === "up"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              )}
            >
              {trend.direction === "up" ? "▲" : "▼"} {trend.value}
            </span>
          )}
          {hint && <span className="text-ink-subtle">{hint}</span>}
        </div>
      )}
    </div>
  );
}
