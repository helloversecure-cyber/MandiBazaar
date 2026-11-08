import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

/** Append-only order status journal. Call inside the same transaction that
 *  changes the order status so the timeline never drifts from reality. */
export async function recordStatusEvent(
  db: Db,
  input: {
    orderId: string;
    status: OrderStatus;
    actorId?: string | null;
    actorRole?: string | null;
    note?: string | null;
  }
): Promise<void> {
  try {
    await db.orderStatusEvent.create({
      data: {
        orderId: input.orderId,
        status: input.status,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        note: input.note ?? null,
      },
    });
  } catch (e) {
    // Journaling must never break the actual status change.
    console.error("[status-event]", e);
  }
}

/** Ordered timeline for a customer/admin order view. */
export async function getOrderTimeline(orderId: string) {
  return prisma.orderStatusEvent.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, actorRole: true, note: true, createdAt: true },
  });
}

export type JourneyStepState = "done" | "current" | "upcoming" | "cancelled";
export type JourneyStep = {
  key: string;
  label: string;
  state: JourneyStepState;
  at: string | null;
};

const JOURNEY: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: "PLACED", label: "Order placed", statuses: ["AWAITING_RIDER", "PENDING_PAYMENT"] },
  { key: "CONFIRMED", label: "Confirmed", statuses: ["CONFIRMED"] },
  { key: "PREPARING", label: "Preparing", statuses: ["PROCESSING", "PACKED"] },
  { key: "DISPATCH", label: "Ready for dispatch", statuses: ["READY_FOR_DISPATCH", "ASSIGNED_TO_RIDER"] },
  { key: "OUT", label: "Out for delivery", statuses: ["OUT_FOR_DELIVERY"] },
  { key: "DELIVERED", label: "Delivered", statuses: ["DELIVERED"] },
];

/** Progress index of the current status along the happy-path journey. */
const STATUS_INDEX: Partial<Record<OrderStatus, number>> = {
  AWAITING_RIDER: 0,
  PENDING_PAYMENT: 0,
  CONFIRMED: 1,
  PROCESSING: 2,
  PACKED: 2,
  READY_FOR_DISPATCH: 3,
  ASSIGNED_TO_RIDER: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
};

const TERMINAL: Partial<Record<OrderStatus, string>> = {
  CANCELLED: "Cancelled",
  FAILED: "Payment failed",
  RETURNED: "Returned",
};

/** A customer-friendly delivery journey: canonical steps with done/current/
 *  upcoming state and real timestamps from the status journal. Terminal orders
 *  (cancelled/failed/returned) end on a single "stopped here" step. */
export function buildOrderJourney(
  order: { orderStatus: OrderStatus; createdAt: Date | string; deliveredAt?: Date | string | null },
  events: { status: OrderStatus; createdAt: Date | string }[]
): JourneyStep[] {
  const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

  // Earliest journal timestamp per status, for step times.
  const firstAt = new Map<OrderStatus, string>();
  for (const e of events) {
    if (!firstAt.has(e.status)) firstAt.set(e.status, new Date(e.createdAt).toISOString());
  }
  const stepTime = (statuses: OrderStatus[]): string | null => {
    for (const s of statuses) {
      const t = firstAt.get(s);
      if (t) return t;
    }
    return null;
  };

  // Terminal: show the steps completed so far, then a cancelled/stopped marker.
  if (TERMINAL[order.orderStatus]) {
    const reachedIdx = JOURNEY.reduce(
      (acc, step, i) => (stepTime(step.statuses) ? i : acc),
      0
    );
    const steps: JourneyStep[] = JOURNEY.slice(0, reachedIdx + 1).map((s, i) => ({
      key: s.key,
      label: s.label,
      state: "done",
      at: i === 0 ? iso(order.createdAt) : stepTime(s.statuses),
    }));
    steps.push({
      key: "STOPPED",
      label: TERMINAL[order.orderStatus] as string,
      state: "cancelled",
      at: stepTime([order.orderStatus]),
    });
    return steps;
  }

  const current = STATUS_INDEX[order.orderStatus] ?? 0;
  return JOURNEY.map((s, i) => {
    const state: JourneyStepState = i < current ? "done" : i === current ? "current" : "upcoming";
    let at: string | null = null;
    if (s.key === "PLACED") at = iso(order.createdAt);
    else if (s.key === "DELIVERED") at = iso(order.deliveredAt) ?? stepTime(s.statuses);
    else at = stepTime(s.statuses);
    // A done step with no journal entry (older orders) still shows as done, no time.
    return { key: s.key, label: s.label, state, at };
  });
}
