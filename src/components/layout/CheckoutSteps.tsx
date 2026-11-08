import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const STEPS = ["Info", "Address", "Summary", "Payment"];

export function CheckoutSteps({
  current,
  onStep,
}: {
  current: number;
  onStep?: (step: number) => void;
}) {
  return (
    <div className="mb-8 overflow-x-auto">
      <ol className="flex min-w-[480px] items-center">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;

          return (
            <li key={label} className="flex flex-1 items-center">
              <button
                type="button"
                disabled={!onStep}
                onClick={() => onStep?.(step)}
                className={cn(
                  "flex items-center gap-2 text-left",
                  onStep && "cursor-pointer"
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition",
                    done && "bg-brand-600 text-white",
                    active && "bg-brand-600 text-white ring-4 ring-brand-100",
                    !done && !active && "bg-slate-100 text-ink-subtle"
                  )}
                >
                  {done ? <Check className="h-4 w-4" /> : step}
                </span>
                <span
                  className={cn(
                    "hidden text-sm font-semibold sm:block",
                    active ? "text-brand-700" : done ? "text-ink-muted" : "text-ink-subtle"
                  )}
                >
                  {label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 flex-1 rounded",
                    step < current ? "bg-brand-400" : "bg-slate-200"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
