/**
 * Save "tour done" on the user's account (QA F6) so the welcome tour is not
 * shown again on any device. Used for both Finish and Skip. Never throws.
 */
export async function markOnboardingDone(how: "completed" | "skipped"): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ how }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Only allow same-site paths as the "next" destination after the tour. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  return next;
}
