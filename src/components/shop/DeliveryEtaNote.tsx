import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared promise shown on cart, checkout, product, and confirmation. */
export const DELIVERY_ETA_MESSAGE =
  "Delivery within 48 hours after your order is confirmed.";

export function DeliveryEtaNote({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-xl border border-brand-100 bg-brand-50/80 text-brand-900 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-200",
        compact ? "items-center px-3 py-2" : "items-start px-3 py-2.5",
        className
      )}
      role="note"
    >
      <Truck
        className={cn(
          "shrink-0 text-brand-600",
          compact ? "mt-0 h-3.5 w-3.5" : "mt-0.5 h-4 w-4"
        )}
        aria-hidden
      />
      <p className={cn(compact ? "text-[11px] leading-snug" : "text-xs leading-relaxed")}>
        <span className="font-semibold">Delivery time: </span>
        {DELIVERY_ETA_MESSAGE}
      </p>
    </div>
  );
}
