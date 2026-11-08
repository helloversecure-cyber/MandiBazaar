"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { MSG, normalizeEmail } from "@/lib/validators/pk";
import {
  EMAIL_NOT_VERIFIED,
  continueAfterSignIn,
  loginDestination,
  loginErrorMessage,
} from "@/lib/auth/login-flow";

const LOGIN_INPUT =
  "w-full rounded-xl border bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2";

export function StoreLoginForm({
  onSwitchToSignup,
  initialError,
}: {
  onSwitchToSignup?: () => void;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const sp = useSearchParams();
  const [error, setError] = useState(initialError || "");
  const [idError, setIdError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  function storeDest() {
    return loginDestination("store", sp.get("callbackUrl") || sp.get("next"));
  }

  function storeErrorMessage(err: string) {
    return err === "CredentialsSignin" || err === "Invalid credentials"
      ? "Wrong email or password"
      : err === "Unauthorized store access"
        ? "This account is not a store owner. Create a store account first."
        : loginErrorMessage(err, "store");
  }

  async function resend() {
    setResendMsg("");
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json().catch(() => ({}));
    setResendMsg(
      data?.data?.devLink ? `Dev link: ${data.data.devLink}` : "We’ve sent a new verification link to your email."
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNeedsVerify(false);
    if (!normalizeEmail(email)) {
      setIdError(MSG.email);
      return;
    }
    setIdError("");
    setLoading(true);
    try {
      const dest = storeDest();
      const res = await signIn("credentials", {
        identifier: email.trim(),
        password,
        portal: "store",
        redirect: false,
        callbackUrl: dest,
      });
      if (!res || res.error) {
        const err = res?.error || "Sign in failed";
        if (err === EMAIL_NOT_VERIFIED) {
          setNeedsVerify(true);
          setError(loginErrorMessage(err, "store"));
        } else if (err === MSG.email) {
          setIdError(err);
        } else {
          setError(storeErrorMessage(err));
        }
        setLoading(false);
        return;
      }
      await continueAfterSignIn(dest);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-card p-6 shadow-card sm:p-8">
      <h2 className="text-xl font-extrabold text-ink">Store sign in</h2>
      <p className="mt-1 text-sm text-ink-subtle">
        Manage products, orders, and payouts after MandiBazaar approves your store.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <FieldLabel required htmlFor="store-login-email">Email</FieldLabel>
          <input
            id="store-login-email"
            type="email"
            inputMode="email"
            className={inputClass(!!idError, LOGIN_INPUT)}
            placeholder="e.g. ali@gmail.com"
            value={email}
            maxLength={100}
            aria-invalid={!!idError}
            onChange={(e) => {
              setEmail(e.target.value);
              setIdError("");
            }}
            autoComplete="username"
            required
          />
          <FieldError message={idError} />
        </div>
        <div>
          <FieldLabel required>Password</FieldLabel>
          <PasswordInput
            className="w-full rounded-xl border border-line bg-app px-4 py-3 text-sm outline-none focus:border-brand-400 focus:bg-card focus:ring-2 focus:ring-brand-100"
            placeholder="Password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <p className="text-right text-xs">
          <Link href="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">
            Forgot password?
          </Link>
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {needsVerify && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <button type="button" onClick={resend} className="font-semibold underline">
              Resend verification email
            </button>
            {resendMsg && <p className="mt-1 break-all">{resendMsg}</p>}
          </div>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Signing in..." : "Sign in to store"}
        </Button>
      </form>

      {onSwitchToSignup && (
        <p className="mt-6 text-center text-sm text-ink-subtle">
          New store?{" "}
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            Create store account
          </button>
        </p>
      )}
    </div>
  );
}
