"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FieldError, FormError } from "@/components/ui/FieldError";
import { useToast } from "@/components/ui/feedback";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { VEHICLE_TYPES } from "@/lib/validators/pk";
import { riderProfileUpdateSchema } from "@/lib/portal/rider-profile";

type Profile = {
  name: string;
  phone: string;
  city: string | null;
  vehicleType: string;
  status: string;
  approvalStatus: string;
  reviewNotes: string | null;
  cnicMasked: string | null;
  accountNumberMasked: string | null;
  accountTitle: string | null;
  bankName: string | null;
  jazzCashNumberMasked: string | null;
  documents: Record<string, boolean>;
};

const inputCls = (invalid?: boolean) =>
  `mt-1 w-full rounded-xl border bg-card px-3 py-2.5 text-sm outline-none ${
    invalid ? "border-red-400" : "border-line focus:border-emerald-400"
  }`;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
      <span className="text-ink-subtle">{label}</span>
      <span className="text-right font-medium text-ink">{value || "—"}</span>
    </div>
  );
}

export default function RiderProfilePage() {
  const toast = useToast();
  const fe = useFieldErrors();
  const [p, setP] = useState<Profile | null>(null);
  const [vehicleType, setVehicleType] = useState("");
  const [accountTitle, setAccountTitle] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [jazzCashNumber, setJazzCashNumber] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/rider?resource=profile", { cache: "no-store" });
    const json = await res.json();
    if (json.success) {
      const r: Profile = json.data.rider;
      setP(r);
      setVehicleType(r.vehicleType || "");
      setAccountTitle(r.accountTitle || "");
      setBankName(r.bankName || "");
      setAccountNumber("");
      setJazzCashNumber("");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const values = {
      vehicleType: vehicleType !== p?.vehicleType ? vehicleType : "",
      accountTitle: accountTitle !== (p?.accountTitle || "") ? accountTitle : "",
      bankName: bankName !== (p?.bankName || "") ? bankName : "",
      accountNumber,
      jazzCashNumber,
    };
    if (!fe.check(riderProfileUpdateSchema, values)) return;
    setSaving(true);
    try {
      const res = await fetch("/api/rider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "UPDATE_PROFILE", ...values }),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        return;
      }
      toast.success("Profile updated");
      fe.clear();
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!p) return <p className="text-ink-subtle">Loading…</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-extrabold text-ink">My profile</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        Your rider details. To change your name, phone, city or CNIC, contact MandiBazaar.
      </p>

      <section className="mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm">
        <h2 className="mb-2 font-bold text-ink">Details</h2>
        <Row label="Name" value={p.name} />
        <Row label="Phone" value={p.phone} />
        <Row label="City" value={p.city} />
        <Row label="CNIC" value={p.cnicMasked} />
        <Row label="Vehicle" value={p.vehicleType} />
        <Row
          label="Account status"
          value={
            p.approvalStatus === "APPROVED"
              ? "Approved"
              : p.approvalStatus === "REJECTED"
                ? `Rejected${p.reviewNotes ? ` — ${p.reviewNotes}` : ""}`
                : "Waiting for MandiBazaar approval"
          }
        />
        <h3 className="mb-1 mt-4 text-sm font-bold text-ink">Payout details</h3>
        <Row label="Account holder" value={p.accountTitle} />
        <Row label="Bank" value={p.bankName} />
        <Row label="Bank account / IBAN" value={p.accountNumberMasked} />
        <Row label="JazzCash" value={p.jazzCashNumberMasked} />
      </section>

      <form onSubmit={save} noValidate className="mt-6 space-y-4 rounded-2xl border border-line bg-card p-5 shadow-sm">
        <h2 className="font-bold text-ink">Update vehicle &amp; payout details</h2>
        <p className="text-xs text-ink-subtle">
          Leave a number empty to keep the one saved now. Keep at least one payout
          method (bank account or JazzCash).
        </p>

        <div>
          <label className="text-sm font-medium text-ink-muted" htmlFor="vehicleType">Vehicle type</label>
          <select
            id="vehicleType"
            className={inputCls(fe.has("vehicleType"))}
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
          >
            {!VEHICLE_TYPES.includes(vehicleType as (typeof VEHICLE_TYPES)[number]) && (
              <option value={vehicleType}>{vehicleType || "Choose vehicle"}</option>
            )}
            {VEHICLE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <FieldError message={fe.get("vehicleType")} />
        </div>

        <div>
          <label className="text-sm font-medium text-ink-muted" htmlFor="accountTitle">Account holder name</label>
          <input
            id="accountTitle"
            className={inputCls(fe.has("accountTitle"))}
            maxLength={60}
            value={accountTitle}
            onChange={(e) => setAccountTitle(e.target.value)}
          />
          <FieldError message={fe.get("accountTitle")} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-ink-muted" htmlFor="bankName">Bank name</label>
            <input
              id="bankName"
              className={inputCls(fe.has("bankName"))}
              maxLength={80}
              placeholder="e.g. HBL"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
            <FieldError message={fe.get("bankName")} />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-muted" htmlFor="accountNumber">New bank account / IBAN</label>
            <input
              id="accountNumber"
              className={inputCls(fe.has("accountNumber"))}
              inputMode="text"
              maxLength={34}
              placeholder={p.accountNumberMasked ? `Saved: ${p.accountNumberMasked}` : "10–20 digits or PK… IBAN"}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
            <FieldError message={fe.get("accountNumber")} />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-ink-muted" htmlFor="jazzCashNumber">New JazzCash number</label>
          <input
            id="jazzCashNumber"
            className={inputCls(fe.has("jazzCashNumber"))}
            inputMode="tel"
            maxLength={16}
            placeholder={p.jazzCashNumberMasked ? `Saved: ${p.jazzCashNumberMasked}` : "03001234567"}
            value={jazzCashNumber}
            onChange={(e) => setJazzCashNumber(e.target.value)}
          />
          <FieldError message={fe.get("jazzCashNumber")} />
        </div>

        <FormError message={fe.formError} />
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </div>
  );
}
