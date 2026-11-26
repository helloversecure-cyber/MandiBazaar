"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { AlertTriangle } from "lucide-react";

export default function DeleteAccountPage() {
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (confirm.trim() !== "DELETE") {
      setError("Type DELETE in capital letters to confirm.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.success) {
        setError(data.error || "Could not close your account. Please try again.");
        return;
      }
      await signOut({ callbackUrl: "/?account=closed" });
    } catch {
      setError("Could not reach MandiBazaar. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Delete account" subtitle="Close your MandiBazaar account permanently." />
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-card p-6 shadow-card">
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This can&apos;t be undone. You won&apos;t be able to sign in again with this account.</span>
        </div>
        <ul className="mb-5 list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
          <li>You are signed out on this website and in the app.</li>
          <li>Lists you sent to stores are cancelled.</li>
          <li>
            Order and payment records are kept where the law requires it. See our{" "}
            <Link href="/privacy" className="font-semibold text-brand-600 hover:underline">privacy policy</Link>.
          </li>
          <li>Active orders must be delivered or cancelled first.</li>
        </ul>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="confirm-delete" className="mb-1.5 block text-sm font-medium text-ink">
              Type DELETE to confirm
            </label>
            <input
              id="confirm-delete"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              maxLength={20}
              className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm outline-none focus:border-red-400"
            />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full bg-red-600 hover:bg-red-700">
            {busy ? "Closing account…" : "Delete my account"}
          </Button>
        </form>
      </div>
    </div>
  );
}
