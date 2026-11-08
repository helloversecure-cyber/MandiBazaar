/**
 * Coupon rules (QA section T) — pure functions, safe to import on the client.
 *
 *  - Percentage coupons: 1–90 %, and a maximum discount (Rs) is required.
 *  - Fixed coupons: at least Rs 1, and the minimum order must be at least
 *    2× the discount (fixed value ≤ 50 % of the minimum order).
 *  - At apply time a discount never exceeds 90 % of the products subtotal,
 *    so products can never become free. Coupons only reduce products, never
 *    the delivery fee.
 *  - Customers always get the exact reason when a coupon does not apply.
 */
import { z } from "zod";
import { zCouponCode } from "@/lib/validators/pk";

export const COUPON_MAX_PERCENT = 90;
/** A discount can never be more than this share of the products subtotal. */
export const COUPON_MAX_SHARE_OF_SUBTOTAL = 0.9;
/** Fixed discount × this ≤ minimum order (i.e. fixed value ≤ 50 % of min order). */
export const COUPON_FIXED_MIN_ORDER_MULTIPLIER = 2;
export const COUPON_MAX_AMOUNT = 1_000_000;

export type CouponType = "PERCENTAGE" | "FIXED";

/** Coupon as the rules see it (Decimals already converted to numbers). */
export type CouponRecord = {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  minimumOrderAmount: number | null;
  maximumDiscount: number | null;
  startDate: Date;
  expiryDate: Date;
  usageLimit: number | null;
  perUserLimit: number | null;
  firstOrderOnly: boolean;
  usedCount: number;
  isActive: boolean;
};

export type CouponRejectionCode =
  | "NOT_FOUND"
  | "INACTIVE"
  | "MISCONFIGURED"
  | "NOT_STARTED"
  | "EXPIRED"
  | "USAGE_LIMIT"
  | "SIGN_IN"
  | "FIRST_ORDER_ONLY"
  | "ALREADY_USED"
  | "PHONE_NOT_VERIFIED"
  | "MIN_ORDER"
  | "NO_DISCOUNT";

export type CouponRejection = {
  code: CouponRejectionCode;
  message: string;
  /** MIN_ORDER only: rupees still missing */
  shortBy?: number;
  minimumOrder?: number;
};

/** Facts about the customer, gathered from the DB (null = guest). */
export type CouponCustomerFacts = {
  /** Uses of this coupon by this account, any account with the same phone, or the same delivery address/phone */
  customerUses: number;
  /** Has a previous order that was not cancelled/failed (this account or same phone) */
  hasPreviousOrder: boolean;
  /**
   * The account's phone is not verified AND the rule is enforced (SMS configured,
   * or development). Missing/false = no restriction.
   */
  phoneUnverified?: boolean;
};

export const PHONE_NOT_VERIFIED_MSG = "Verify your phone number to use coupons";

export type CouponEvaluation =
  | { ok: true; discount: number }
  | { ok: false; rejection: CouponRejection };

