/**
 * Production error alerts by email.
 *
 * Sends a short, scrubbed report of a serious server error to the owner using
 * the same Resend sender as every other site email (`sendEmail` in
 * lib/notifications/service.ts, env RESEND_API_KEY + EMAIL_FROM). No new
 * secrets. Recipient: ALERT_EMAIL if set, otherwise DEFAULT_ALERT_EMAIL.
 *
 * Rules:
 *  - Only emails in production (VERCEL_ENV=production, or NODE_ENV=production
 *    on Vercel). Everywhere else the alert is only logged.
 *  - Never throws and never blocks the response: `reportServerError` returns
 *    immediately; delivery runs in the background with a timeout.
 *  - Throttled per serverless instance, in memory (there is no suitable DB
 *    table): the same error signature at most once per 15 minutes, and at most
 *    20 alert emails per hour overall. Several warm instances can each send, so
 *    the true ceiling is 20/hour per instance; that is acceptable for alerts.
 *  - No personal data: no request bodies, cookies, headers, query strings,
 *    emails, phone numbers or tokens. Messages and stacks are scrubbed.
 */

import { toUserMessage } from "@/lib/utils";

export const DEFAULT_ALERT_EMAIL = "mandibazaar62@gmail.com";
export const SIGNATURE_WINDOW_MS = 15 * 60 * 1000;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const GLOBAL_MAX_PER_WINDOW = 20;
export const SEND_TIMEOUT_MS = 8000;
const STACK_LINES = 15;

export type AlertContext = {
  /** Where it happened, e.g. "cron/lists-tick" or "POST /api/checkout". */
  source: string;
  /** Route path without query string; scrubbed anyway. */
  route?: string;
  method?: string;
  requestId?: string;
  /** Short non-personal extra label (e.g. "server" / "client"). */
  kind?: string;
};

export type AlertSender = (msg: { to: string; subject: string; text: string }) => Promise<boolean>;

type AlertEnv = Record<string, string | undefined>;

// ─── Scrubbing ────────────────────────────────────────────────────────────────

