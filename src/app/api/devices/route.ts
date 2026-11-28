import { z } from "zod";
import { requireAuth } from "@/lib/auth/auth";
import { registerDevice, removeDevice } from "@/lib/notifications/push";
import { rateLimit } from "@/lib/rate-limit";
import { apiError, apiSuccess } from "@/lib/utils";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(20, "Invalid device token").max(4096, "Invalid device token"),
  platform: z.enum(["android"]).default("android"),
});

/** Register this app install for push notifications. Body: { token, platform? } */
export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const rl = await rateLimit(`devices:${session.user.id}`, 30, 60_000);
    if (!rl.ok) return apiError("Too many requests", 429);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message || "Invalid request", 400);
    await registerDevice(session.user.id, parsed.data.token, parsed.data.platform);
    return apiSuccess({ registered: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in", 401);
    console.error("[devices:post]", e);
    return apiError("Something went wrong. Please try again in a few moments.", 500);
  }
}

/** Stop push to this install (e.g. the user turned notifications off). Body: { token } */
export async function DELETE(req: Request) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => null);
    if (typeof body?.token === "string") await removeDevice(body.token, session.user.id);
    return apiSuccess({ removed: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") return apiError("Please sign in", 401);
    console.error("[devices:delete]", e);
    return apiError("Something went wrong. Please try again in a few moments.", 500);
  }
}
