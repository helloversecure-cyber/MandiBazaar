import { cn } from "@/lib/utils";

/** Base surface card — theme-aware (light + dark). */
export function Card({
  children,
  className,
  as: Tag = "div",
  interactive = false,
}: {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
  interactive?: boolean;
}) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-line bg-card shadow-card",
        interactive && "hover-lift press cursor-pointer",
        className
      )}
    >
      {children}
    </Tag>
  );
}

/** Card with a header row (title + optional action) and padded body. */
export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-bold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </Card>
  );
}
