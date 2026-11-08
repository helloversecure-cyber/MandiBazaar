import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/utils";

/**
 * Delivery fee rules (QA E5, T2, U4, U5):
 *  - Free when every product is marked free-delivery, or when the PRODUCTS
 *    SUBTOTAL BEFORE ANY COUPON reaches the free-delivery threshold.
 *  - Otherwise Rs <deliveryRatePerKm>/km for the round trip (go + return) when
 *    store and customer map pins exist; else the default fee (+ a small extra
 *    per additional store). Capped at StoreSettings.maxDeliveryFee when set.
 *  - Minimum order (StoreSettings.minimumOrderAmount) is checked on the same
 *    products subtotal before discount.
 * Coupons never reduce the delivery fee.
 */

export type StoreLocation = {
  storeId: string;
  latitude?: number | null;
  longitude?: number | null;
  city: string;
};

export type DeliveryFeeInput = {
  city: string;
  area?: string;
  latitude?: number | null;
  longitude?: number | null;
  /** Products subtotal BEFORE coupon discount, without delivery. */
  productsSubtotal: number;
  stores: StoreLocation[];
  /** True when every cart product is marked free-delivery by its store */
  allProductsFreeDelivery?: boolean;
};

export type DeliveryFeeBasis = "FREE_PRODUCTS" | "FREE_THRESHOLD" | "DISTANCE" | "FLAT";

export type DeliveryFeeResult = {
  fee: number;
  isFree: boolean;
  basis: DeliveryFeeBasis;
  reason: string;
  minimumOrderAmount: number;
  meetsMinimum: boolean;
  /** Rupees still needed to reach the minimum order (0 when met) */
  minimumOrderShortBy: number;
  /** One-way distance (store → customer), km */
  oneWayKm: number;
  /** Billed distance = go + return (2 × one-way), km */
  distanceKm: number;
  ratePerKm: number;
  /** 0 = no free-delivery threshold */
  freeDeliveryThreshold: number;
  /** Rupees still needed for free delivery (0 when free or no threshold) */
  freeDeliveryShortBy: number;
  maxDeliveryFee: number | null;
  /** True when the fee was capped at maxDeliveryFee */
  capped: boolean;
};

export type DeliverySettings = {
  ratePerKm: number;
  defaultFee: number;
  /** 0 = no free-delivery threshold */
  freeDeliveryThreshold: number;
  minimumOrderAmount: number;
  /** null = no cap */
  maxDeliveryFee: number | null;
};

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  ratePerKm: 10,
  defaultFee: 100,
  freeDeliveryThreshold: 5000,
  minimumOrderAmount: 0,
  maxDeliveryFee: null,
};

/** Haversine distance in km */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Round-trip billed km: go + return */
export function roundTripKm(oneWayKm: number): number {
  return oneWayKm * 2;
}

