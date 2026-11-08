"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { UserCog, CheckCircle2 } from "lucide-react";

type Errors = Partial<Record<"fullName" | "phone", string>>;

export default function ProfilePage() {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) {
          setFullName(d.data.fullName || "");
          setPhone(d.data.phone || "");
          setEmail(d.data.email || "");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError("");
    setDone(false);
    setBusy(true);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.fieldErrors) setErrors(data.fieldErrors as Errors);
        else setFormError(data.error || "Could not update your profile.");
        return;
      }
      setDone(true);
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Profile" subtitle="Update your name and mobile number." />

      <div className="mx-auto max-w-md rounded-2xl border border-line bg-card p-6 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-leaf-50">
            <UserCog className="h-5 w-5 text-leaf-600" />
          </div>
          <p className="text-sm text-ink-muted">Your email is used to sign in and can&apos;t be changed here.</p>
        </div>

        {done && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Your profile has been updated.
          </div>
        )}
        {formError && (
          <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{formError}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Full name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={loading}
              maxLength={60}
              className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm outline-none focus:border-leaf-400"
            />
            {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Mobile number</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={loading}
              inputMode="tel"
              maxLength={16}
              placeholder="03001234567"
              className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm outline-none focus:border-leaf-400"
            />
            {errors.phone && <p className="mt-1 text-xs text-red-600">{errors.phone}</p>}
            <p className="mt-1 text-xs text-ink-subtle">03XXXXXXXXX, or +92 then 10 digits</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-subtle">Email (sign-in)</label>
            <input
              value={email}
              disabled
              className="w-full rounded-xl border border-line bg-app px-3 py-2.5 text-sm text-ink-subtle"
            />
          </div>

          <Button type="submit" disabled={busy || loading} className="w-full">
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </div>
    </div>
  );
}
