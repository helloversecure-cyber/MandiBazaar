"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";

/**
 * Shown after signup: Firebase has emailed a verification link. The user must
 * open it before they can sign in. Includes a "resend" action and (in dev) the link.
 */
export function VerifyEmailNotice({
  email,
  devLink,
  password,
}: {
  email: string;
  devLink?: string;
  password?: string;
}) {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [link, setLink] = useState(devLink || "");

  async function resend() {
    setSending(true);
    setMsg("");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.data?.devLink) setLink(data.data.devLink);
      setMsg(data?.success ? "Verification email sent again. Please check your inbox." : data?.error || "Couldn't resend. Try again.");
    } catch {
      setMsg("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-surface-border bg-white p-8 text-center shadow-card">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
        <MailCheck className="h-6 w-6 text-emerald-600" />
      </div>
      <h1 className="mt-4 text-xl font-extrabold text-slate-900">Verify your email</h1>
      <p className="mt-2 text-sm text-slate-600">
        We sent a verification link to <strong>{email}</strong>. Open it to verify your email,
        then sign in. You can’t access your account until it’s verified.
      </p>

      {link && (
        <p className="mt-3 break-all rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Development mode (no email provider): <a href={link} className="font-semibold underline">open verification link</a>
        </p>
      )}

      <div className="mt-6 space-y-3">
        <Button href="/login" className="w-full">
          Go to sign in
        </Button>
        <button
          type="button"
          onClick={resend}
          disabled={sending}
          className="w-full text-sm font-medium text-brand-600 hover:text-brand-700 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Didn’t get it? Resend email"}
        </button>
        {msg && <p className="text-xs text-slate-500">{msg}</p>}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Wrong email?{" "}
        <Link href="/register" className="text-brand-600 underline">
          Start over
        </Link>
      </p>
    </div>
  );
}
