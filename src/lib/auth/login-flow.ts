"use client";

/** Client-side helpers shared by every sign-in form (customer, admin, rider, store). */
import { getSession } from "next-auth/react";
import { getDefaultDest, getOnboardingSlug } from "@/lib/onboarding/flows";
import { safeCallbackUrl } from "@/lib/auth/identifier";

export const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

/** Map sign-in errors from next-auth to plain messages. */
export function loginErrorMessage(err: string, portal: string): string {
  if (err === "CredentialsSignin" || err === "Invalid credentials") return "Wrong email or password";
  if (err === EMAIL_NOT_VERIFIED) return "Please verify your email first. Check your inbox for the link.";
  if (err === "Unauthorized admin access") return "This account is not an admin.";
  if (err === "Unauthorized store access") return "This account is not a store owner.";
  if (err === "Unauthorized rider access") {
    return portal === "rider"
      ? "This account is not a rider. New rider? Use “Become a rider” below."
      : "This account is not a rider.";
  }
  return err;
}

/** Where to go after sign-in: the page asked for (if it belongs to this portal), else the portal home. */
export function loginDestination(portal: string, rawCallback: string | null): string {
  const cb = safeCallbackUrl(rawCallback, "");
  const prefix =
    portal === "admin" ? "/admin" : portal === "store" ? "/store-portal" : portal === "rider" ? "/rider-portal" : "";
  if (prefix) return cb === prefix || cb.startsWith(`${prefix}/`) || cb.startsWith(`${prefix}?`) ? cb : prefix;
  return cb || "/";
}

/** After a successful sign-in: onboarding (if not done), then the destination. */
export async function continueAfterSignIn(dest: string) {
  await getSession();
  const obRes = await fetch("/api/auth/onboarding");
  const ob = await obRes.json();
  const role = ob.success ? (ob.data.role as string) : "";

  // A store owner whose store isn't approved yet skips the dashboard tour and is
  // held on the Pending Approval screen (never dropped on the customer site).
  if (role === "STORE_OWNER") {
    try {
      const acc = await fetch("/api/store/access", { cache: "no-store" }).then((r) => r.json());
      if (!acc?.success || !acc.data?.allowed) {
        window.location.assign("/store-portal");
        return;
      }
    } catch {
      /* fall through to normal flow */
    }
  }

  if (ob.success && !ob.data.completed) {
    const slug = getOnboardingSlug(role);
    const roleDest = getDefaultDest(role);
    window.location.assign(`/onboarding/${slug}?next=${encodeURIComponent(dest || roleDest)}`);
    return;
  }
  window.location.assign(dest);
}
