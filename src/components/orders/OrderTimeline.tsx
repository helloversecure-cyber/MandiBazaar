import { Check, Truck, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type JourneyStep = {
  key: string;
  label: string;
  state: "done" | "current" | "upcoming" | "cancelled";
  at: string | null;
};

function fmt(at: string | null): string {
  if (!at) return "";
  try {
    return new Date(at).toLocaleString("en-PK", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Vertical delivery journey: Placed → Confirmed → … → Delivered. */
export function OrderTimeline({ steps }: { steps: JourneyStep[] }) {
  if (!steps?.length) return null;
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const done = s.state === "done";
        const current = s.state === "current";
        const cancelled = s.state === "cancelled";
        return (
          <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Connector line */}
            {!last && (
              <span
                className={cn(
                  "absolute left-[13px] top-7 h-[calc(100%-1rem)] w-0.5",
                  done ? "bg-brand-500" : "bg-line"
                )}
              />
            )}
            {/* Dot */}
            <span
              className={cn(
                "relative z-[1] mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                cancelled
                  ? "bg-red-500 text-white"
                  : done
                    ? "bg-brand-600 text-white"
                    : current
                      ? "bg-brand-600 text-white"
                      : "bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
              )}
            >
              {cancelled ? (
                <XCircle className="h-4 w-4" />
              ) : s.key === "OUT" ? (
                <Truck className="h-3.5 w-3.5" />
              ) : done ? (
                <Check className="h-4 w-4" strokeWidth={3} />
              ) : (
                <span className={cn("h-2 w-2 rounded-full", current ? "animate-pulse bg-white" : "bg-current")} />
              )}
              {current && (
                <span className="absolute inset-0 animate-ping rounded-full bg-brand-500/40" />
              )}
            </span>
            {/* Label */}
            <div className="min-w-0 flex-1 pt-0.5">
              <p
                className={cn(
                  "text-sm font-semibold",
                  cancelled ? "text-red-600 dark:text-red-400" : done || current ? "text-ink" : "text-ink-subtle"
                )}
              >
                {s.label}
                {current && (
                  <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                    In progress
                  </span>
                )}
              </p>
              {s.at && <p className="mt-0.5 text-xs text-ink-subtle">{fmt(s.at)}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
