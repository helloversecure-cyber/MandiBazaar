"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, PackageCheck, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type OrderInfo = { orderNumber: string; status: string; total: number };
type Outcome = "RECEIVED" | "NOT_RECEIVED" | "ISSUE";

export default function ConfirmDeliveryPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "used" | "expired" | "done">("loading");
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [choice, setChoice] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [doneOutcome, setDoneOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    fetch(`/api/orders/confirm-delivery?token=${encodeURIComponent(token)}`)
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (ok && data.success) {
          setOrder(data.data);
          setState("ready");
        } else {
          const reason = data?.error;
          setState(reason === "used" ? "used" : reason === "expired" ? "expired" : "invalid");
        }
      })
      .catch(() => setState("invalid"));
  }, [token]);

  async function submit() {
    if (!choice || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/orders/confirm-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, outcome: choice, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setDoneOutcome(choice);
        setState("done");
      } else {
        setError(data.error || "Could not submit. Please try again.");
      }
    } catch {
      setError("Could not submit. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-4 py-10">
      <div className="overflow-hidden rounded-3xl border border-line bg-card shadow-card">
        {/* Header band */}
        <div className="bg-hero-gradient px-6 py-7 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/20">
            <PackageCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-black text-white">Confirm your delivery</h1>
          {order && <p className="mt-1 text-sm text-emerald-50/85">Order {order.orderNumber}</p>}
        </div>

        <div className="p-6">
          {state === "loading" && (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-subtle">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your link…
            </p>
          )}

          {(state === "invalid" || state === "used" || state === "expired") && (
            <div className="py-6 text-center">
              <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
              <p className="mt-3 font-bold text-ink">
                {state === "used"
                  ? "Already confirmed"
                  : state === "expired"
                    ? "This link has expired"
                    : "This link is not valid"}
              </p>
              <p className="mt-1 text-sm text-ink-subtle">
                {state === "used"
                  ? "Thanks — this delivery was already confirmed."
                  : "You can still see your order and get help from your account."}
              </p>
              <Link
                href="/account/orders"
                className="mt-5 inline-flex rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
              >
                View my orders
              </Link>
            </div>
          )}

          {state === "done" && (
            <div className="py-6 text-center">
              {doneOutcome === "RECEIVED" ? (
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              ) : (
                <AlertTriangle className="mx-auto h-12 w-12 text-amber-500" />
              )}
              <p className="mt-3 text-lg font-black text-ink">
                {doneOutcome === "RECEIVED" ? "Thank you!" : "We're on it"}
              </p>
              <p className="mt-1 text-sm text-ink-subtle">
                {doneOutcome === "RECEIVED"
                  ? "Glad your order arrived. Enjoy!"
                  : "Thanks for letting us know — MandiBazaar will look into this and follow up."}
              </p>
              <Link
                href="/account/orders"
                className="mt-5 inline-flex rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
              >
                View my orders
              </Link>
            </div>
          )}

          {state === "ready" && order && (
            <>
              <p className="text-center text-sm text-ink-muted">
                Your order total is{" "}
                <span className="font-bold text-ink">{formatCurrency(order.total)}</span>. Did it arrive?
              </p>

              <div className="mt-5 space-y-2.5">
                {([
                  { key: "RECEIVED", icon: CheckCircle2, label: "Yes, I received it", tone: "emerald" },
                  { key: "NOT_RECEIVED", icon: XCircle, label: "No, I haven't received it", tone: "red" },
                  { key: "ISSUE", icon: AlertTriangle, label: "Received, but there's a problem", tone: "amber" },
                ] as const).map((opt) => {
                  const active = choice === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setChoice(opt.key)}
                      className={`press flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition ${
                        active
                          ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500 dark:bg-brand-500/10"
                          : "border-line bg-card hover:border-brand-300"
                      }`}
                    >
                      <opt.icon
                        className={`h-5 w-5 shrink-0 ${
                          opt.tone === "emerald"
                            ? "text-emerald-500"
                            : opt.tone === "red"
                              ? "text-red-500"
                              : "text-amber-500"
                        }`}
                      />
                      <span className="text-sm font-semibold text-ink">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {(choice === "NOT_RECEIVED" || choice === "ISSUE") && (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Tell us what happened (optional)…"
                  className="mt-3 w-full rounded-xl border border-line bg-app p-3 text-sm text-ink outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              )}

              {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

              <button
                type="button"
                disabled={!choice || submitting}
                onClick={submit}
                className="press mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit
              </button>
              <p className="mt-3 text-center text-xs text-ink-subtle">
                This secure link can be used once.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
