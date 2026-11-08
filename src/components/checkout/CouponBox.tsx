"use client";

import Link from "next/link";
import { CheckCircle2, Tag, X } from "lucide-react";

export type CouponState = {
  code: string;
  applied: boolean;
  discount: number;
  message: string;
  reason?: string;
  shortBy?: number;
} | null;

const COUPON_STORAGE_KEY = "mb_coupon_code";

/** Remember the applied code between cart and checkout (per tab). */
export function rememberCoupon(code: string | null) {
  try {
    if (code) sessionStorage.setItem(COUPON_STORAGE_KEY, code);
    else sessionStorage.removeItem(COUPON_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
}

export function recallCoupon(): string {
  try {
    return sessionStorage.getItem(COUPON_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

/**
 * Coupon input with the exact reason under it (QA M6/S8/T1) and a green
 * "Coupon applied — you saved Rs X" with Remove. Used in cart and checkout.
 */
export function CouponBox({
  value,
  onChange,
  onApply,
  onRemove,
  state,
  busy,
  isGuest,
  signInHref = "/login?callbackUrl=/cart",
}: {
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
  onRemove: () => void;
  state: CouponState;
  busy?: boolean;
  isGuest?: boolean;
  signInHref?: string;
}) {
  if (state?.applied) {
    return (
      <div
        className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800"
        role="status"
      >
        <div className="flex min-w-0 items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">{state.code}</p>
            <p className="text-xs">
              Coupon applied — you saved Rs {state.discount.toLocaleString("en-PK")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Remove
        </button>
      </div>
    );
  }

  const error = state && !state.applied ? state.message : "";
  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onApply();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
          <input
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            placeholder="Coupon code"
            maxLength={30}
            aria-label="Coupon code"
            aria-invalid={Boolean(error)}
            className={`w-full rounded-xl border bg-app py-2.5 pl-9 pr-3 text-sm uppercase outline-none focus:bg-card focus:ring-2 ${
              error
                ? "border-red-400 focus:ring-red-200"
                : "border-line focus:border-brand-400 focus:ring-brand-100"
            }`}
          />
        </div>
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="shrink-0 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-ink-muted hover:bg-slate-200 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Apply"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">
          {error}
          {state?.reason === "PHONE_NOT_VERIFIED" && (
            <>
              {" "}
              <Link href="/account" className="underline">
                Verify phone
              </Link>
            </>
          )}
          {isGuest && state?.reason === "SIGN_IN" && (
            <>
              {" "}
              <Link href={signInHref} className="underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      )}
      {isGuest && !error && (
        <p className="mt-1.5 text-xs text-ink-subtle">
          Have a coupon?{" "}
          <Link href={signInHref} className="font-semibold text-brand-700 underline">
            Sign in
          </Link>{" "}
          to use it on your order.
        </p>
      )}
    </div>
  );
}
