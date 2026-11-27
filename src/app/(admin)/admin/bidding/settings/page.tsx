"use client";

import { useEffect, useState } from "react";
import { BiddingTabs } from "@/components/admin/BiddingTabs";
import { Button } from "@/components/ui/Button";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

type Settings = {
  enabled: boolean;
  radiusStartKm: number;
  radiusMaxKm: number;
  radiusStepKm: number;
  radiusStepMins: number;
  maxStores: number;
  expiryHours: number;
  maxRounds: number;
  postPackBidWindowSecs: number;
  postPackRiderRadiusKm: number;
  betaEmails: string[];
};
type NumKey = Exclude<keyof Settings, "enabled" | "betaEmails">;

const FIELDS: { key: NumKey; label: string; unit: string; help: string }[] = [
  { key: "radiusStartKm", label: "Starting radius", unit: "km", help: "Stores this close to the customer get the list first." },
  { key: "radiusStepKm", label: "Widen by", unit: "km", help: "How much the radius grows when no store offers in time." },
  { key: "radiusStepMins", label: "Widen after", unit: "minutes", help: "Wait this long without an offer before widening." },
  { key: "radiusMaxKm", label: "Largest radius", unit: "km", help: "The radius never grows past this." },
  { key: "maxStores", label: "Stores per list", unit: "stores", help: "At most this many stores get each list." },
  {
    key: "expiryHours",
    label: "Offer window",
    unit: "hours",
    help: "Each round the customer has this long to accept an offer (48 by default). If they don't, the list restarts for a new round.",
  },
  {
    key: "maxRounds",
    label: "Max rounds",
    unit: "0 = unlimited",
    help: "After this many rounds without an accept the list closes as expired. 0 keeps restarting until accepted or cancelled.",
  },
  {
    key: "postPackBidWindowSecs",
    label: "Rider bidding window",
    unit: "seconds",
    help: "After the store packs a list order, riders bid for this long (re-opened once if nobody bids).",
  },
  {
    key: "postPackRiderRadiusKm",
    label: "Rider radius",
    unit: "km",
    help: "Riders this close to the store see the request (doubled on the re-open).",
  },
];

export default function AdminBiddingSettingsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [s, setS] = useState<Settings | null>(null);
  const [form, setForm] = useState<Record<NumKey, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");

  function apply(d: Settings) {
    setS(d);
    setForm(Object.fromEntries(FIELDS.map((f) => [f.key, String(d[f.key])])) as Record<NumKey, string>);
  }

  useEffect(() => {
    fetch("/api/admin/lists/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d.success ? apply(d.data) : setLoadError(d.error || "Couldn't load settings")))
      .catch(() => setLoadError("Couldn't load settings"));
  }, []);

  async function save(enabled: boolean, what: string) {
    if (!s || !form) return false;
    setBusy(true);
    setErrors({});
    try {
      const body = { enabled, ...Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key]])) };
      const res = await fetch("/api/admin/lists/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!d.success) {
        setErrors(d.fieldErrors || {});
        toast.error(d.error || "Couldn't save");
        return false;
      }
      apply(d.data);
      toast.success(d.data.changed?.length ? what : "Nothing changed");
      return true;
    } catch {
      toast.error("Network error. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (!s) return;
    const on = !s.enabled;
    const r = await confirm({
      title: on ? "Switch list bidding on for everyone?" : "Switch list bidding off?",
      message: on
        ? "Every customer will see “Send a list” and stores will get lists. Make sure testing is finished."
        : "Customers stop seeing “Send a list”. Lists already sent keep running until they close. Beta testers keep access.",
      confirmLabel: on ? "Switch on" : "Switch off",
      tone: on ? "default" : "danger",
    });
    if (!r.confirmed) return;
    await save(on, on ? "List bidding is on for everyone" : "List bidding is off for the public");
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <BiddingTabs />
      <h1 className="font-display text-3xl text-ink">List bidding settings</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Customers send shopping lists to nearby stores, stores make offers, and riders bid on packed list orders. Normal cart
        checkout is not affected by any setting here.
      </p>
      {loadError && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</p>}
      {!s || !form ? (
        !loadError && <div className="skeleton mt-6 h-64 rounded-2xl" />
      ) : (
        <>
          <section
            data-testid="bidding-switch"
            className={cn(
              "mt-6 flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between",
              s.enabled ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10" : "border-line bg-card"
            )}
          >
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                List bidding is <span data-testid="bidding-state">{s.enabled ? "ON" : "OFF"}</span> for the public
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {s.enabled
                  ? "Every signed-in customer can send a list."
                  : "Only the beta testers below can send lists while it is off."}
              </p>
            </div>
            <Button type="button" variant={s.enabled ? "outline" : "primary"} disabled={busy} onClick={() => void toggle()}>
              {s.enabled ? "Switch off" : "Switch on"}
            </Button>
          </section>

          <section className="mt-4 rounded-2xl border border-line bg-card p-5">
            <h2 className="text-sm font-bold text-ink">Beta testers</h2>
            <p className="mt-1 text-xs text-ink-subtle">Set in the LIST_BIDDING_BETA_EMAILS environment variable on the server.</p>
            {s.betaEmails.length ? (
              <ul className="mt-2 flex flex-wrap gap-2" data-testid="beta-emails">
                {s.betaEmails.map((e) => (
                  <li key={e} className="max-w-full break-all rounded-full bg-app px-3 py-1 text-xs text-ink-muted">
                    {e}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">No beta testers set.</p>
            )}
          </section>

          <form
            className="mt-4 rounded-2xl border border-line bg-card p-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void save(s.enabled, "Settings saved");
            }}
          >
            <h2 className="text-sm font-bold text-ink">Radius, timing and limits</h2>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="block min-w-0">
                  <span className="text-sm font-medium text-ink">
                    {f.label} <span className="font-normal text-ink-subtle">({f.unit})</span>
                  </span>
                  <input
                    inputMode="numeric"
                    name={f.key}
                    value={form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className={cn(
                      "mt-1 min-h-[44px] w-full rounded-xl border bg-card px-3 py-2 text-sm text-ink outline-none focus:border-brand-400",
                      errors[f.key] ? "border-red-400" : "border-line"
                    )}
                  />
                  <span className="mt-1 block text-xs text-ink-subtle">{f.help}</span>
                  {errors[f.key] && <span className="mt-1 block text-xs font-medium text-red-600">{errors[f.key]}</span>}
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
