"use client";

/**
 * Firebase client (browser) — used only on /auth/action to apply the oobCode from
 * email-verification and password-reset links. Firebase is the auth source of truth;
 * the app session itself is NextAuth.
 */
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
  type Auth,
} from "firebase/auth";
import { firebaseClientConfig, firebaseClientConfigured } from "@/lib/firebase/config";

function auth(): Auth {
  const app = getApps().length ? getApp() : initializeApp(firebaseClientConfig);
  return getAuth(app);
}

export { firebaseClientConfigured };

/** Apply an email-verification oobCode. Returns the verified email. */
export async function applyEmailVerification(oobCode: string): Promise<string> {
  const info = await checkActionCode(auth(), oobCode);
  await applyActionCode(auth(), oobCode);
  return info.data.email || "";
}

/** Check a password-reset oobCode and return the email it is for. */
export async function checkResetCode(oobCode: string): Promise<string> {
  return verifyPasswordResetCode(auth(), oobCode);
}

/** Set the new password for a reset oobCode. */
export async function applyNewPassword(oobCode: string, newPassword: string): Promise<void> {
  await confirmPasswordReset(auth(), oobCode, newPassword);
}
