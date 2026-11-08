"use client";

import { useEffect, useState } from "react";
import { FieldError, FormError, inputClass } from "@/components/ui/FieldError";
import { useConfirm, useToast } from "@/components/ui/feedback";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import {
  formatSettingValue,
  PRICE_SETTING_FIELDS,
  settingsChanges,
  settingsSchema,
} from "@/lib/admin/form-rules";

type FormState = {
  businessName: string;
  phone: string;
  email: string;
  address: string;
  defaultDeliveryFee: string;
  deliveryRatePerKm: string;
  maxDeliveryFee: string;
  freeDeliveryThreshold: string;
  minimumOrderAmount: string;
  platformCommissionPct: string;
  fullCodMaxOrderAmount: string;
  riderBaseFee: string;
  riderPerKmFee: string;
  remittanceDeadlineHours: string;
  cashHandoverInstructions: string;
};

const EMPTY: FormState = {
  businessName: "",
  phone: "",
  email: "",
  address: "",
  defaultDeliveryFee: "",
  deliveryRatePerKm: "",
  maxDeliveryFee: "",
  freeDeliveryThreshold: "",
  minimumOrderAmount: "",
  platformCommissionPct: "",
  fullCodMaxOrderAmount: "",
  riderBaseFee: "",
  riderPerKmFee: "",
  remittanceDeadlineHours: "",
  cashHandoverInstructions: "",
};

const REMITTANCE: FieldDef[] = [
  { key: "remittanceDeadlineHours", label: "COD remittance deadline", type: "number", suffix: "hours", min: 1, max: 168, step: "1", hint: "Hours a rider has to remit collected cash before being auto-restricted. Default 48." },
];

type FieldDef = {
  key: keyof FormState;
  label: string;
  hint?: string;
  type?: "text" | "tel" | "email" | "number";
  prefix?: string;
  suffix?: string;
  step?: string;
  min?: number;
  max?: number;
  optional?: boolean;
};

const BUSINESS: FieldDef[] = [
  { key: "businessName", label: "Business name" },
  { key: "phone", label: "Support phone", type: "tel", hint: "e.g. 042-35761234, 111-626-334 or 03001234567", optional: true },
  { key: "email", label: "Support email", type: "email", optional: true },
  { key: "address", label: "Address", optional: true },
];

const PRICING: FieldDef[] = [
  { key: "defaultDeliveryFee", label: "Default delivery fee", type: "number", prefix: "Rs", min: 0, max: 5000, step: "1", hint: "Used when the distance can't be calculated. Rs 0–5,000." },
  { key: "deliveryRatePerKm", label: "Delivery rate per km", type: "number", prefix: "Rs", suffix: "/km", min: 0, max: 500, step: "0.01", hint: "Rs 0–500 per km." },
  { key: "maxDeliveryFee", label: "Maximum delivery fee", type: "number", prefix: "Rs", min: 0, max: 10000, step: "1", hint: "Optional cap for distance-based fees. Leave empty for no cap.", optional: true },
  { key: "freeDeliveryThreshold", label: "Free-delivery threshold", type: "number", prefix: "Rs", min: 0, step: "1", hint: "Orders at or above this get free delivery. Leave empty to turn off.", optional: true },
  { key: "minimumOrderAmount", label: "Minimum order amount", type: "number", prefix: "Rs", min: 0, step: "1", hint: "Whole rupees. 0 = no minimum." },
  { key: "platformCommissionPct", label: "Platform commission", type: "number", suffix: "%", min: 0, max: 50, step: "0.01", hint: "Taken from store sales at payout. 0–50%." },
  { key: "fullCodMaxOrderAmount", label: "Full cash-on-delivery limit", type: "number", prefix: "Rs", min: 0, max: 100000, step: "1", hint: "Orders with products up to this amount may pay the delivery fee in cash too. 0 = off." },
  { key: "riderBaseFee", label: "Rider pay per delivery", type: "number", prefix: "Rs", min: 0, max: 5000, step: "1", hint: "Fixed amount a rider earns for each delivered order." },
  { key: "riderPerKmFee", label: "Rider pay per km", type: "number", prefix: "Rs", suffix: "/km", min: 0, max: 500, step: "0.01", hint: "Extra rider pay per km of delivery distance. 0 = flat pay only." },
];

function toForm(d: Record<string, unknown>): FormState {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    businessName: s(d.businessName),
    phone: s(d.phone),
    email: s(d.email),
    address: s(d.address),
    defaultDeliveryFee: s(d.defaultDeliveryFee),
    deliveryRatePerKm: s(d.deliveryRatePerKm),
    maxDeliveryFee: s(d.maxDeliveryFee),
    freeDeliveryThreshold: s(d.freeDeliveryThreshold),
    minimumOrderAmount: s(d.minimumOrderAmount),
    platformCommissionPct: s(d.platformCommissionPct),
    fullCodMaxOrderAmount: s(d.fullCodMaxOrderAmount),
    riderBaseFee: s(d.riderBaseFee),
    riderPerKmFee: s(d.riderPerKmFee),
    remittanceDeadlineHours: s(d.remittanceDeadlineHours),
    cashHandoverInstructions: s(d.cashHandoverInstructions),
  };
}

const ALL_REMIT_METHODS = ["CASH_HANDOVER", "BANK", "JAZZCASH"] as const;
const REMIT_METHOD_LABEL: Record<string, string> = { CASH_HANDOVER: "Cash handover", BANK: "Bank transfer", JAZZCASH: "JazzCash" };

