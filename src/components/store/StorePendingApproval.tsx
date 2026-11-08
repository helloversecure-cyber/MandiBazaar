"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Clock, LogOut, RefreshCw, Store } from "lucide-react";
import { Button } from "@/components/ui/Button";

const DEFAULT_MESSAGE =
  "Your account is not approved by MandiBazaar yet. Please wait until your account is reviewed and approved.";

/**
 * Full-screen hold for a store owner whose store is not yet approved. They stay
 * signed in but get no store dashboard and no customer-site access (middleware);
 * the only way forward is approval by MandiBazaar.
 */
export function StorePendingApproval({ reason }: { reason?: string | null }) {
  const { update } = useSession();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState("");

  const r = (reason || "").toLowerCase();
  const suspended = r.includes("suspend");
  const rejected = r.includes("was not approved") || r.includes("rejected");
  const noStore = r.includes("no approved store");
  const heading = suspended
    ? "Store suspended"
    : rejected
      ? "Application not approved"
      : "Account pending approval";
  // A rejected (or storeless) owner can submit a fresh application; a pending
  // owner just waits and can re-check; a suspended owner must contact support
  // (re-checking never clears a suspension, so that button is hidden for them).
  const canReapply = (rejected || noStore) && !suspended;

  async function checkStatus() {
    setChecking(true);
    setNote("");
    try {
      // Check the DB directly (fresh). Only refresh the session token once we know
      // it's approved — calling update() while still pending re-mounts this screen
      // and wipes the message, so it must not run on the pending path.
      const res = await fetch("/api/store/access", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (data?.success && data.data?.allowed) {
        try {
          await update();
        } catch {
          /* token refresh is best-effort; the portal re-checks the DB anyway */
        }
        window.location.assign("/store-portal");
        return;
      }
      setNote("Still pending — your account hasn't been approved yet. Please check back later.");
    } catch {
      setNote("Couldn't check right now. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-emerald-50/80 to-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-8 text-center shadow-card">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50">
          <Clock className="h-7 w-7 text-amber-600" />
        </div>
        <h1 className="mt-5 text-xl font-extrabold text-ink">{heading}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          {reason?.trim() || DEFAULT_MESSAGE}
        </p>

        {suspended && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            To appeal or resolve this, contact MandiBazaar support at{" "}
            <a href="mailto:hello@mandibazaar.pk" className="font-semibold underline">
              hello@mandibazaar.pk
            </a>
            .
          </p>
        )}

        <div className="mt-7 space-y-3">
          {suspended ? null : canReapply ? (
            <Button href="/store-portal/reapply" className="w-full gap-2">
              <Store className="h-4 w-4" />
              Submit a new application
            </Button>
          ) : (
            <Button onClick={checkStatus} disabled={checking} className="w-full gap-2">
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              {checking ? "Checking…" : "Check approval status"}
            </Button>
          )}
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/store" })}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-ink-subtle hover:text-ink"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>

        {note && <p className="mt-4 text-xs text-ink-subtle">{note}</p>}
      </div>
    </div>
  );
}
