import { describe, it, expect } from "vitest";
import {
  remittanceDue,
  outstanding,
  deadlineFrom,
  remittanceCountdown,
  deriveRemittanceStatus,
  isCodOverdue,
  DEFAULT_REMITTANCE_DEADLINE_HOURS,
} from "@/lib/finance/remittance";

describe("remittanceDue — rider retains the delivery fee", () => {
  it("normal COD: delivery paid online, rider remits full product cash", () => {
    // Collected 10,000 product cash, retained 0 (fee was online)
    expect(remittanceDue(10000, 0)).toBe(10000);
  });
  it("full COD: rider keeps the cash delivery fee, remits products only", () => {
    // Collected 10,300 (products 10,000 + fee 300), retains 300
    expect(remittanceDue(10300, 300)).toBe(10000);
  });
  it("never negative and never double-charges the fee", () => {
    expect(remittanceDue(200, 300)).toBe(0);
    expect(remittanceDue(0, 0)).toBe(0);
  });
  it("rounds to 2 decimals", () => {
    expect(remittanceDue(100.555, 0.004)).toBe(100.55);
  });
});

describe("outstanding balance", () => {
  it("due minus verified-remitted", () => {
    expect(outstanding(10000, 6000)).toBe(4000);
  });
  it("clamps at zero when over-remitted", () => {
    expect(outstanding(10000, 11000)).toBe(0);
  });
});

describe("deadline / countdown (backend clock)", () => {
  it("default window is 48h", () => {
    expect(DEFAULT_REMITTANCE_DEADLINE_HOURS).toBe(48);
    const start = new Date("2026-01-01T00:00:00Z");
    expect(deadlineFrom(start).toISOString()).toBe("2026-01-03T00:00:00.000Z");
  });
  it("countdown reports time left, not overdue before deadline", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const due = new Date("2026-01-01T10:00:00Z");
    const c = remittanceCountdown(due, now);
    expect(c.overdue).toBe(false);
    expect(c.msLeft).toBe(10 * 3600 * 1000);
  });
  it("countdown is overdue past the deadline", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const due = new Date("2026-01-01T10:00:00Z");
    expect(remittanceCountdown(due, now).overdue).toBe(true);
  });
});

describe("deriveRemittanceStatus", () => {
  const dueFuture = new Date(Date.now() + 36 * 3600 * 1000);
  const duePast = new Date(Date.now() - 1 * 3600 * 1000);

  it("PENDING when nothing submitted and within deadline", () => {
    expect(
      deriveRemittanceStatus({ current: "PENDING", amountDue: 10000, amountRemitted: 0, dueAt: dueFuture, hasPendingSubmission: false })
    ).toBe("PENDING");
  });
  it("UNDER_VERIFICATION when a submission awaits review", () => {
    expect(
      deriveRemittanceStatus({ current: "PENDING", amountDue: 10000, amountRemitted: 0, dueAt: dueFuture, hasPendingSubmission: true })
    ).toBe("UNDER_VERIFICATION");
  });
  it("PARTIALLY_REMITTED when some verified, balance remains, in time", () => {
    expect(
      deriveRemittanceStatus({ current: "PENDING", amountDue: 10000, amountRemitted: 6000, dueAt: dueFuture, hasPendingSubmission: false })
    ).toBe("PARTIALLY_REMITTED");
  });
  it("RECEIVED only when fully settled", () => {
    expect(
      deriveRemittanceStatus({ current: "PARTIALLY_REMITTED", amountDue: 10000, amountRemitted: 10000, dueAt: duePast, hasPendingSubmission: false })
    ).toBe("RECEIVED");
  });
  it("OVERDUE when past deadline with balance left (even if partly paid)", () => {
    expect(
      deriveRemittanceStatus({ current: "PARTIALLY_REMITTED", amountDue: 10000, amountRemitted: 6000, dueAt: duePast, hasPendingSubmission: false })
    ).toBe("OVERDUE");
    expect(
      deriveRemittanceStatus({ current: "PENDING", amountDue: 10000, amountRemitted: 0, dueAt: duePast, hasPendingSubmission: false })
    ).toBe("OVERDUE");
  });
  it("DISPUTED is preserved", () => {
    expect(
      deriveRemittanceStatus({ current: "DISPUTED", amountDue: 10000, amountRemitted: 0, dueAt: duePast, hasPendingSubmission: false })
    ).toBe("DISPUTED");
  });
  it("a rejected proof does NOT clear the obligation (stays owed)", () => {
    // Rejected submission → amountRemitted still 0 → not RECEIVED
    const s = deriveRemittanceStatus({ current: "PENDING", amountDue: 10000, amountRemitted: 0, dueAt: dueFuture, hasPendingSubmission: false });
    expect(s).not.toBe("RECEIVED");
  });
});

describe("isCodOverdue (restriction trigger)", () => {
  it("overdue when past deadline with balance", () => {
    expect(isCodOverdue(new Date(Date.now() - 1000), 10000, 0)).toBe(true);
  });
  it("not overdue when fully remitted", () => {
    expect(isCodOverdue(new Date(Date.now() - 1000), 10000, 10000)).toBe(false);
  });
  it("not overdue before the deadline", () => {
    expect(isCodOverdue(new Date(Date.now() + 10000), 10000, 0)).toBe(false);
  });
});
