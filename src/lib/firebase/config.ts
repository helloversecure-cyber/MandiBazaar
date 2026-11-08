/**
 * Firebase phone-auth config (QA L1/T4: SMS OTP for signup phone verification).
 * Public (NEXT_PUBLIC_*) values are safe in the browser. Firebase only verifies the
 * signup phone — order SMS and admin-2FA SMS still go through Twilio, email via Resend.
 */

export const firebaseClientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "",
};

/** True when the browser has enough config to run Firebase phone auth. */
export function firebaseClientConfigured(): boolean {
  const c = firebaseClientConfig;
  return Boolean(c.apiKey && c.authDomain && c.projectId && c.appId);
}
