"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { ImageUploadField } from "@/components/ui/ImageUploadField";
import { RequiredMark } from "@/components/ui/FieldLabel";
import { FieldError, FormError } from "@/components/ui/FieldError";
import { SelectField, TextField, scrollToFirstError } from "@/components/auth/FormField";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { PK_CITIES, VEHICLE_TYPES } from "@/lib/validators/pk";
import { RIDER_DOC_FIELDS, validateRiderSignup } from "@/lib/validators/signup-forms";
import { formatMobile } from "@/lib/forms/masks";
import { VerifyEmailNotice } from "@/components/auth/VerifyEmailNotice";

type RiderForm = {
  fullName: string;
  phone: string;
  email: string;
  password: string;
  city: string;
  vehicleType: string;
  cnicNumber: string;
  accountTitle: string;
  accountNumber: string;
  bankName: string;
  jazzCashNumber: string;
  photoUrl: string;
  cnicUrl: string;
  cnicBackUrl: string;
  licenseUrl: string;
  bikeUrl: string;
  bikeCardUrl: string;
};

const DOC_UI: Record<
  (typeof RIDER_DOC_FIELDS)[number][0],
  { label: string; kind: "profile" | "business"; capture?: "user"; hint?: string }
> = {
  photoUrl: {
    label: "Rider photo (selfie)",
    kind: "profile",
    capture: "user",
    hint: "Camera opens for a live selfie · optimized to ≤1MB",
  },
  cnicUrl: { label: "CNIC front", kind: "business" },
  cnicBackUrl: { label: "CNIC back", kind: "business" },
  licenseUrl: { label: "Driving licence photo", kind: "business" },
  bikeUrl: { label: "Bike / vehicle photo", kind: "business" },
  bikeCardUrl: { label: "Bike card (registration / RC)", kind: "business" },
};

