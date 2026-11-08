import { Button } from "@/components/ui/Button";
import { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-card px-6 py-16 text-center">
      {Icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-ink-subtle dark:bg-slate-800 dark:text-ink-subtle">
          <Icon className="h-7 w-7" />
        </div>
      )}
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      {description && <p className="mt-2 max-w-sm text-sm text-ink-subtle">{description}</p>}
      {actionLabel && actionHref && (
        <Button href={actionHref} className="mt-6">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
