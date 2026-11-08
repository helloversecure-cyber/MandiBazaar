import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);

    const items = await prisma.notification.findMany({
      where: {
        userId: session.user.id,
        channel: "IN_APP",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const mapped = items.map((n) => {
      const meta = (n.metadata || {}) as { read?: boolean };
      return { ...n, read: Boolean(meta.read) };
    });

    return apiSuccess({
      items: mapped,
      unread: mapped.filter((n) => !n.read).length,
    });
  } catch {
    return apiError("Failed to load notifications", 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) return apiError("Unauthorized", 401);
    const body = await req.json();

    if (body.action === "MARK_ALL_READ") {
      const items = await prisma.notification.findMany({
        where: { userId: session.user.id, channel: "IN_APP" },
        take: 100,
      });
      await Promise.all(
        items.map((n) =>
          prisma.notification.update({
            where: { id: n.id },
            data: {
              metadata: {
                ...((n.metadata as object) || {}),
                read: true,
              },
            },
          })
        )
      );
      return apiSuccess({ marked: items.length });
    }

    const id = String(body.id || "");
    if (!id) return apiError("id required", 400);
    const n = await prisma.notification.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!n) return apiError("Not found", 404);

    await prisma.notification.update({
      where: { id },
      data: {
        metadata: {
          ...((n.metadata as object) || {}),
          read: true,
        },
      },
    });
    return apiSuccess({ ok: true });
  } catch {
    return apiError("Failed", 500);
  }
}
