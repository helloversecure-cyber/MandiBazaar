/** Rider's last known position (sent by the rider portal / app while online). */
import { prisma } from "@/lib/db";

export type RiderLocation = { latitude: number; longitude: number };

/** Pure: a valid lat/lng pair from user input, or null. */
export function parseRiderLocation(input: { latitude?: unknown; longitude?: unknown }): RiderLocation | null {
  const toNum = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const latitude = toNum(input.latitude);
  const longitude = toNum(input.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

export async function saveRiderLocation(riderId: string, loc: RiderLocation, at = new Date()) {
  await prisma.rider.update({
    where: { id: riderId },
    data: { lastLatitude: loc.latitude, lastLongitude: loc.longitude, lastLocationAt: at },
  });
}
