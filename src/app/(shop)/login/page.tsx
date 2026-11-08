"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ShopContainer } from "@/components/layout/ShopContainer";
import { FieldLabel } from "@/components/ui/FieldLabel";
import { FieldError, inputClass } from "@/components/ui/FieldError";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { MSG, normalizeEmail } from "@/lib/validators/pk";
import { safeCallbackUrl } from "@/lib/auth/identifier";
import {
  EMAIL_NOT_VERIFIED,
  continueAfterSignIn,
  loginDestination,
  loginErrorMessage,
} from "@/lib/auth/login-flow";

const LOGIN_INPUT = "w-full rounded-xl border bg-app px-4 py-3 text-sm outline-none focus:bg-card focus:ring-2";

function LoginForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const rawCallback = sp.get("callbackUrl") || sp.get("next");
  const portal = sp.get("portal") || "customer";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [idError, setIdError] = useState("");
  const [loading, setLoading] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  useEffect(() => {
    if (portal === "store") {
      const cb = safeCallbackUrl(rawCallback, "");
      router.replace(`/store?tab=login${cb ? `&callbackUrl=${encodeURIComponent(cb)}` : ""}`);
    }
  }, [portal, router, rawCallback]);

  function portalDest() {
    return loginDestination(portal, rawCallback);
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
      !res.ok || !data?.success
        ? data?.error || "Couldn’t resend right now. Please try again."
        : data?.data?.devLink
          ? `Dev link: ${data.data.devLink}`
          : "We’ve sent a new verification link to your email."
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
      const dest = portalDest();
      const res = await signIn("credentials", {
        identifier: email.trim(),
        password,
        portal,
        redirect: false,
        callbackUrl: dest,
      });
      if (!res || res.error) {
        const err = res?.error || "Sign in failed";
        if (err === EMAIL_NOT_VERIFIED) {
          setNeedsVerify(true);
          setError(loginErrorMessage(err, portal));
        } else if (err === MSG.email) {
          setIdError(err);
        } else {
          setError(loginErrorMessage(err, portal));
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

  const title =
    portal === "admin" ? "MandiBazaar Admin" : portal === "rider" ? "Rider portal" : "Sign in";
  const subtitle =
    portal === "admin"
      ? "Platform dashboard"
      : portal === "rider"
        ? "Deliveries & COD remittance"
        : "Shop from local stores";
  const showForgot = portal === "customer" || portal === "rider";

  return (
    <ShopContainer width="sm" className="flex min-h-[70vh] flex-col justify-center">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-card">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-xs font-black text-white shadow-sm">
            MB
          </div>
          <div>
            <p className="text-xl font-extrabold text-ink">{title}</p>
            <p className="text-xs text-ink-subtle">{subtitle}</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <FieldLabel required htmlFor="login-email">Email</FieldLabel>
            <input
              id="login-email"
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
          {showForgot && (
            <p className="text-right text-xs">
              <Link href="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">
                Forgot password?
              </Link>
            </p>
          )}
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
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        {portal === "admin" && (
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <p className="font-semibold">Authorized access only</p>
            <p className="mt-1">Use credentials provided by MandiBazaar.</p>
          </div>
        )}

        {portal === "rider" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
              <p className="font-semibold">Rider access</p>
              <p className="mt-1">Sign in with your email and password.</p>
            </div>
            <p className="text-center text-sm text-ink-subtle">
              New rider?{" "}
              <Link href="/register/rider" className="font-semibold text-brand-600 hover:text-brand-700">
                Become a rider →
              </Link>
            </p>
          </div>
        )}

        {portal === "customer" && (
          <p className="mt-6 text-center text-sm text-ink-subtle">
            New here?{" "}
            <Link href="/register" className="font-semibold text-brand-600 hover:text-brand-700">
              Create account
            </Link>
          </p>
        )}
      </div>
      <div className="mt-4 space-y-1.5 text-center text-xs text-ink-subtle">
        {portal !== "admin" && portal !== "rider" && (
          <p>
            <Link href="/store" className="text-brand-600 hover:underline">
              Sell on MandiBazaar — Store
            </Link>
          </p>
        )}
        {(portal === "admin" || portal === "rider") && (
          <p>
            <Link href="/login" className="text-brand-600 hover:underline">
              Customer login
            </Link>
          </p>
        )}
      </div>
    </ShopContainer>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
