import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string, currency = "PKR") {
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateOrderNumber(seq: number, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `ORD-${y}${m}${d}-${String(seq).padStart(6, "0")}`;
}

export function discountPercent(price: number, salePrice?: number | null) {
  if (!salePrice || salePrice >= price || price <= 0) return 0;
  return Math.round(((price - salePrice) / price) * 100);
}

export function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return parseFloat(String(value)) || 0;
}

export function apiError(message: string, status = 400, code?: string) {
  return Response.json({ success: false, error: message, code }, { status });
}

/**
 * Turn any thrown value into a safe, user-friendly message. Internal details
 * (stack traces, SQL/Prisma errors, Firebase codes, file paths) are NEVER shown
 * to end users — log the real error server-side and show this instead. Known
 * business sentinels (short, human, no internal tokens) are passed through.
 */
export function toUserMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const looksInternal =
    !raw ||
    raw.length > 140 ||
    /\b(prisma|PrismaClient|P\d{4}|SQL|syntax|ECONNREFUSED|undefined|null|TypeError|at\s+\/|\.ts:|\.js:|firebase|auth\/|stack|Invalid `|constraint|relation ")/i.test(
      raw
    );
  return looksInternal ? "Something went wrong. Please try again in a few moments." : raw;
}

export function apiSuccess<T>(data: T, status = 200) {
  return Response.json({ success: true, data }, { status });
}

/**
 * 400 response with per-field messages (QA L2/M2: never just "Invalid input").
 * Body: { success:false, error:<first message>, fieldErrors:{ "phone": "Enter a valid…" } }
 */
export function apiFieldErrors(fieldErrors: Record<string, string>, status = 400) {
  const first = Object.values(fieldErrors)[0] || "Please check the highlighted fields";
  return Response.json(
    { success: false, error: first, code: "VALIDATION", fieldErrors },
    { status }
  );
}

/** apiFieldErrors() from a ZodError (first message per field path, joined with "."). */
export function apiZodError(error: { issues: { path: PropertyKey[]; message: string }[] }, status = 400) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return apiFieldErrors(fieldErrors, status);
}

/**
 * Safe page/limit parsing for list endpoints (handles junk like ?limit=abc).
 * Returns skip/take for Prisma.
 */
export function parsePagination(
  sp: URLSearchParams,
  opts: { defaultLimit?: number; maxLimit?: number } = {}
) {
  const { defaultLimit = 20, maxLimit = 50 } = opts;
  const rawPage = parseInt(sp.get("page") || "1", 10);
  const rawLimit = parseInt(sp.get("limit") || String(defaultLimit), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(maxLimit, rawLimit) : defaultLimit;
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/** Standard pagination block returned by list endpoints. */
export function paginationMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
