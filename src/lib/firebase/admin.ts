/**
 * Firebase Admin (server) — Firebase Authentication is the source of truth for
 * email/password credentials, email verification and password reset.
 *
 * FIREBASE_SERVICE_ACCOUNT holds the service-account JSON (raw one line or base64).
 * NEXT_PUBLIC_FIREBASE_API_KEY is used for the REST signInWithPassword check.
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";

/** True when the server can talk to Firebase Auth (service account + web API key). */
export function firebaseAuthEnabled(): boolean {
  return (
    Boolean(process.env.FIREBASE_SERVICE_ACCOUNT?.trim()) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()) &&
    Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim())
  );
}

function parseServiceAccount(): Record<string, unknown> {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
  const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const obj = JSON.parse(json) as Record<string, unknown>;
  if (typeof obj.private_key === "string") {
    obj.private_key = obj.private_key.replace(/\\n/g, "\n");
  }
  return obj;
}

let app: App | null = null;
function adminApp(): App {
  if (app) return app;
  app =
    getApps()[0] ??
    initializeApp({ credential: cert(parseServiceAccount() as Parameters<typeof cert>[0]) });
  return app;
}

function auth() {
  return getAuth(adminApp());
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

export async function getFirebaseUserByEmail(email: string): Promise<UserRecord | null> {
  try {
    return await auth().getUserByEmail(email.trim().toLowerCase());
  } catch {
    return null;
  }
}

export async function createFirebaseUser(opts: {
  email: string;
  password: string;
  emailVerified?: boolean;
  displayName?: string;
}): Promise<UserRecord> {
  return auth().createUser({
    email: opts.email.trim().toLowerCase(),
    password: opts.password,
    emailVerified: opts.emailVerified ?? false,
    displayName: opts.displayName,
  });
}

export async function setFirebaseEmailVerified(uid: string): Promise<void> {
  await auth().updateUser(uid, { emailVerified: true });
}

export async function setFirebasePassword(uid: string, password: string): Promise<void> {
  await auth().updateUser(uid, { password });
}

export async function deleteFirebaseUser(uid: string): Promise<void> {
  await auth().deleteUser(uid).catch(() => {});
}

// ---------------------------------------------------------------------------
// Password check (REST signInWithPassword)
// ---------------------------------------------------------------------------

export type FirebasePasswordCheck =
  | { ok: true; uid: string }
  | { ok: false; reason: "INVALID" | "DISABLED" | "ERROR" };

/** Verify an email/password against Firebase. Caller checks emailVerified separately. */
export async function verifyFirebasePassword(
  email: string,
  password: string
): Promise<FirebasePasswordCheck> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "ERROR" };
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, returnSecureToken: true }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      localId?: string;
      error?: { message?: string };
    };
    if (res.ok && data.localId) return { ok: true, uid: data.localId };
    const msg = String(data.error?.message || "");
    if (msg.includes("USER_DISABLED")) return { ok: false, reason: "DISABLED" };
    // INVALID_PASSWORD / EMAIL_NOT_FOUND / INVALID_LOGIN_CREDENTIALS
    return { ok: false, reason: "INVALID" };
  } catch (e) {
    console.error("[firebase] signInWithPassword failed", e instanceof Error ? e.message : e);
    return { ok: false, reason: "ERROR" };
  }
}

// ---------------------------------------------------------------------------
// Action links (fallback for dev / when email sending is off). The /auth/action
// page applies the oobCode.
// ---------------------------------------------------------------------------

function actionSettings(continueUrl: string) {
  return { url: continueUrl, handleCodeInApp: false };
}

export async function emailVerificationLink(email: string, continueUrl: string): Promise<string> {
  return auth().generateEmailVerificationLink(email.trim().toLowerCase(), actionSettings(continueUrl));
}

export async function passwordResetLink(email: string, continueUrl: string): Promise<string> {
  return auth().generatePasswordResetLink(email.trim().toLowerCase(), actionSettings(continueUrl));
}

// ---------------------------------------------------------------------------
// Firebase-SENT emails (Identity Toolkit REST sendOobCode). Firebase delivers the
// email itself (no Resend needed, works to any address). The link opens the
// project's "action URL" — set that to <app>/auth/action in the Firebase console
// so our own pages apply the oobCode.
// ---------------------------------------------------------------------------

async function sendOobCode(payload: Record<string, unknown>): Promise<boolean> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) return false;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[firebase] sendOobCode ${payload.requestType} failed: HTTP ${res.status} ${body.slice(0, 320)}`);
    }
    return res.ok;
  } catch (e) {
    console.error("[firebase] sendOobCode error", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Ask Firebase to EMAIL a password-reset link to this address. */
export async function firebaseSendPasswordResetEmail(email: string, continueUrl: string): Promise<boolean> {
  const addr = email.trim().toLowerCase();
  // Some projects reject a custom continueUrl on sendOobCode (HTTP 400). Fall back
  // to Firebase's default action handler, which always works.
  const withUrl = await sendOobCode({ requestType: "PASSWORD_RESET", email: addr, continueUrl });
  if (withUrl) return true;
  return sendOobCode({ requestType: "PASSWORD_RESET", email: addr });
}

/** Ask Firebase to EMAIL a verification link (needs the user's password for the idToken). */
export async function firebaseSendVerificationEmail(
  email: string,
  password: string,
  continueUrl: string
): Promise<boolean> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) return false;
  try {
    const si = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, returnSecureToken: true }),
      }
    );
    const data = (await si.json().catch(() => ({}))) as { idToken?: string };
    if (!data.idToken) return false;
    // Some projects reject a custom continueUrl on sendOobCode (HTTP 400). Fall back
    // to Firebase's default action handler (hosted on the project's own domain),
    // which always works and still marks the email verified.
    const withUrl = await sendOobCode({ requestType: "VERIFY_EMAIL", idToken: data.idToken, continueUrl });
    if (withUrl) return true;
    return sendOobCode({ requestType: "VERIFY_EMAIL", idToken: data.idToken });
  } catch (e) {
    console.error("[firebase] verification send error", e instanceof Error ? e.message : e);
    return false;
  }
}