/** "Rs 1,000" — whole rupees with thousands separators. */
export function rs(n: number): string {
  const v = Math.round(Number(n) * 100) / 100;
  return `Rs ${v.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function fmtDate(d: Date): string {
  try {
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Karachi",
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Problems with a coupon's saved rules (used to block legacy unsafe coupons and to warn the admin). */
export function couponDefinitionProblems(c: {
  type: CouponType;
  value: number;
  minimumOrderAmount: number | null;
  maximumDiscount: number | null;
}): string[] {
  const out: string[] = [];
  const value = Number(c.value);
  const min = c.minimumOrderAmount != null ? Number(c.minimumOrderAmount) : 0;
  if (c.type === "PERCENTAGE") {
    if (!(value >= 1 && value <= COUPON_MAX_PERCENT)) {
      out.push(`Percentage must be from 1 to ${COUPON_MAX_PERCENT}% (now ${value}%)`);
    }
    if (c.maximumDiscount == null || !(Number(c.maximumDiscount) >= 1)) {
      out.push("Percentage coupons need a maximum discount (Rs)");
    }
  } else {
    if (!(value >= 1)) out.push("Fixed discount must be at least Rs 1");
    if (min < value * COUPON_FIXED_MIN_ORDER_MULTIPLIER) {
      out.push(
        `Minimum order must be at least ${rs(value * COUPON_FIXED_MIN_ORDER_MULTIPLIER)} (2× the ${rs(value)} discount)`
      );
    }
  }
  return out;
}

/**
 * Discount in whole rupees for a products subtotal (before delivery).
 * Never more than 90 % of the subtotal; never negative.
 */
export function computeCouponDiscount(
  c: Pick<CouponRecord, "type" | "value" | "maximumDiscount">,
  productsSubtotal: number
): number {
  const subtotal = Number(productsSubtotal);
  if (!(subtotal > 0)) return 0;
  const value = Number(c.value);
  if (!(value > 0)) return 0;

  let discount: number;
  if (c.type === "PERCENTAGE") {
    const pct = Math.min(value, COUPON_MAX_PERCENT);
    discount = (subtotal * pct) / 100;
    if (c.maximumDiscount != null && Number(c.maximumDiscount) > 0) {
      discount = Math.min(discount, Number(c.maximumDiscount));
    }
  } else {
    discount = value;
  }

  const cap = subtotal * COUPON_MAX_SHARE_OF_SUBTOTAL;
  discount = Math.min(discount, cap);
  // Whole rupees, rounded down (tiny epsilon absorbs float noise like 66.99999999999)
  discount = Math.floor(discount + 1e-7);
  return Math.max(0, discount);
}

/**
 * Decide whether a coupon applies. Checks run in the order the customer can act on:
 * code → active → dates → total limit → sign-in → first order → per-customer →
 * verified phone → minimum order.
 */
export function evaluateCoupon(
  coupon: CouponRecord | null,
  productsSubtotal: number,
  facts: CouponCustomerFacts | null,
  now: Date = new Date()
): CouponEvaluation {
  const reject = (r: CouponRejection): CouponEvaluation => ({ ok: false, rejection: r });

  if (!coupon) {
    return reject({ code: "NOT_FOUND", message: "This coupon code is not valid." });
  }
  if (!coupon.isActive) {
    return reject({ code: "INACTIVE", message: "This coupon is not active right now." });
  }
  if (couponDefinitionProblems(coupon).length > 0) {
    // Legacy coupons saved before the QA T2 rules (e.g. 120 %) are never applied.
    return reject({ code: "MISCONFIGURED", message: "This coupon is not available right now." });
  }
  if (now < coupon.startDate) {
    return reject({
      code: "NOT_STARTED",
      message: `This coupon starts on ${fmtDate(coupon.startDate)}.`,
    });
  }
  if (now > coupon.expiryDate) {
    return reject({
      code: "EXPIRED",
      message: `This coupon expired on ${fmtDate(coupon.expiryDate)}.`,
    });
  }
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return reject({
      code: "USAGE_LIMIT",
      message: "This coupon has reached its usage limit.",
    });
  }
  if (!facts) {
    return reject({ code: "SIGN_IN", message: "Sign in to use this coupon." });
  }
  if (coupon.firstOrderOnly && facts.hasPreviousOrder) {
    return reject({
      code: "FIRST_ORDER_ONLY",
      message: "This coupon is only for your first order.",
    });
  }
  if (coupon.perUserLimit != null && facts.customerUses >= coupon.perUserLimit) {
    return reject({
      code: "ALREADY_USED",
      message:
        coupon.perUserLimit === 1
          ? "You have already used this coupon."
          : `You have already used this coupon ${facts.customerUses} times (limit ${coupon.perUserLimit} per customer).`,
    });
  }
  if (facts.phoneUnverified) {
    return reject({ code: "PHONE_NOT_VERIFIED", message: PHONE_NOT_VERIFIED_MSG });
  }
  const minOrder = coupon.minimumOrderAmount != null ? Number(coupon.minimumOrderAmount) : 0;
  if (minOrder > 0 && productsSubtotal < minOrder) {
    const shortBy = Math.ceil((minOrder - productsSubtotal) * 100) / 100;
    return reject({
      code: "MIN_ORDER",
      message: `Add ${rs(shortBy)} more to use this coupon (minimum order ${rs(minOrder)}).`,
      shortBy,
      minimumOrder: minOrder,
    });
  }
  const discount = computeCouponDiscount(coupon, productsSubtotal);
  if (discount <= 0) {
    return reject({ code: "NO_DISCOUNT", message: "This coupon gives no discount on this order." });
  }
  return { ok: true, discount };
}

/** One-line summary of a coupon's rules, for the admin list. */
export function describeCouponValue(c: {
  type: CouponType;
  value: number;
  maximumDiscount: number | null;
}): string {
  if (c.type === "PERCENTAGE") {
    return `${c.value}% off${c.maximumDiscount != null ? `, up to ${rs(c.maximumDiscount)}` : ""}`;
  }
  return `${rs(c.value)} off`;
}

// ---------------------------------------------------------------------------
// Admin create / edit form schema (server + client share it)
// ---------------------------------------------------------------------------

const blankToNull = (v: unknown) =>
  v === "" || v === undefined || (typeof v === "string" && v.trim() === "") ? null : v;

function wholeRupees(label: string, min: number) {
  const message = `${label} must be a whole number of rupees from ${min.toLocaleString("en-PK")} to ${COUPON_MAX_AMOUNT.toLocaleString("en-PK")}`;
  return z.coerce
    .number({ message })
    .refine((v) => Number.isInteger(v) && v >= min && v <= COUPON_MAX_AMOUNT, { message });
}

function optionalCount(label: string, max: number) {
  const message = `${label} must be a whole number from 1 to ${max.toLocaleString("en-PK")}, or blank for no limit`;
  return z.preprocess(
    blankToNull,
    z
      .union([
        z.null(),
        z.coerce.number({ message }).refine((v) => Number.isInteger(v) && v >= 1 && v <= max, {
          message,
        }),
      ])
      .optional()
      .transform((v) => (v == null ? null : v))
  );
}

function dateField(label: string, edge: "start" | "end") {
  return z
    .union([z.string(), z.date()], { message: `${label} is required` })
    .transform((v, ctx) => {
      const raw = v instanceof Date ? "" : String(v).trim();
      const d = v instanceof Date ? v : edge === "start" ? pkDayStart(raw) : pkDayEnd(raw);
      if ((!(v instanceof Date) && !raw) || Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: `${label} must be a valid date` });
        return z.NEVER;
      }
      return d;
    });
}

/**
 * Coupon create / edit payload. Field names match the Coupon model.
 * Dates: "YYYY-MM-DD" start = start of that day (PKT), expiry = end of that day (PKT).
 */
export const couponDefinitionSchema = z
  .object({
    code: zCouponCode,
    type: z.enum(["PERCENTAGE", "FIXED"], { message: "Choose Percentage or Fixed amount" }),
    value: z.coerce.number({ message: "Enter the discount value" }),
    minimumOrderAmount: z.preprocess(
      blankToNull,
      z.union([z.null(), wholeRupees("Minimum order", 0)]).optional().transform((v) => (v == null ? null : v))
    ),
    maximumDiscount: z.preprocess(
      blankToNull,
      z.union([z.null(), wholeRupees("Maximum discount", 1)]).optional().transform((v) => (v == null ? null : v))
    ),
    usageLimit: optionalCount("Total usage limit", 1_000_000),
    perUserLimit: optionalCount("Uses per customer", 1_000),
    firstOrderOnly: z.boolean({ message: "First order only must be yes or no" }).optional().default(false),
    startDate: dateField("Start date", "start"),
    expiryDate: dateField("Expiry date", "end"),
    isActive: z.boolean({ message: "Active must be yes or no" }).optional().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.type === "PERCENTAGE") {
      if (!(Number.isInteger(d.value) && d.value >= 1 && d.value <= COUPON_MAX_PERCENT)) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: `Percentage must be a whole number from 1 to ${COUPON_MAX_PERCENT}`,
        });
      }
      if (d.maximumDiscount == null) {
        ctx.addIssue({
          code: "custom",
          path: ["maximumDiscount"],
          message: 'Percentage coupons need a maximum discount, e.g. "10% off, up to Rs 500"',
        });
      }
    } else {
      if (!(Number.isInteger(d.value) && d.value >= 1 && d.value <= COUPON_MAX_AMOUNT)) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "Fixed discount must be a whole number of rupees, at least Rs 1",
        });
      } else {
        const needed = d.value * COUPON_FIXED_MIN_ORDER_MULTIPLIER;
        if (d.minimumOrderAmount == null || d.minimumOrderAmount < needed) {
          ctx.addIssue({
            code: "custom",
            path: ["minimumOrderAmount"],
            message: `For ${rs(d.value)} off, the minimum order must be at least ${rs(needed)} (2× the discount)`,
          });
        }
      }
    }
    if (d.startDate && d.expiryDate && !(d.expiryDate.getTime() > d.startDate.getTime())) {
      ctx.addIssue({
        code: "custom",
        path: ["expiryDate"],
        message: "Expiry date must be after the start date",
      });
    }
  });

export type CouponDefinitionInput = z.input<typeof couponDefinitionSchema>;
export type CouponDefinition = z.output<typeof couponDefinitionSchema>;

/** "2026-01-31" → start of that day in Pakistan time (UTC+5). Other strings: Date(). */
export function pkDayStart(ymd: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T00:00:00+05:00`) : new Date(ymd);
}

/** "2026-01-31" → end of that day in Pakistan time (UTC+5). */
export function pkDayEnd(ymd: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(`${ymd}T23:59:59.999+05:00`) : new Date(ymd);
}

/** Date → "YYYY-MM-DD" in Pakistan time, for <input type="date">. */
export function toPkYmd(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const pk = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return pk.toISOString().slice(0, 10);
}
