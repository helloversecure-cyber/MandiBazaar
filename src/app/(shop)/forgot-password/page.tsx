"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { MSG, normalizeEmail } from "@/lib/validators/pk";

const INPUT = "w-full rounded-xl border bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFormError("");
    if (!normalizeEmail(email)) {
      setError(MSG.email);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) {
        if (data.fieldErrors?.email) setError(data.fieldErrors.email);
        else setFormError(data.error || "Couldn't send the reset link. Please try again.");
        return;
      }
      setSent({ devLink: data.data?.devLink });
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <ShopContainer width="sm" className="flex min-h-[70vh] flex-col justify-center">
        <div className="rounded-2xl border border-line bg-card p-8 text-center shadow-card">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
            <MailCheck className="h-6 w-6 text-emerald-600" />
          </div>
          <h1 className="mt-4 text-xl font-extrabold text-ink">Check your email</h1>
          <p className="mt-2 text-sm text-ink-muted">
            We’ve sent a link to reset your password to <strong>{email.trim()}</strong>. It may take a minute to arrive — remember to check spam.
          </p>
          {sent.devLink && (
            <p className="mt-3 break-all rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Development mode: <a href={sent.devLink} className="font-semibold underline">open reset link</a>
            </p>
          )}
          <Button href="/login" className="mt-6 w-full">
            Back to sign in
          </Button>
        </div>
      </ShopContainer>
    );
  }

  return (
    <ShopContainer width="sm" className="flex min-h-[70vh] flex-col justify-center">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-card">
        <h1 className="text-xl font-extrabold text-ink">Forgot password</h1>
        <p className="mt-1 text-sm text-ink-subtle">
          Enter your email and we’ll send you a link to set a new password.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <FieldLabel required>Email</FieldLabel>
            <input
              type="email"
              inputMode="email"
              className={inputClass(!!error, INPUT)}
              placeholder="e.g. ali@gmail.com"
              value={email}
              maxLength={100}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              autoComplete="username"
              required
            />
            <FieldError message={error} />
          </div>
          {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Sending…" : "Continue"}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-ink-subtle">
          <Link href="/login" className="font-semibold text-brand-600 hover:text-brand-700">
            Back to sign in
          </Link>
        </p>
      </div>
    </ShopContainer>
  );
}
