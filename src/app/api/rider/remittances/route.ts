import { requireRider } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { apiError, apiSuccess, toUserMessage } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import {
  RemittanceError,
  createRemittanceSubmission,
  riderRemittanceList,
  type RemittanceMethodName,
} from "@/lib/finance/remittance";

const VALID_METHODS: RemittanceMethodName[] = ["CASH_HANDOVER", "BANK", "JAZZCASH"];

function handle(e: unknown) {
  if (e instanceof RemittanceError) return apiError(e.message, 400, e.code);
  if (e instanceof Error) {
    if (e.message === "UNAUTHORIZED") return apiError("Please sign in to continue.", 401);
    if (e.message === "FORBIDDEN" || e.message === "RIDER_NOT_APPROVED") {
      return apiError("Your rider account isn't active yet.", 403);
    }
  }
  console.error("[rider-remittances]", e);
  return apiError(toUserMessage(e), 500);
}

/** The rider's COD remittance obligations + which methods/instructions are configured. */
export async function GET() {
  try {
    const { rider } = await requireRider({ allowPending: true });
    const [list, settings] = await Promise.all([
      riderRemittanceList(rider.id),
      prisma.storeSettings.findFirst({
        select: { remittanceMethods: true, cashHandoverInstructions: true },
      }),
    ]);
    const restriction = await prisma.rider.findUnique({
      where: { id: rider.id },
      select: { codRestrictedAt: true, codRestrictionReason: true },
    });
    const methods = Array.isArray(settings?.remittanceMethods)
      ? (settings!.remittanceMethods as string[]).filter((m) => VALID_METHODS.includes(m as RemittanceMethodName))
      : VALID_METHODS;
    return apiSuccess({
      ...list,
      methods,
      cashHandoverInstructions: settings?.cashHandoverInstructions ?? null,
      restricted: !!restriction?.codRestrictedAt,
      restrictionReason: restriction?.codRestrictionReason ?? null,
    });
  } catch (e) {
    return handle(e);
  }
}

/** Submit a remittance payment (digital proof or a cash-handover request). */
export async function POST(req: Request) {
  try {
    const { rider } = await requireRider({ allowPending: true });
    const rl = rateLimit(`remit-submit:${rider.id}`, 20, 60_000);
    if (!rl.ok) return apiError("Please wait a moment before trying again.", 429);

    const body = (await req.json().catch(() => ({}))) as {
      remittanceId?: string;
      method?: string;
      amount?: unknown;
      proofUrl?: string;
      reference?: string;
    };
    if (!body.remittanceId) return apiError("Missing remittance.", 400);
    if (!body.method || !VALID_METHODS.includes(body.method as RemittanceMethodName)) {
      return apiError("Choose a valid payment method.", 400);
    }
    const result = await createRemittanceSubmission({
      riderId: rider.id,
      remittanceId: body.remittanceId,
      method: body.method as RemittanceMethodName,
      amount: Number(body.amount),
      proofUrl: typeof body.proofUrl === "string" ? body.proofUrl : null,
      reference: typeof body.reference === "string" ? body.reference : null,
    });
    return apiSuccess(result);
  } catch (e) {
    return handle(e);
  }
}
