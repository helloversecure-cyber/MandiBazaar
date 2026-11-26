import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AlertThrottle,
  DEFAULT_ALERT_EMAIL,
  GLOBAL_MAX_PER_WINDOW,
  SIGNATURE_WINDOW_MS,
  alertRecipient,
  alertsEnabled,
  buildAlertEmail,
  deliverAlert,
  errorSignature,
  isUnexpectedError,
  reportServerError,
  scrub,
  shortStack,
} from "@/lib/monitoring/alerts";

const PROD = { VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production" };

function okSender() {
  return vi.fn(async () => true);
}

describe("production-only gating", () => {
  it("enables only on the production deployment", () => {
    expect(alertsEnabled(PROD)).toBe(true);
    expect(alertsEnabled({ VERCEL: "1", VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
    expect(alertsEnabled({ VERCEL: "1", VERCEL_ENV: "development" })).toBe(false);
    expect(alertsEnabled({ NODE_ENV: "production" })).toBe(false); // local `next start`
    expect(alertsEnabled({ NODE_ENV: "production", VERCEL: "1" })).toBe(true);
    expect(alertsEnabled({ NODE_ENV: "test" })).toBe(false);
  });

  it("logs only outside production and never calls the sender", async () => {
    const sender = okSender();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await deliverAlert(new Error("boom"), { source: "t" }, {
      env: { VERCEL_ENV: "preview" },
      sender,
      throttle: new AlertThrottle(),
    });
    expect(r).toBe("disabled");
    expect(sender).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("sends to the default address, or ALERT_EMAIL when set", async () => {
    expect(alertRecipient({})).toBe(DEFAULT_ALERT_EMAIL);
    expect(alertRecipient({ ALERT_EMAIL: "ops@example.com" })).toBe("ops@example.com");
    expect(alertRecipient({ ALERT_EMAIL: "not an email" })).toBe(DEFAULT_ALERT_EMAIL);
    const sender = okSender();
    const r = await deliverAlert(new Error("boom"), { source: "t" }, { env: PROD, sender, throttle: new AlertThrottle() });
    expect(r).toBe("sent");
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ to: "mandibazaar62@gmail.com" }));
  });
});

describe("throttling", () => {
  it("emails the same signature at most once per 15 minutes", () => {
    const t = new AlertThrottle();
    const now = 1_000_000;
    expect(t.allow("a", now)).toBe(true);
    expect(t.allow("a", now + 60_000)).toBe(false);
    expect(t.allow("a", now + SIGNATURE_WINDOW_MS - 1)).toBe(false);
    expect(t.allow("a", now + SIGNATURE_WINDOW_MS)).toBe(true);
  });

  it("caps all alerts at 20 per hour", () => {
    const t = new AlertThrottle();
    const now = 5_000_000;
    for (let i = 0; i < GLOBAL_MAX_PER_WINDOW; i++) expect(t.allow(`sig-${i}`, now + i)).toBe(true);
    expect(t.allow("one-more", now + 100)).toBe(false);
    expect(t.allow("one-more", now + 60 * 60 * 1000 + 1)).toBe(true);
  });

  it("a burst of the same error sends one email", async () => {
    const sender = okSender();
    const throttle = new AlertThrottle();
    const results = [];
    for (let i = 0; i < 50; i++) {
      results.push(await deliverAlert(new Error(`DB timeout for order ${i}`), { source: "orders/GET" }, { env: PROD, sender, throttle }));
    }
    expect(sender).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r === "throttled")).toHaveLength(49);
  });
});

describe("signature dedupe", () => {
  it("folds ids and numbers so the same bug has one signature", () => {
    const a = errorSignature(new Error("Order ckx1a2b3c4d5e6f7g8h9i0j1 not found (row 12)"), { source: "x" });
    const b = errorSignature(new Error("Order ckz9y8x7w6v5u4t3s2r1q0p9 not found (row 99)"), { source: "x" });
    expect(a).toBe(b);
  });

  it("different source, error type or message gives a different signature", () => {
    const base = errorSignature(new Error("x failed"), { source: "a" });
    expect(errorSignature(new Error("x failed"), { source: "b" })).not.toBe(base);
    expect(errorSignature(new TypeError("x failed"), { source: "a" })).not.toBe(base);
    expect(errorSignature(new Error("y broke"), { source: "a" })).not.toBe(base);
  });
});

describe("scrubbing", () => {
  it("removes emails, phones, tokens, keys and credentials", () => {
    const s = scrub(
      "user ali.khan@gmail.com phone +92 300 1234567 / 03001234567 Bearer abc.def.ghi " +
        "token=abcd1234 password: hunter2 deliveryCode=4821 sk_live_51Habcdefghijklmnop " +
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijk " +
        "postgresql://mb:secretpw@db.neon.tech/main /api/x?email=a%40b.com&t=1"
    );
    for (const bad of [
      "ali.khan@gmail.com",
      "1234567",
      "03001234567",
      "abc.def.ghi",
      "abcd1234",
      "hunter2",
      "4821",
      "sk_live_51H",
      "eyJhbGciOiJIUzI1NiJ9",
      "secretpw",
      "a%40b.com",
    ]) {
      expect(s).not.toContain(bad);
    }
    expect(s).toContain("[email]");
    expect(s).toContain("/api/x?[query]");
  });

  it("keeps a short scrubbed stack (first 15 frames)", () => {
    const stack = ["Error: boom"].concat(Array.from({ length: 30 }, (_, i) => `    at fn${i} (/var/task/a.js:${i}:1)`)).join("\n");
    const s = shortStack(stack);
    expect(s.split("\n")).toHaveLength(15);
    expect(s).toContain("fn0");
    expect(s).not.toContain("fn15");
  });

  it("the email contains context but no personal data", () => {
    const err = new Error("Customer 03001234567 (sara@example.com) failed");
    const { subject, text } = buildAlertEmail(
      err,
      { source: "orders/checkout", method: "post", route: "/api/checkout?phone=03001234567", requestId: "bom1::abc" },
      PROD,
      new Date("2026-11-27T10:00:00Z")
    );
    expect(subject).toContain("[MandiBazaar alert] Error");
    expect(text).toContain("orders/checkout");
    expect(text).toContain("POST /api/checkout");
    expect(text).toContain("2026-11-27T10:00:00.000Z");
    expect(text).toContain("production");
    expect(text).toContain("bom1::abc");
    expect(text).toContain("Stack");
    expect(subject + text).not.toContain("03001234567");
    expect(subject + text).not.toContain("sara@example.com");
  });
});

describe("never throws, never blocks", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("survives a sender that throws or rejects", async () => {
    const throwing = vi.fn(() => {
      throw new Error("sync fail");
    }) as unknown as () => Promise<boolean>;
    const rejecting = vi.fn(async () => {
      throw new Error("async fail");
    });
    await expect(deliverAlert(new Error("a"), { source: "t" }, { env: PROD, sender: throwing, throttle: new AlertThrottle() })).resolves.toBe("failed");
    await expect(deliverAlert(new Error("b"), { source: "t" }, { env: PROD, sender: rejecting, throttle: new AlertThrottle() })).resolves.toBe("failed");
  });

  it("times out a hanging sender", async () => {
    const hanging = vi.fn(() => new Promise<boolean>(() => undefined));
    const r = await deliverAlert(new Error("slow"), { source: "t" }, { env: PROD, sender: hanging, throttle: new AlertThrottle(), timeoutMs: 20 });
    expect(r).toBe("failed");
  });

  it("handles odd thrown values", async () => {
    const sender = okSender();
    for (const v of [null, undefined, 42, "str", { weird: true }, Object.create(null)]) {
      await expect(deliverAlert(v, { source: "t" }, { env: PROD, sender, throttle: new AlertThrottle() })).resolves.toMatch(/sent|failed/);
    }
  });

  it("reportServerError returns synchronously even if the sender hangs", () => {
    const hanging = vi.fn(() => new Promise<boolean>(() => undefined));
    const t0 = Date.now();
    expect(() =>
      reportServerError(new Error("x"), { source: "t" }, { env: PROD, sender: hanging, throttle: new AlertThrottle(), timeoutMs: 10 })
    ).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(50);
  });
});

describe("isUnexpectedError", () => {
  it("separates business messages from internal errors", () => {
    expect(isUnexpectedError(new Error("Cash was already collected"))).toBe(false);
    expect(isUnexpectedError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(true);
    expect(isUnexpectedError(new Error("Invalid `prisma.order.update()` invocation"))).toBe(true);
    expect(isUnexpectedError(null)).toBe(true);
  });
});