/** Remove anything that looks like personal data or a secret from a string. */
export function scrub(input: string): string {
  if (!input) return "";
  return (
    input
      // URLs with query strings: keep path only
      .replace(/(https?:\/\/[^\s?#"']+)\?[^\s"']*/gi, "$1?[query]")
      .replace(/(\/[\w\-./[\]]*)\?[^\s"']+/g, "$1?[query]")
      // Bearer / Basic auth values
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
      // key=value / key: value for secret-ish names
      .replace(
        /\b(token|secret|password|passwd|pwd|api[_-]?key|apikey|authorization|cookie|session|otp|(?:delivery|otp|verification|reset)[_-]?code|signature|sig)\b(["']?\s*[:=]\s*["']?)[^\s"'&,;}]+/gi,
        "$1$2[redacted]"
      )
      // JWTs
      .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt]")
      // Stripe / provider keys and ids with secrets
      .replace(/\b(sk|pk|rk|whsec|re|cs)_(live|test)?_?[A-Za-z0-9]{8,}\b/g, "[key]")
      // Connection strings with credentials
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[credentials]@")
      // Email addresses
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
      // Phone numbers (7+ digits, optional + and separators)
      .replace(/(?<![\w.])\+?\d[\d\s().-]{6,}\d(?![\w.])/g, "[number]")
      // Long hex / base64-like strings (tokens, hashes)
      .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[hex]")
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[token]")
  );
}

function errorParts(err: unknown): { name: string; message: string; stack: string } {
  try {
    if (err instanceof Error) {
      return {
        name: err.name || "Error",
        message: String(err.message ?? ""),
        stack: typeof err.stack === "string" ? err.stack : "",
      };
    }
    if (typeof err === "string") return { name: "Error", message: err, stack: "" };
    if (err && typeof err === "object") {
      const o = err as { name?: unknown; message?: unknown; stack?: unknown };
      return {
        name: typeof o.name === "string" ? o.name : "Error",
        message: typeof o.message === "string" ? o.message : "(non-Error value thrown)",
        stack: typeof o.stack === "string" ? o.stack : "",
      };
    }
    return { name: "Error", message: String(err), stack: "" };
  } catch {
    return { name: "Error", message: "(unreadable error)", stack: "" };
  }
}

/** First N stack lines, scrubbed. The first line repeats the message, so skip it. */
export function shortStack(stack: string, lines = STACK_LINES): string {
  if (!stack) return "";
  const all = stack.split("\n");
  const frames = all[0] && !/^\s+at\s/.test(all[0]) ? all.slice(1) : all;
  return scrub(frames.slice(0, lines).map((l) => l.trimEnd()).join("\n"));
}

/**
 * Stable signature for dedupe: error name + message with numbers/ids folded +
 * source + top stack frame. The same bug with different ids gets one email.
 */
export function errorSignature(err: unknown, ctx: AlertContext): string {
  const { name, message, stack } = errorParts(err);
  const normMsg = scrub(message)
    .replace(/\b[0-9a-z]{20,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .slice(0, 200);
  const top = (stack.split("\n").find((l) => /^\s+at\s/.test(l)) || "").trim().replace(/:\d+:\d+\)?$/, "");
  return [ctx.source, ctx.method || "", name, normMsg, top].join("|");
}

// ─── Gating ───────────────────────────────────────────────────────────────────

/** Alerts are emailed only on the production deployment. */
export function alertsEnabled(env: AlertEnv = process.env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production" && Boolean(env.VERCEL);
}

export function alertRecipient(env: AlertEnv = process.env): string {
  const override = env.ALERT_EMAIL?.trim();
  return override && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(override) ? override : DEFAULT_ALERT_EMAIL;
}

// ─── Throttle (in memory, per instance) ───────────────────────────────────────

export class AlertThrottle {
  private lastBySignature = new Map<string, number>();
  private sentTimes: number[] = [];

  constructor(
    private readonly signatureWindowMs = SIGNATURE_WINDOW_MS,
    private readonly globalWindowMs = GLOBAL_WINDOW_MS,
    private readonly globalMax = GLOBAL_MAX_PER_WINDOW
  ) {}

  /** True (and records the send) when this signature may be emailed now. */
  allow(signature: string, now = Date.now()): boolean {
    this.sentTimes = this.sentTimes.filter((t) => now - t < this.globalWindowMs);
    const last = this.lastBySignature.get(signature);
    if (last !== undefined && now - last < this.signatureWindowMs) return false;
    if (this.sentTimes.length >= this.globalMax) return false;
    this.lastBySignature.set(signature, now);
    this.sentTimes.push(now);
    if (this.lastBySignature.size > 500) {
      this.lastBySignature.forEach((t, k) => {
        if (now - t >= this.signatureWindowMs) this.lastBySignature.delete(k);
      });
    }
    return true;
  }

  reset() {
    this.lastBySignature.clear();
    this.sentTimes = [];
  }
}

const throttle = new AlertThrottle();

// ─── Email body ───────────────────────────────────────────────────────────────

export function buildAlertEmail(
  err: unknown,
  ctx: AlertContext,
  env: AlertEnv = process.env,
  now = new Date()
): { subject: string; text: string } {
  const { name, message, stack } = errorParts(err);
  const msg = scrub(message).slice(0, 500);
  const where = ctx.route ? scrub(ctx.route.split("?")[0]).slice(0, 200) : "";
  const environment = env.VERCEL_ENV || env.NODE_ENV || "unknown";
  const lines = [
    "MandiBazaar production error",
    "",
    `Source:      ${scrub(ctx.source).slice(0, 120)}`,
    ctx.kind ? `Kind:        ${scrub(ctx.kind).slice(0, 40)}` : "",
    ctx.method || where ? `Request:     ${(ctx.method || "").toUpperCase().slice(0, 10)} ${where}`.trimEnd() : "",
    `Time (UTC):  ${now.toISOString()}`,
    `Environment: ${environment}`,
    env.VERCEL_GIT_COMMIT_SHA ? `Commit:      ${env.VERCEL_GIT_COMMIT_SHA.slice(0, 12)}` : "",
    ctx.requestId ? `Request id:  ${scrub(ctx.requestId).slice(0, 100)}` : "",
    "",
    `Error:       ${name.slice(0, 80)}`,
    `Message:     ${msg}`,
    "",
    "Stack (first lines):",
    shortStack(stack) || "(no stack)",
    "",
    "Identical errors are emailed at most once every 15 minutes; at most 20 alerts per hour.",
    "Check the Vercel logs for the full details.",
  ].filter((l, i, arr) => l !== "" || arr[i - 1] !== "");
  const subject = `[MandiBazaar alert] ${name}: ${msg}`.slice(0, 150);
  return { subject, text: lines.join("\n") };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const defaultSender: AlertSender = async (msg) => {
  const { sendEmail } = await import("@/lib/notifications/service");
  return sendEmail(msg);
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(false as T);
      }
    );
  });
}

export type ReportOptions = {
  env?: AlertEnv;
  sender?: AlertSender;
  throttle?: AlertThrottle;
  now?: Date;
  timeoutMs?: number;
};

/**
 * Deliver an alert. Resolves to what happened; never rejects. Most callers
 * should use `reportServerError` (fire-and-forget) instead.
 */
export async function deliverAlert(
  err: unknown,
  ctx: AlertContext,
  opts: ReportOptions = {}
): Promise<"sent" | "failed" | "throttled" | "disabled"> {
  try {
    const env = opts.env ?? process.env;
    const { subject, text } = buildAlertEmail(err, ctx, env, opts.now);
    if (!alertsEnabled(env)) {
      console.warn(`[alert:log-only] ${subject}`);
      return "disabled";
    }
    const t = opts.throttle ?? throttle;
    if (!t.allow(errorSignature(err, ctx), (opts.now ?? new Date()).getTime())) return "throttled";
    const sender = opts.sender ?? defaultSender;
    let sending: Promise<boolean>;
    try {
      sending = Promise.resolve(sender({ to: alertRecipient(env), subject, text }));
    } catch {
      sending = Promise.resolve(false);
    }
    const res = await withTimeout(sending, opts.timeoutMs ?? SEND_TIMEOUT_MS);
    if (res === true) return "sent";
    console.error(`[alert] email not sent (${res === "timeout" ? "timeout" : "provider not configured or rejected"})`);
    return "failed";
  } catch {
    return "failed";
  }
}

/**
 * On Vercel, ask the platform to keep the function alive until the email is
 * sent (the same hook `@vercel/functions` waitUntil uses; no dependency).
 * Elsewhere the promise simply runs in the background.
 */
function keepAlive(p: Promise<unknown>) {
  try {
    const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as
      | { get?: () => { waitUntil?: (p: Promise<unknown>) => void } | undefined }
      | undefined;
    ctx?.get?.()?.waitUntil?.(p);
  } catch {
    // ignore
  }
}

/**
 * Report a serious server error. Returns immediately and never throws; the
 * email (production only, throttled) is sent in the background.
 */
export function reportServerError(err: unknown, ctx: AlertContext, opts: ReportOptions = {}): void {
  try {
    const p = deliverAlert(err, ctx, opts).catch(() => undefined);
    keepAlive(p);
  } catch {
    // never throw from the alerter
  }
}

/** Route context from a request without query string, body, headers or cookies. */
export function requestContext(req: Request, source?: string): AlertContext {
  try {
    const url = new URL(req.url);
    return {
      source: source || `${req.method} ${url.pathname}`,
      method: req.method,
      route: url.pathname,
      requestId: req.headers.get("x-vercel-id") || undefined,
    };
  } catch {
    return { source: source || "request" };
  }
}

/**
 * True when a caught error is not a business/validation message — i.e. the
 * same test `toUserMessage` uses to hide internal details from users. Use it in
 * catch blocks that mix expected errors (shown to the user) with real bugs.
 */
export function isUnexpectedError(e: unknown): boolean {
  try {
    const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    return toUserMessage(e) !== raw;
  } catch {
    return true;
  }
}

/** Test hook: clear the shared in-memory throttle. */
export function __resetAlertThrottleForTests() {
  throttle.reset();
}
