"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Lock, Eye, EyeOff, CheckCircle2, AlertTriangle } from "lucide-react";

type Errors = Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>;

/** Mirror of zPassword (pk.ts): 8–64 chars, at least one letter and one number. */
function passwordError(v: string): string | null {
  if (v.length < 8 || v.length > 64 || !/[A-Za-z]/.test(v) || !/\d/.test(v)) {
    return "Password must be 8–64 characters with at least one letter and one number";
  }
  return null;
}

export default function SecurityPage() {
  const forced = useSearchParams().get("forced") === "1";
  const router = useRouter();
  const { update } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError("");
    setDone(false);

    // Client-side checks first, so obvious mistakes don't need a round-trip.
    const clientErrors: Errors = {};
    if (!currentPassword) clientErrors.currentPassword = "Enter your current password";
    const pwErr = passwordError(newPassword);
    if (pwErr) clientErrors.newPassword = pwErr;
    else if (newPassword === currentPassword)
      clientErrors.newPassword = "Choose a new password different from the current one";
    if (confirmPassword !== newPassword) clientErrors.confirmPassword = "Passwords do not match";
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.fieldErrors) setErrors(data.fieldErrors as Errors);
        else setFormError(data.error || "Could not update your password.");
        return;
      }
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // Refresh the JWT so the mustChangePassword flag (now false in the DB) is
      // reloaded — otherwise the forced-change middleware gate keeps redirecting back.
      try {
        await update();
      } catch {
        /* best-effort */
      }
      if (forced) {
        setTimeout(() => router.replace("/"), 900);
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    error?: string,
    autoComplete?: string
  ) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          maxLength={128}
          className="w-full rounded-xl border border-line bg-card px-3 py-2.5 pr-10 text-sm outline-none focus:border-leaf-400"
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );

  return (
    <div>
      <PageHeader title="Password" subtitle="Change the password you use to sign in." />

      {forced && !done && (
        <div className="mx-auto mb-4 flex max-w-md items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Your account uses a temporary password. Please set a new one to continue.</span>
        </div>
      )}

      <div className="mx-auto max-w-md rounded-2xl border border-line bg-card p-6 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-leaf-50">
            <Lock className="h-5 w-5 text-leaf-600" />
          </div>
          <p className="text-sm text-ink-muted">
            You&apos;ll stay signed in on this device after changing it.
          </p>
        </div>

        {done && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Your password has been updated.
          </div>
        )}
        {formError && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{formError}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {field("Current password", currentPassword, setCurrentPassword, errors.currentPassword, "current-password")}
          {field("New password", newPassword, setNewPassword, errors.newPassword, "new-password")}
          {field("Confirm new password", confirmPassword, setConfirmPassword, errors.confirmPassword, "new-password")}

          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="flex items-center gap-1.5 text-xs font-medium text-ink-subtle hover:text-ink"
          >
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {show ? "Hide passwords" : "Show passwords"}
          </button>

          <p className="text-xs text-ink-subtle">
            At least 8 characters, with a letter and a number.
          </p>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Updating…" : "Update password"}
          </Button>
        </form>
      </div>
    </div>
  );
}
