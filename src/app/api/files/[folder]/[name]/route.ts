import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/auth";
import { readPrivateFromNeonStorage } from "@/lib/uploads/neon-storage";
import {
  canViewPrivateFile,
  isPrivateFolder,
  previewAllowed,
  privateKey,
} from "@/lib/uploads/private-files";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Serves a private upload (identity document, payment / remittance proof)
 * after checking who is asking; see private-files.ts for the rules.
 * Unknown, missing and not-allowed files all answer 404, so the route does
 * not reveal which files exist.
 */
export const dynamic = "force-dynamic";

const NAME = /^[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/i;

function notFound() {
  return NextResponse.json({ success: false, error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, { params }: { params: { folder: string; name: string } }) {
  const folder = String(params.folder || "").toLowerCase();
  const name = String(params.name || "");
  if (!isPrivateFolder(folder) || !NAME.test(name)) return notFound();

  if (!(await rateLimit(`files:${clientIp(req)}`, 300, 60_000)).ok) {
    return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 });
  }

  const sp = req.nextUrl.searchParams;
  let allowed = previewAllowed(folder, name, sp.get("exp"), sp.get("sig"));
  if (!allowed) {
    const session = await getSession();
    const viewer = session?.user?.id ? { id: session.user.id, role: session.user.role } : null;
    allowed = await canViewPrivateFile(viewer, folder, name);
  }
  if (!allowed) return notFound();

  let file: { bytes: Uint8Array; mime: string } | null;
  try {
    file = await readPrivateFromNeonStorage(privateKey(folder, name));
  } catch (e) {
    console.error("[files] read failed:", (e as Error).message);
    return NextResponse.json({ success: false, error: "Could not load the file" }, { status: 502 });
  }
  if (!file || !file.mime.startsWith("image/")) return notFound();

  return new NextResponse(Buffer.from(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      // Only this browser may keep it, briefly; never shared caches.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'",
      "Referrer-Policy": "no-referrer",
    },
  });
}
