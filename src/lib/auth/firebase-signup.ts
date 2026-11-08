/**
 * Shared Firebase account creation + verification email for signup
 * (customer, store owner, rider). Firebase is the source of truth for credentials;
 * Postgres keeps the app user (role, phone, profile) linked by firebaseUid.
 */
import { randomBytes } from "crypto";
import {
  createFirebaseUser,
  emailVerificationLink,
  firebaseAuthEnabled,
  firebaseSendPasswordResetEmail,
  firebaseSendVerificationEmail,
  getFirebaseUserByEmail,
  passwordResetLink,
} from "@/lib/firebase/admin";
import { emailConfigured, sendEmail } from "@/lib/notifications/service";
import { renderActionEmail } from "@/lib/notifications/email-template";

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Rebuild a Firebase action link (verify/reset) so it points at OUR /auth/action
 * page, keeping only mode + oobCode. This makes the flow independent of the
 * Firebase console "action URL" setting — our page applies the code itself.
 */
export function toAppActionUrl(firebaseLink: string): string {
  try {
    const u = new URL(firebaseLink);
    const mode = u.searchParams.get("mode") || "";
    const oobCode = u.searchParams.get("oobCode") || "";
    const out = new URL(`${appUrl()}/auth/action`);
    if (mode) out.searchParams.set("mode", mode);
    if (oobCode) out.searchParams.set("oobCode", oobCode);
    return out.toString();
  } catch {
    return firebaseLink;
  }
}

export class SignupAccountError extends Error {
  field: string;
  constructor(field: string, message: string) {
    super(message);
    this.field = field;
    this.name = "SignupAccountError";
  }
}

export const DUP_EMAIL_MSG = "This email is already in use. Sign in or reset your password.";

/**
 * Create the Firebase account (unverified) for a signup. Returns the uid.
 * Throws SignupAccountError({field:"email"}) when the email already exists.
 */
export async function createSignupFirebaseUser(
  email: string,
  password: string,
  displayName?: string
): Promise<string> {
  if (!firebaseAuthEnabled()) {
    throw new Error(
      "Firebase Authentication is not configured (FIREBASE_SERVICE_ACCOUNT / NEXT_PUBLIC_FIREBASE_* required)."
    );
  }
  const existing = await getFirebaseUserByEmail(email);
  if (existing) throw new SignupAccountError("email", DUP_EMAIL_MSG);
  try {
    const user = await createFirebaseUser({ email, password, emailVerified: false, displayName });
    return user.uid;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("email-already-exists")) throw new SignupAccountError("email", DUP_EMAIL_MSG);
    throw e;
  }
}

/**
 * Email the Firebase verification link to a signup.
 *
 * Preferred path: Firebase **sends the email itself** (works to any address, no
 * Resend/domain setup). Needs the user's password to mint the idToken, so it's
 * called right after the account is created. Falls back to Resend if configured,
 * then to an on-screen dev link.
 */
export async function sendSignupVerificationEmail(
  email: string,
  password?: string
): Promise<{ sent: boolean; devLink?: string }> {
  const fbLink = await emailVerificationLink(email, `${appUrl()}/login`);
  const link = toAppActionUrl(fbLink);
  // 1) Preferred: our branded HTML email (with a button) via Resend.
  if (emailConfigured()) {
    const { html, text } = renderActionEmail({
      heading: "Verify your email",
      intro: "Welcome to MandiBazaar! Tap the button below to confirm your email and activate your account.",
      buttonLabel: "Verify my email",
      buttonUrl: link,
      footnote: "If you didn't create a MandiBazaar account, you can safely ignore this email.",
    });
    const sent = await sendEmail({ to: email, subject: "Verify your MandiBazaar email", text, html });
    if (sent) return { sent: true };
  }
  // 2) Let Firebase deliver its own email (works to any address, no domain setup).
  if (password) {
    const sent = await firebaseSendVerificationEmail(email, password, `${appUrl()}/login`);
    if (sent) return { sent: true };
  }
  // 3) Development: surface the link on screen.
  if (process.env.NODE_ENV !== "production") {
    console.info(`[verify-email] link for ${email}: ${link}`);
    return { sent: false, devLink: link };
  }
  return { sent: false };
}

/**
 * Send a Firebase password-reset link (via Resend). Ensures the Firebase account
 * exists first (grandfathers an existing DB user who has no Firebase account yet,
 * as a verified account with a random password they then reset).
 */
export async function sendPasswordResetEmail(
  email: string
): Promise<{ sent: boolean; devLink?: string }> {
  if (!firebaseAuthEnabled()) throw new Error("Firebase Authentication is not configured.");

  const existing = await getFirebaseUserByEmail(email);
  if (!existing) {
    await createFirebaseUser({
      email,
      password: randomBytes(18).toString("base64url"),
      emailVerified: true,
    });
  }

  const fbLink = await passwordResetLink(email, `${appUrl()}/login`);
  const link = toAppActionUrl(fbLink);
  // 1) Preferred: our branded HTML email (with a button) via Resend.
  if (emailConfigured()) {
    const { html, text } = renderActionEmail({
      heading: "Reset your password",
      intro: "We received a request to reset your MandiBazaar password. Tap the button below to set a new one.",
      buttonLabel: "Reset my password",
      buttonUrl: link,
      footnote: "If you didn't request this, you can safely ignore this email — your password stays the same.",
    });
    const sent = await sendEmail({ to: email, subject: "Reset your MandiBazaar password", text, html });
    if (sent) return { sent: true };
  }
  // 2) Let Firebase deliver its own reset email (no Resend needed, any address).
  const fbSent = await firebaseSendPasswordResetEmail(email, `${appUrl()}/login`);
  if (fbSent) return { sent: true };
  // 3) Development: surface the link on screen.
  if (process.env.NODE_ENV !== "production") {
    console.info(`[password-reset] link for ${email}: ${link}`);
    return { sent: false, devLink: link };
  }
  return { sent: false };
}
