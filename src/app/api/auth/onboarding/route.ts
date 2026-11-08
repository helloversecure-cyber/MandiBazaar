import { requireAuth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import type { Prisma, RoleName } from "@prisma/client";

/**
 * Onboarding progress is persisted server-side (DB = source of truth) so a
 * refresh, a closed browser, or a different device resumes from the last saved
 * step. `OnboardingDraft` holds currentStep + a free-form data blob; the terminal
 * `onboardingCompleted` boolean stays for the "tour done" gate.
 */

async function loadUser(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingCompleted: true, role: { select: { name: true } } },
  });
}

export async function GET() {
  try {
    const session = await requireAuth();
    const user = await loadUser(session.user.id);
    if (!user) return apiError("We couldn't load your account. Please sign in again.", 404);

    const draft = await prisma.onboardingDraft.findUnique({
      where: { userId: session.user.id },
      select: { currentStep: true, data: true, submittedAt: true },
    });

    return apiSuccess({
      completed: user.onboardingCompleted,
      role: user.role.name,
      currentStep: draft?.currentStep ?? 0,
      data: draft?.data ?? {},
      submitted: Boolean(draft?.submittedAt),
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
    console.error("[onboarding:GET]", e);
    return apiError(toUserMessage(e), 500);
  }
}

/** Save progress for one step (save-on-Next). Idempotent; merges `data`. */
export async function PATCH(req: Request) {
  try {
    const session = await requireAuth();
    const user = await loadUser(session.user.id);
    if (!user) return apiError("We couldn't load your account. Please sign in again.", 404);

    const body = (await req.json().catch(() => ({}))) as { step?: unknown; data?: unknown };
    const step = Number.isFinite(Number(body.step)) ? Math.max(0, Math.floor(Number(body.step))) : undefined;
    const patch =
      body.data && typeof body.data === "object" && !Array.isArray(body.data)
        ? (body.data as Prisma.JsonObject)
        : undefined;

    const existing = await prisma.onboardingDraft.findUnique({
      where: { userId: session.user.id },
      select: { data: true },
    });
    const mergedData: Prisma.JsonObject = {
      ...((existing?.data as Prisma.JsonObject) ?? {}),
      ...(patch ?? {}),
    };

    const draft = await prisma.onboardingDraft.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        role: user.role.name as RoleName,
        currentStep: step ?? 0,
        data: mergedData,
      },
      update: {
        ...(step !== undefined ? { currentStep: step } : {}),
        ...(patch ? { data: mergedData } : {}),
      },
      select: { currentStep: true },
    });

    return apiSuccess({ saved: true, currentStep: draft.currentStep });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
    console.error("[onboarding:PATCH]", e);
    return apiError(toUserMessage(e), 500);
  }
}

/** Finalize onboarding: mark the tour complete (and the draft submitted). */
export async function POST() {
  try {
    const session = await requireAuth();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: session.user.id },
        data: { onboardingCompleted: true },
      }),
      prisma.onboardingDraft.updateMany({
        where: { userId: session.user.id, submittedAt: null },
        data: { submittedAt: new Date() },
      }),
    ]);
    return apiSuccess({ completed: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
    console.error("[onboarding:POST]", e);
    return apiError(toUserMessage(e), 500);
  }
}
