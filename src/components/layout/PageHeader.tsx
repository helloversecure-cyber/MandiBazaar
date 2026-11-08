import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  badge,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        {badge && (
          <span className="mb-2 inline-block rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
            {badge}
          </span>
        )}
        <h1 className="text-2xl font-extrabold text-ink md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-subtle">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