export default function RiderRegisterPage() {
  const [form, setForm] = useState<RiderForm>({
    fullName: "",
    phone: "",
    email: "",
    password: "",
    city: "Lahore",
    vehicleType: "Bike",
    cnicNumber: "",
    accountTitle: "",
    accountNumber: "",
    bankName: "",
    jazzCashNumber: "",
    photoUrl: "",
    cnicUrl: "",
    cnicBackUrl: "",
    licenseUrl: "",
    bikeUrl: "",
    bikeCardUrl: "",
  });
  const fe = useFieldErrors();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ email: string; devLink?: string } | null>(null);

  function set<K extends keyof RiderForm>(key: K, value: RiderForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    fe.clear(key);
    if (key === "jazzCashNumber") fe.clear("accountNumber");
  }

  function showErrors(errors: Record<string, string>) {
    fe.setErrors(errors);
    const missingDocs = RIDER_DOC_FIELDS.filter(([k]) => errors[k]).length;
    fe.setFormError(
      missingDocs
        ? `Please fix the highlighted fields and upload ${missingDocs} required photo${missingDocs === 1 ? "" : "s"}`
        : "Please fix the highlighted fields"
    );
    scrollToFirstError(errors);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateRiderSignup(form);
    if (!v.success) {
      showErrors(v.errors);
      return;
    }
    fe.clear();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register-rider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.fieldErrors && Object.keys(data.fieldErrors).length) {
          showErrors(data.fieldErrors);
        } else {
          fe.fromResponse(data);
        }
        return;
      }
      setDone({ email: data.data?.email || form.email.trim(), devLink: data.data?.devLink });
    } catch {
      fe.setFormError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <ShopContainer width="md" className="flex min-h-[70vh] flex-col justify-center py-10">
        <VerifyEmailNotice email={done.email} devLink={done.devLink} password={form.password} />
      </ShopContainer>
    );
  }

  return (
    <ShopContainer width="md" className="flex min-h-[70vh] flex-col justify-center py-10">
      <div className="rounded-2xl border border-line bg-card p-6 shadow-card sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-xs font-black text-white shadow-sm">
            MB
          </div>
          <div>
            <p className="text-xl font-extrabold text-ink">Rider signup</p>
            <p className="text-xs text-ink-subtle">
              Photos + account details → approval → then deliver
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-6" noValidate>
          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-subtle">Account</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                name="fullName"
                label="Full name"
                required
                placeholder="e.g. Bilal Ahmed"
                autoComplete="name"
                maxLength={60}
                value={form.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                error={fe.get("fullName")}
              />
              <TextField
                name="phone"
                label="Mobile number (login ID)"
                required
                type="tel"
                inputMode="tel"
                placeholder="03001234567"
                autoComplete="tel"
                maxLength={13}
                hint="03XXXXXXXXX or +92 then 10 digits"
                value={form.phone}
                onChange={(e) => set("phone", formatMobile(e.target.value))}
                error={fe.get("phone")}
              />
              <TextField
                name="email"
                label="Email"
                required
                type="email"
                inputMode="email"
                placeholder="e.g. bilal@gmail.com"
                autoComplete="email"
                maxLength={100}
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                error={fe.get("email")}
              />
              <TextField
                name="password"
                label="Password"
                required
                type="password"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                maxLength={64}
                hint="8–64 characters with a letter and a number"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                error={fe.get("password")}
              />
              <SelectField
                name="city"
                label="City"
                required
                options={PK_CITIES}
                placeholder="Choose your city"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                error={fe.get("city")}
              />
              <SelectField
                name="vehicleType"
                label="Vehicle"
                required
                options={VEHICLE_TYPES}
                placeholder="Choose your vehicle"
                value={form.vehicleType}
                onChange={(e) => set("vehicleType", e.target.value)}
                error={fe.get("vehicleType")}
              />
              <TextField
                name="cnicNumber"
                label="CNIC number"
                required
                inputMode="numeric"
                placeholder="35202-1234567-1"
                maxLength={15}
                hint="13 digits, e.g. 35202-1234567-1"
                value={form.cnicNumber}
                onChange={(e) => set("cnicNumber", e.target.value)}
                error={fe.get("cnicNumber")}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-subtle">
              Photos for approval
            </h2>
            <p className="text-xs text-ink-subtle">
              These photos are reviewed before you can deliver. Rider photo opens the camera directly.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {RIDER_DOC_FIELDS.map(([key]) => {
                const ui = DOC_UI[key];
                return (
                  <div key={key} data-field={key}>
                    <ImageUploadField
                      label={ui.label}
                      value={form[key]}
                      onChange={(url) => set(key, url)}
                      folder="riders"
                      kind={ui.kind}
                      required
                      capture={ui.capture}
                      hint={ui.hint}
                    />
                    <FieldError message={fe.get(key)} />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-subtle">
              Payout account (payouts / remittance)
            </h2>
            <p className="text-xs text-amber-700">
              At least one is required
              <RequiredMark />: bank account / IBAN or JazzCash.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                name="accountTitle"
                label="Account title"
                placeholder="Name on the account"
                maxLength={80}
                value={form.accountTitle}
                onChange={(e) => set("accountTitle", e.target.value)}
                error={fe.get("accountTitle")}
              />
              <TextField
                name="accountNumber"
                label="Bank account number or IBAN"
                placeholder="0012345678901 or PK36SCBL…"
                maxLength={34}
                hint="10–20 digits, or a 24-character IBAN starting with PK"
                value={form.accountNumber}
                onChange={(e) => set("accountNumber", e.target.value)}
                error={fe.get("accountNumber")}
              />
              <TextField
                name="bankName"
                label="Bank name (optional)"
                placeholder="e.g. Meezan Bank"
                maxLength={80}
                value={form.bankName}
                onChange={(e) => set("bankName", e.target.value)}
                error={fe.get("bankName")}
              />
              <TextField
                name="jazzCashNumber"
                label="JazzCash number"
                type="tel"
                inputMode="tel"
                placeholder="03001234567"
                maxLength={16}
                value={form.jazzCashNumber}
                onChange={(e) => set("jazzCashNumber", e.target.value)}
                error={fe.get("jazzCashNumber")}
              />
            </div>
          </section>

          <FormError message={fe.formError} />
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Submitting…" : "Submit for approval"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-subtle">
          Already a rider?{" "}
          <Link href="/login?portal=rider" className="font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </div>
    </ShopContainer>
  );
}
