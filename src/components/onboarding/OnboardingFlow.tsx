"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ChevronLeft, ChevronRight, Check, ExternalLink, Lightbulb, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OnboardingStep } from "@/lib/onboarding/flows";

export type { OnboardingStep };

const LS_KEY = "mb_onboarding_step";

export function OnboardingFlow({
  title,
  subtitle,
  steps,
  finishLabel,
  onFinish,
  onSkip,
  skipHref,
  persistProgress = false,
}: {
  title: string;
  subtitle: string;
  steps: OnboardingStep[];
  finishLabel: string;
  onFinish: () => Promise<void> | void;
  /** Saves "skipped" on the account (so the tour is not shown again), then leaves. */
  onSkip?: () => Promise<void> | void;
  /** @deprecated use onSkip — a plain link does not save anything. */
  skipHref?: string;
  /**
   * When true, the current step is saved to the server (DB = source of truth) so a
   * refresh / closed browser / another device resumes from the last saved step.
   */
  persistProgress?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  // Until we've loaded the saved step (persist mode), don't flash step 1.
  const [ready, setReady] = useState(!persistProgress);
  const lastSaved = useRef<number>(-1);

  // Load the saved step once. Server wins; localStorage is only an offline buffer.
  useEffect(() => {
    if (!persistProgress) return;
    let alive = true;
    (async () => {
      let resume = 0;
      try {
        const res = await fetch("/api/auth/onboarding", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (data?.success && Number.isFinite(data.data?.currentStep)) {
          resume = Number(data.data.currentStep);
          // If a local save didn't reach the server, localStorage may be ahead —
          // don't discard that progress.
          const ls = Number(localStorage.getItem(LS_KEY));
          if (Number.isFinite(ls) && ls > resume) resume = ls;
        } else {
          const ls = Number(localStorage.getItem(LS_KEY));
          if (Number.isFinite(ls)) resume = ls;
        }
      } catch {
        const ls = Number(localStorage.getItem(LS_KEY));
        if (Number.isFinite(ls)) resume = ls;
      }
      if (!alive) return;
      setStep(Math.min(Math.max(0, resume), steps.length - 1));
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [persistProgress, steps.length]);

  const save = useCallback(
    (next: number) => {
      if (!persistProgress || lastSaved.current === next) return;
      lastSaved.current = next;
      try {
        localStorage.setItem(LS_KEY, String(next));
      } catch {
        /* private mode — ignore */
      }
      // Fire-and-forget with one retry; a failed save still resumes from localStorage.
      const put = () =>
        fetch("/api/auth/onboarding", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: next }),
        });
      put().catch(() => {
        setTimeout(() => void put().catch(() => {}), 1500);
      });
    },
    [persistProgress]
  );

  const go = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(0, next), steps.length - 1);
      setStep(clamped);
      save(clamped);
    },
    [save, steps.length]
  );

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const progress = Math.round(((step + 1) / steps.length) * 100);

  if (!ready) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your progress…
      </div>
    );
  }

  async function handleFinish() {
    setLoading(true);
    try {
      await onFinish();
    } finally {
      setLoading(false);
    }
  }

  const canSkip = Boolean(onSkip || skipHref);
  async function handleSkip() {
    setLoading(true);
    try {
      if (onSkip) await onSkip();
      else if (skipHref) window.location.assign(skipHref);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[85vh] max-w-xl flex-col justify-center px-4 py-8">
      <div className="overflow-hidden rounded-2xl border border-surface-border bg-white shadow-card">
        {/* Header */}
        <div className="bg-brand-gradient px-6 py-7 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex shrink-0 flex-col items-start gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-xs font-black">
                MB
              </div>
              {canSkip && !isLast && (
                <button
                  type="button"
                  onClick={() => void handleSkip()}
                  disabled={loading}
                  className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white hover:bg-white/30 disabled:opacity-60"
                >
                  Skip tour
                </button>
              )}
            </div>
            <div className="min-w-0 flex-1 text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-100">
                Step {step + 1} of {steps.length}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
          <div className="mt-5 text-center">
            <div className="text-5xl">{current.emoji}</div>
            <h1 className="mt-3 text-xl font-black">{title}</h1>
            <p className="mt-1 text-sm text-emerald-100">{subtitle}</p>
          </div>
        </div>

        {/* Step nav pills */}
        <div className="flex gap-1 overflow-x-auto border-b border-surface-border bg-slate-50 px-3 py-2">
          {steps.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition",
                i === step
                  ? "bg-brand-600 text-white"
                  : i < step
                    ? "bg-brand-100 text-brand-800"
                    : "bg-white text-slate-400 ring-1 ring-line"
              )}
            >
              {s.emoji} {i + 1}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-7">
          <h2 className="text-2xl font-extrabold text-slate-900">{current.title}</h2>
          <p className="mt-3 leading-relaxed text-slate-600">{current.description}</p>

          {current.bullets && current.bullets.length > 0 && (
            <ul className="mt-5 space-y-2.5">
              {current.bullets.map((b, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">
                    ✓
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          {current.tip && (
            <div className="mt-5 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>{current.tip}</span>
            </div>
          )}

          {current.link && (
            <Link
              href={current.link.href}
              target={current.link.href.startsWith("http") ? "_blank" : undefined}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              {current.link.label}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-surface-border px-6 py-4">
          <button
            type="button"
            disabled={step === 0 || loading}
            onClick={() => go(step - 1)}
            className="flex items-center gap-1 text-sm font-semibold text-slate-500 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-3">
            {canSkip && !isLast && (
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={loading}
                className="text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Skip
              </button>
            )}
            {isLast ? (
              <Button onClick={handleFinish} disabled={loading}>
                <Check className="mr-2 h-4 w-4" />
                {loading ? "Please wait…" : finishLabel}
              </Button>
            ) : (
              <Button onClick={() => go(step + 1)}>
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        MandiBazaar · {steps.length} steps · you can reopen this guide any time from the menu (“Guide”)
      </p>
    </div>
  );
}
