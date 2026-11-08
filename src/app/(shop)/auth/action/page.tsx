"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FieldError, FormError, inputClass } from "@/components/ui/FieldError";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { zPassword } from "@/lib/validators/pk";
import {
  applyEmailVerification,
  applyNewPassword,
  checkResetCode,
} from "@/lib/firebase/client";

const INPUT = "w-full rounded-xl border bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2";

function ActionInner() {
  const sp = useSearchParams();
  const mode = sp.get("mode") || "";
  const oobCode = sp.get("oobCode") || "";

  if (!oobCode) {
    return <Card title="Invalid link" body="This link is missing its code. Please use the latest email we sent." />;
  }
  if (mode === "verifyEmail") return <VerifyEmail oobCode={oobCode} />;
  if (mode === "resetPassword") return <ResetPassword oobCode={oobCode} />;
  return <Card title="Unsupported action" body="This link isn’t supported. Please try again from the website." />;
}

function Card({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-8 text-center shadow-card">
      <h1 className="text-xl font-extrabold text-ink">{title}</h1>
      {body && <p className="mt-2 text-sm text-ink-muted">{body}</p>}
      {children}
    </div>
  );
}

function VerifyEmail({ oobCode }: { oobCode: string }) {
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [error, setError] = useState("");
  // The oobCode is single-use: run once even under React StrictMode's double effect.
  const ran = useRef(false);

  useEffect(() => {
    // Single-use oobCode: run exactly once (ran guard survives StrictMode's
    // setup→cleanup→setup, and we do NOT gate setState on an `alive` flag because
    // the StrictMode cleanup would otherwise swallow the only result).
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const email = await applyEmailVerification(oobCode);
        await fetch("/api/auth/email-verified", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }).catch(() => {});
        setState("done");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Verification failed");
        setState("error");
      }
    })();
  }, [oobCode]);

  if (state === "working") {
    return (
      <Card title="Verifying your email…">
        <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-brand-600" />
      </Card>
    );
  }
  if (state === "error") {
    return (
      <Card title="Couldn’t verify email" body="This link may have expired or already been used.">
        <p className="mt-2 text-xs text-ink-subtle">{error}</p>
        <Button href="/login" className="mt-6 w-full">
          Go to sign in
        </Button>
      </Card>
    );
  }
  return (
    <Card title="Email verified" body="Your email is verified. You can sign in now.">
      <CheckCircle2 className="mx-auto mt-4 h-8 w-8 text-emerald-600" />
      <Button href="/login" className="mt-6 w-full">
        Go to sign in
      </Button>
    </Card>
  );
}

function ResetPassword({ oobCode }: { oobCode: string }) {
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    checkResetCode(oobCode)
      .then((e) => {
        setEmail(e);
        setChecking(false);
      })
      .catch(() => {
        setInvalid(true);
        setChecking(false);
      });
  }, [oobCode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setFormErr("");
    if (!zPassword.safeParse(password).success) {
      setErr("Password must be 8–64 characters with at least one letter and one number");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      await applyNewPassword(oobCode, password);
      setDone(true);
    } catch (e2) {
      setFormErr(
        e2 instanceof Error && e2.message.includes("expired")
          ? "This reset link has expired. Please request a new one."
          : "Couldn’t reset your password. The link may have expired."
      );
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <Card title="Loading…">
        <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-brand-600" />
      </Card>
    );
  }
  if (invalid) {
    return (
      <Card title="Reset link invalid" body="This link has expired or already been used.">
        <Button href="/forgot-password" className="mt-6 w-full">
          Request a new link
        </Button>
      </Card>
    );
  }
  if (done) {
    return (
      <Card title="Password updated" body="Your password has been changed. Please sign in.">
        <CheckCircle2 className="mx-auto mt-4 h-8 w-8 text-emerald-600" />
        <Button href="/login" className="mt-6 w-full">
          Go to sign in
        </Button>
      </Card>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-8 shadow-card">
      <h1 className="text-xl font-extrabold text-ink">Set a new password</h1>
      {email && <p className="mt-1 text-sm text-ink-subtle">for {email}</p>}
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        <div>
          <FieldLabel required>Create new password</FieldLabel>
          <PasswordInput
            className={inputClass(!!err, INPUT)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            maxLength={64}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setErr("");
            }}
          />
        </div>
        <div>
          <FieldLabel required>Confirm new password</FieldLabel>
          <PasswordInput
            className={inputClass(!!err, INPUT)}
            placeholder="Re-enter password"
            autoComplete="new-password"
            maxLength={64}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setErr("");
            }}
          />
          <FieldError message={err} />
        </div>
        <FormError message={formErr} />
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Updating…" : "Update password"}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-ink-subtle">
        <Link href="/login" className="text-brand-600 underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export default function AuthActionPage() {
  return (
    <ShopContainer width="sm" className="flex min-h-[70vh] flex-col justify-center py-10">
      <Suspense
        fallback={
          <Card title="Loading…">
            <Loader2 className="mx-auto mt-4 h-6 w-6 animate-spin text-brand-600" />
          </Card>
        }
      >
        <ActionInner />
      </Suspense>
    </ShopContainer>
  );
}