function nonNegative(n: unknown, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** StoreSettings row → numbers (null/garbage → defaults). */
export function toDeliverySettings(
  row:
    | {
        deliveryRatePerKm?: unknown;
        defaultDeliveryFee?: unknown;
        freeDeliveryThreshold?: unknown;
        minimumOrderAmount?: unknown;
        maxDeliveryFee?: unknown;
      }
    | null
    | undefined
): DeliverySettings {
  const d = DEFAULT_DELIVERY_SETTINGS;
  if (!row) return { ...d };
  const num = (v: unknown) => (v == null ? null : toNumber(v));
  const threshold = num(row.freeDeliveryThreshold);
  const cap = num(row.maxDeliveryFee);
  return {
    ratePerKm: nonNegative(num(row.deliveryRatePerKm), d.ratePerKm),
    defaultFee: nonNegative(num(row.defaultDeliveryFee), d.defaultFee),
    // Not set → platform default 5,000; 0 → no free-delivery threshold
    freeDeliveryThreshold: threshold == null ? d.freeDeliveryThreshold : nonNegative(threshold, 0),
    minimumOrderAmount: nonNegative(num(row.minimumOrderAmount), 0),
    maxDeliveryFee: cap != null && Number.isFinite(cap) && cap > 0 ? cap : null,
  };
}

export async function getDeliverySettings(): Promise<DeliverySettings> {
  const row = await prisma.storeSettings.findFirst();
  return toDeliverySettings(row);
}

/** Fee when no map distance can be used: default fee + 2 km × rate per extra store. */
export function flatDeliveryFee(settings: DeliverySettings, storeCount: number): number {
  const n = Math.max(1, storeCount);
  return Math.round(settings.defaultFee + (n - 1) * settings.ratePerKm * 2);
}

function applyCap(fee: number, settings: DeliverySettings) {
  if (settings.maxDeliveryFee != null && fee > settings.maxDeliveryFee) {
    return { fee: Math.round(settings.maxDeliveryFee), capped: true };
  }
  return { fee, capped: false };
}

/** Pure fee calculation (unit-tested). */
export function computeDeliveryFee(
  input: DeliveryFeeInput,
  settings: DeliverySettings
): DeliveryFeeResult {
  const { ratePerKm, freeDeliveryThreshold: threshold, minimumOrderAmount } = settings;
  const subtotal = nonNegative(input.productsSubtotal, 0);
  const meetsMinimum = subtotal >= minimumOrderAmount;
  const minimumOrderShortBy = meetsMinimum
    ? 0
    : Math.ceil((minimumOrderAmount - subtotal) * 100) / 100;
  const base = {
    minimumOrderAmount,
    meetsMinimum,
    minimumOrderShortBy,
    ratePerKm,
    freeDeliveryThreshold: threshold,
    maxDeliveryFee: settings.maxDeliveryFee,
  };

  if (input.allProductsFreeDelivery) {
    return {
      ...base,
      fee: 0,
      isFree: true,
      basis: "FREE_PRODUCTS",
      reason: "Free delivery — every product in your cart has free delivery",
      oneWayKm: 0,
      distanceKm: 0,
      freeDeliveryShortBy: 0,
      capped: false,
    };
  }

  if (threshold > 0 && subtotal >= threshold) {
    return {
      ...base,
      fee: 0,
      isFree: true,
      basis: "FREE_THRESHOLD",
      reason: `Free delivery on orders of Rs ${threshold.toLocaleString("en-PK")} or more`,
      oneWayKm: 0,
      distanceKm: 0,
      freeDeliveryShortBy: 0,
      capped: false,
    };
  }

  const freeDeliveryShortBy =
    threshold > 0 ? Math.ceil((threshold - subtotal) * 100) / 100 : 0;

  const destLat = input.latitude;
  const destLon = input.longitude;
  const anyStorePinned = input.stores.some((s) => s.latitude != null && s.longitude != null);

  if (destLat != null && destLon != null && anyStorePinned) {
    // Sum store→customer one-way distances for multi-store pickups.
    // A store without a pin is billed at the default fee instead of a distance.
    let pinnedOneWayKm = 0;
    let unpinnedFee = 0;
    for (const store of input.stores) {
      if (store.latitude == null || store.longitude == null) {
        unpinnedFee += settings.defaultFee;
        continue;
      }
      pinnedOneWayKm += haversineKm(store.latitude, store.longitude, destLat, destLon);
    }

    const billedKm = roundTripKm(pinnedOneWayKm);
    const raw = Math.max(ratePerKm, Math.round(billedKm * ratePerKm + unpinnedFee));
    const { fee, capped } = applyCap(raw, settings);
    const oneWayRounded = Math.round(pinnedOneWayKm * 10) / 10;
    const billedRounded = Math.round(billedKm * 10) / 10;

    return {
      ...base,
      fee,
      isFree: false,
      basis: "DISTANCE",
      reason:
        `Rs ${ratePerKm}/km × (${oneWayRounded} km go + ${oneWayRounded} km return = ${billedRounded} km)` +
        (capped ? ` · capped at Rs ${fee.toLocaleString("en-PK")}` : ""),
      oneWayKm: Math.round(pinnedOneWayKm * 1000) / 1000,
      distanceKm: Math.round(billedKm * 1000) / 1000,
      freeDeliveryShortBy,
      capped,
    };
  }

  // No usable map pins: flat default fee (+ extra per additional store)
  const storeCount = Math.max(1, input.stores.length);
  const { fee, capped } = applyCap(flatDeliveryFee(settings, storeCount), settings);
  const impliedOneWay = ratePerKm > 0 ? Math.round((fee / ratePerKm / 2) * 10) / 10 : 0;

  return {
    ...base,
    fee,
    isFree: false,
    basis: "FLAT",
    reason:
      storeCount > 1
        ? `Delivery fee for ${storeCount} stores`
        : `Standard delivery fee for ${input.city || "your area"}`,
    oneWayKm: impliedOneWay,
    distanceKm: impliedOneWay * 2,
    freeDeliveryShortBy,
    capped,
  };
}

export async function calculateDeliveryFee(
  input: DeliveryFeeInput,
  settings?: DeliverySettings
): Promise<DeliveryFeeResult> {
  return computeDeliveryFee(input, settings ?? (await getDeliverySettings()));
}

/**
 * What the cart can say before the address is known (QA E5).
 * Same rules for guest and signed-in carts.
 */
export type CartDeliveryEstimate =
  | { kind: "FREE"; message: string; fee: 0 }
  | { kind: "FIXED"; message: string; fee: number }
  | { kind: "FROM"; message: string; fee: number };

export function estimateCartDelivery(opts: {
  productsSubtotal: number;
  allProductsFreeDelivery: boolean;
  stores: StoreLocation[];
  settings: DeliverySettings;
}): CartDeliveryEstimate {
  const { settings } = opts;
  const noPin = computeDeliveryFee(
    {
      city: "",
      productsSubtotal: opts.productsSubtotal,
      stores: opts.stores,
      allProductsFreeDelivery: opts.allProductsFreeDelivery,
    },
    settings
  );
  if (noPin.isFree) return { kind: "FREE", message: noPin.reason, fee: 0 };

  const anyStorePinned = opts.stores.some((s) => s.latitude != null && s.longitude != null);
  if (!anyStorePinned) {
    // Fee does not depend on the address: it is exactly the flat fee.
    return {
      kind: "FIXED",
      message: `Delivery fee: Rs ${noPin.fee.toLocaleString("en-PK")} (paid online)`,
      fee: noPin.fee,
    };
  }
  // Distance-based: smallest possible fee is one km-rate; flat fee if no pin
  const from = Math.min(noPin.fee, Math.max(settings.ratePerKm, 0));
  return {
    kind: "FROM",
    message: `Delivery fee: calculated at checkout from your address (from Rs ${from.toLocaleString("en-PK")}, Rs ${settings.ratePerKm}/km)`,
    fee: from,
  };
}