export default function AdminSettingsPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const fe = useFieldErrors();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [methods, setMethods] = useState<string[]>([...ALL_REMIT_METHODS]);
  const [saved, setSaved] = useState<Record<string, unknown> | null>(null);
  const [jazzConfigured, setJazzConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin?resource=settings")
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          setForm(toForm(d.data));
          if (Array.isArray(d.data.remittanceMethods) && d.data.remittanceMethods.length) setMethods(d.data.remittanceMethods);
          setSaved(d.data);
          setJazzConfigured(Boolean(d.data.jazzCashConfigured));
        } else if (d.success) {
          setForm({ ...EMPTY, businessName: "MandiBazaar" });
        } else {
          fe.setFormError(d.error || "Could not load settings");
        }
      })
      .catch(() => fe.setFormError("Could not load settings. Check your connection."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!fe.check(settingsSchema, form)) return;
    const parsed = settingsSchema.parse(form);
    const priceChanges = settingsChanges(saved, parsed as unknown as Record<string, unknown>, PRICE_SETTING_FIELDS);
    if (priceChanges.length) {
      const r = await confirm({
        title: "Change prices for every customer?",
        message: (
          <>
            <p>These settings change what customers and stores pay from the next order:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {priceChanges.map((c) => (
                <li key={c.field}>
                  {c.label}: <strong>{formatSettingValue(c.field, c.from)}</strong> →{" "}
                  <strong>{formatSettingValue(c.field, c.to)}</strong>
                </li>
              ))}
            </ul>
          </>
        ),
        confirmLabel: "Yes, save changes",
        tone: "danger",
      });
      if (!r.confirmed) return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "settings", data: { ...form, remittanceMethods: methods } }),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        return;
      }
      fe.clear();
      const next = { ...(saved || {}), ...parsed };
      setSaved(next);
      setForm(toForm(next));
      toast.success(data.data?.changes?.length ? "Settings saved" : "No changes to save");
    } catch {
      fe.setFormError("Could not save settings. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  function field(f: FieldDef) {
    const err = fe.get(f.key);
    return (
      <label key={f.key} className="block text-sm">
        <span className="font-medium text-ink">
          {f.label}
          {f.optional ? <span className="font-normal text-ink-subtle"> (optional)</span> : null}
        </span>
        <span className="mt-1 flex items-center gap-2">
          {f.prefix && <span className="text-ink-subtle">{f.prefix}</span>}
          <input
            type={f.type || "text"}
            inputMode={f.type === "number" ? "decimal" : undefined}
            step={f.step}
            min={f.min}
            max={f.max}
            className={inputClass(Boolean(err), "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2")}
            aria-invalid={Boolean(err)}
            value={form[f.key]}
            onChange={(e) => {
              setForm({ ...form, [f.key]: e.target.value });
              fe.clear(f.key);
            }}
          />
          {f.suffix && <span className="whitespace-nowrap text-ink-subtle">{f.suffix}</span>}
        </span>
        {f.hint && !err && <span className="mt-1 block text-xs text-ink-subtle">{f.hint}</span>}
        <FieldError message={err} />
      </label>
    );
  }

  if (loading) return <p className="text-sm text-ink-subtle">Loading settings…</p>;

  return (
    <div>
      <h1 className="font-display text-3xl">Settings</h1>
      <form onSubmit={save} noValidate className="mt-6 max-w-xl space-y-6 rounded-3xl bg-card p-6 shadow-card">
        <section className="space-y-3">
          <h2 className="font-semibold text-ink">Business details</h2>
          {BUSINESS.map(field)}
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold text-ink">Delivery, payments, commission &amp; rider pay</h2>
          {PRICING.map(field)}
        </section>
        <section className="space-y-3">
          <h2 className="font-semibold text-ink">COD cash remittance</h2>
          {REMITTANCE.map(field)}
          <div>
            <p className="text-sm font-medium text-ink">Remittance methods riders can use</p>
            <div className="mt-2 flex flex-wrap gap-3">
              {ALL_REMIT_METHODS.map((m) => (
                <label key={m} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={methods.includes(m)}
                    onChange={(e) =>
                      setMethods((prev) => (e.target.checked ? Array.from(new Set([...prev, m])) : prev.filter((x) => x !== m)))
                    }
                  />
                  {REMIT_METHOD_LABEL[m]}
                </label>
              ))}
            </div>
            {methods.length === 0 && <p className="mt-1 text-xs text-red-600">Enable at least one method, or riders can&apos;t remit.</p>}
          </div>
          <div>
            <p className="text-sm font-medium text-ink">Cash handover instructions</p>
            <textarea
              value={form.cashHandoverInstructions}
              onChange={(e) => setForm((f) => ({ ...f, cashHandoverInstructions: e.target.value }))}
              maxLength={500}
              rows={3}
              placeholder="e.g. Hand cash to the supervisor at the MandiBazaar hub, Gulberg — Mon–Sat 10am–6pm."
              className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
            />
            <p className="mt-1 text-xs text-ink-subtle">
              Shown to riders on the cash-handover screen. Enter your own bank/JazzCash details and supervisor info here — MandiBazaar never invents them.
            </p>
          </div>
        </section>
        <div className="rounded-2xl bg-brand-50 dark:bg-brand-500/10 p-4 text-sm">
          <p className="font-medium">JazzCash</p>
          <p className="mt-1 text-ink-subtle">
            Credentials are stored in environment variables only and are never shown here.
          </p>
          <p className="mt-2">
            Status:{" "}
            <strong>
              {jazzConfigured ? "Configured" : "Not configured — customers upload a receipt manually"}
            </strong>
          </p>
        </div>
        <FormError message={fe.formError} />
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-brand-600 px-5 py-2.5 text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </form>
    </div>
  );
}
