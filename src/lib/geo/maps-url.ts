/**
 * Read coordinates out of Google Maps links (QA L3 / N7).
 *
 * Supported shapes:
 *   …/place/Name/@31.52,74.35,17z/data=!3m1!4b1!4m6!3m5!1s…!8m2!3d31.5204!4d74.3587  (pin = !3d/!4d)
 *   …/maps/@31.52,74.35,15z
 *   …/maps?q=31.52,74.35   (also query=, ll=, center=, destination=, daddr=, sll=)
 *   …/maps/search/31.52,+74.35   …/maps/place/31.52,74.35
 * Short links (maps.app.goo.gl / goo.gl/maps) are followed server-side, only to
 * Google hosts, max 5 hops, 5 s total.
 */

export type LatLng = { lat: number; lng: number };

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";

function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

function safeDecode(v: string): string {
  let out = v;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(out.replace(/\+/g, " "));
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

/** Pure parser — no network. Returns null when no coordinates are present. */
export function extractCoordsFromMapsUrl(raw: string | null | undefined): LatLng | null {
  if (!raw || typeof raw !== "string") return null;
  const url = safeDecode(raw.trim());

  // 1) Exact place pin: !3dLAT!4dLNG (more precise than the viewport "@")
  const pin = new RegExp(`!3d${NUM}!4d${NUM}`).exec(url);
  if (pin) {
    const r = valid(Number(pin[1]), Number(pin[2]));
    if (r) return r;
  }

  // 2) Query parameters: q=, query=, ll=, center=, destination=, daddr=, sll=
  const param = new RegExp(
    `[?&](?:q|query|ll|sll|center|destination|daddr)=(?:loc:)?\\s*${NUM}\\s*,\\s*${NUM}`
  ).exec(url);
  if (param) {
    const r = valid(Number(param[1]), Number(param[2]));
    if (r) return r;
  }

  // 3) Viewport centre: @LAT,LNG
  const at = new RegExp(`@${NUM},${NUM}`).exec(url);
  if (at) {
    const r = valid(Number(at[1]), Number(at[2]));
    if (r) return r;
  }

  // 4) /maps/search/LAT,LNG  or /maps/place/LAT,LNG  or /maps/dir//LAT,LNG
  const path = new RegExp(`/(?:search|place|dir)/+\\s*${NUM}\\s*,\\s*${NUM}`).exec(url);
  if (path) {
    const r = valid(Number(path[1]), Number(path[2]));
    if (r) return r;
  }

  return null;
}

/** Hosts we are willing to contact while expanding short links. */
export function isGoogleMapsHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "maps.app.goo.gl" || h === "goo.gl") return true;
  return /^(?:[a-z0-9-]+\.)*google\.(?:com|com\.pk|pk)$/.test(h);
}

export function isShortMapsLink(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return (
      u.protocol === "https:" &&
      (u.hostname === "maps.app.goo.gl" || (u.hostname === "goo.gl" && u.pathname.startsWith("/maps")))
    );
  } catch {
    return false;
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Parse coordinates; for short links, follow redirects (manual, Google hosts only,
 * max 5 hops, 5 s timeout) and parse each Location. Never throws.
 */
export async function resolveMapsUrlCoords(
  raw: string | null | undefined,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number; maxHops?: number } = {}
): Promise<LatLng | null> {
  if (!raw) return null;
  const direct = extractCoordsFromMapsUrl(raw);
  if (direct) return direct;
  if (!isShortMapsLink(raw)) return null;

  const fetchImpl: FetchLike = opts.fetchImpl || ((i, init) => fetch(i, init));
  const maxHops = opts.maxHops ?? 5;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000);

  try {
    let current = raw.trim();
    for (let hop = 0; hop < maxHops; hop++) {
      let u: URL;
      try {
        u = new URL(current);
      } catch {
        return null;
      }
      if (u.protocol !== "https:" || !isGoogleMapsHost(u.hostname)) return null;

      const res = await fetchImpl(u.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (MandiBazaar location check)" },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const next = new URL(location, u).toString();
        const found = extractCoordsFromMapsUrl(next);
        if (found) return found;
        current = next;
        continue;
      }
      return null;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
