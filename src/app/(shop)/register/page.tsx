"use client";

import { useState } from "react";
import Link from "next/link";
import { Store, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { FormError } from "@/components/ui/FieldError";
import { TextField, scrollToFirstError } from "@/components/auth/FormField";
import { useFieldErrors } from "@/lib/forms/use-field-errors";
import { registerSchema } from "@/lib/validators/schemas";
import { validateFields } from "@/lib/validators/pk";
import { formatMobile } from "@/lib/forms/masks";
import { VerifyEmailNotice } from "@/components/auth/VerifyEmailNotice";

export default function RegisterPage() {
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", password: "" });
  const fe = useFieldErrors();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ email: string; devLink?: string } | null>(null);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    fe.clear(key);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateFields(registerSchema, form) || {};
    if (Object.keys(errs).length) {
      fe.setErrors(errs);
      fe.setFormError("Please fix the highlighted fields");
      scrollToFirstError(errs);
      return;
    }
    fe.clear();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) {
        fe.fromResponse(data);
        scrollToFirstError(data.fieldErrors);
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
      <div className="mb-8 text-center">
        <p className="text-2xl font-extrabold text-ink">Join MandiBazaar</p>
        <p className="mt-1 text-sm text-ink-subtle">Choose how you want to get started</p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border-2 border-brand-500 bg-brand-50 p-4 text-center shadow-sm">
          <User className="mx-auto h-6 w-6 text-brand-700" />
          <p className="mt-2 text-sm font-bold text-brand-900">Customer</p>
          <p className="mt-1 text-xs text-brand-700">Shop from local stores</p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-brand-600">
            Form below ↓
          </p>
        </div>
        <Link
          href="/store"
          className="rounded-2xl border border-emerald-200 bg-card p-4 text-center shadow-sm transition hover:border-emerald-400 hover:bg-emerald-50"
        >
          <Store className="mx-auto h-6 w-6 text-emerald-700" />
          <p className="mt-2 text-sm font-bold text-emerald-900">Store</p>
          <p className="mt-1 text-xs text-emerald-700">Sign in or create store</p>
          <p className="mt-2 text-xs font-semibold text-emerald-600">Continue →</p>
        </Link>
      </div>

      <div className="rounded-2xl border border-line bg-card p-8 shadow-card">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-xs font-black text-white shadow-sm">
            MB
          </div>
          <div>
            <p className="text-xl font-extrabold text-ink">Customer signup</p>
            <p className="text-xs text-ink-subtle">Create shopper account</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <TextField
            name="fullName"
            label="Full name"
            required
            placeholder="e.g. Muhammad Ali"
            autoComplete="name"
            maxLength={60}
            value={form.fullName}
            onChange={(e) => set("fullName", e.target.value)}
            error={fe.get("fullName")}
          />
          <TextField
            name="email"
            label="Email"
            required
            type="email"
            inputMode="email"
            placeholder="e.g. ali@gmail.com"
            autoComplete="email"
            maxLength={100}
            hint="You’ll verify this email and use it to sign in"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            error={fe.get("email")}
          />
          <TextField
            name="phone"
            label="Mobile number"
            required
            type="tel"
            inputMode="tel"
            placeholder="03001234567"
            autoComplete="tel"
            maxLength={13}
            hint="03XXXXXXXXX, or +92 then 10 digits — for delivery updates"
            value={form.phone}
            onChange={(e) => set("phone", formatMobile(e.target.value))}
            error={fe.get("phone")}
          />
          {fe.get("email")?.includes("already in use") && (
            <p className="-mt-2 text-xs">
              <Link href="/login" className="font-semibold text-brand-600 underline">
                Sign in
              </Link>{" "}
              or{" "}
              <Link href="/forgot-password" className="font-semibold text-brand-600 underline">
                reset your password
              </Link>
            </p>
          )}
          <TextField
            name="password"
            label="Password"
            required
            type="password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            maxLength={64}
            hint="8–64 characters with at least one letter and one number"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            error={fe.get("password")}
          />
          <FormError message={fe.formError} />
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Creating..." : "Create customer account"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-subtle">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </div>
    </ShopContainer>
  );
}
