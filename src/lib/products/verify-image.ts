/**
 * Product photo check (QA N8).
 *
 * The check must never claim photos "look consistent" unless an image model
 * actually looked at every photo and said they match.
 *
 * - With OPENAI_API_KEY: each photo is sent to the vision model, which must
 *   answer per photo with matched true/false and a reason. Anything that is
 *   not a clear, parseable answer counts as "unverified" (never a pass).
 * - Without a key there is no image understanding at all: the result is
 *   "unavailable" and the UI asks the store to confirm the photos themselves;
 *   MandiBazaar reviews every new product / photo change anyway.
 */
import { readFile } from "fs/promises";
import path from "path";

export type PhotoStatus = "match" | "mismatch" | "unverified";

export type ImageVerifyResult = {
  imageUrl: string;
  status: PhotoStatus;
  /** Back-compat: true only for a real "match". */
  matched: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  /** What the model thinks the photo shows (when it said). */
  seen?: string;
  provider: "openai" | "none";
};

export type VerifyVerdict = "verified" | "mismatch" | "unverified" | "unavailable";

export type VerifyImagesResult = {
  /** True only when every photo was checked and matched. */
  ok: boolean;
  verdict: VerifyVerdict;
  visionEnabled: boolean;
  results: ImageVerifyResult[];
  summary: string;
};

export const COULD_NOT_VERIFY =
  "Couldn't verify these photos automatically — an admin will review the photos.";
export const NO_VISION_SUMMARY =
  "Automatic photo checking isn't available. Please confirm that every photo shows this exact product — an admin reviews all product photos before they go live.";

export function visionEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export function buildVisionPrompt(input: {
  productName: string;
  categoryName?: string;
  description?: string;
}): string {
  const clean = (s: string, max: number) => s.replace(/["\\]/g, "'").replace(/\s+/g, " ").slice(0, max);
  return `You check marketplace product photos for MandiBazaar, a Pakistani grocery marketplace.
The seller says this photo shows:
Product name: "${clean(input.productName, 120)}"
Category: "${clean(input.categoryName || "unknown", 80)}"
Description: "${clean(input.description || "", 400)}"

Look at the photo and decide what item it actually shows.
- matched = true ONLY if the main item in the photo is this product (loose produce, a pack, bottle or jar of it is fine; brand/packaging may differ).
- matched = false if it shows a different item, even a similar grocery (for example tomatoes for "Oats", rice for "Daal", chillies for "Wheat"), or no product at all (person, screenshot, meme, blank).
- If you cannot tell, set matched = false and confidence = "low".

Reply ONLY with JSON, no other text:
{"seen":"what the photo shows, 2-6 words","matched":true|false,"confidence":"high"|"medium"|"low","reason":"one short sentence in plain English"}`;
}

/**
 * Turn the model's raw reply into a per-photo status.
 * Anything other than a clear JSON answer with boolean `matched` is "unverified".
 * A "match" with low confidence is also "unverified".
 */
export function parseVisionReply(raw: unknown, productName: string): Omit<ImageVerifyResult, "imageUrl" | "provider"> {
  const unverified = (reason: string) => ({
    status: "unverified" as const,
    matched: false,
    confidence: "low" as const,
    reason,
  });
  if (typeof raw !== "string" || !raw.trim()) return unverified(COULD_NOT_VERIFY);

  let text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) text = fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last <= first) return unverified(COULD_NOT_VERIFY);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text.slice(first, last + 1));
  } catch {
    return unverified(COULD_NOT_VERIFY);
  }
  if (!parsed || typeof parsed !== "object") return unverified(COULD_NOT_VERIFY);

  let matched: boolean | null = null;
  if (typeof parsed.matched === "boolean") matched = parsed.matched;
  else if (parsed.matched === "true") matched = true;
  else if (parsed.matched === "false") matched = false;
  if (matched === null) return unverified(COULD_NOT_VERIFY);

  const confidence =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "low";
  const seen = typeof parsed.seen === "string" ? parsed.seen.trim().slice(0, 80) : "";
  const modelReason = typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 200) : "";

  if (!matched) {
    const looksLike = seen ? `This photo looks like ${seen}, not ${productName}.` : `This photo doesn't look like ${productName}.`;
    return {
      status: "mismatch",
      matched: false,
      confidence,
      seen: seen || undefined,
      reason: `${looksLike}${modelReason ? ` ${modelReason}` : ""} Please upload real photos of this product.`,
    };
  }
  if (confidence === "low") {
    return { ...unverified(COULD_NOT_VERIFY), seen: seen || undefined };
  }
  return {
    status: "match",
    matched: true,
    confidence,
    seen: seen || undefined,
    reason: modelReason || "Photo matches this product",
  };
}

/** Combine per-photo results into one verdict + message. */
export function summarizeResults(results: ImageVerifyResult[], enabled: boolean): VerifyImagesResult {
  if (!enabled) {
    return {
      ok: false,
      verdict: "unavailable",
      visionEnabled: false,
      results,
      summary: NO_VISION_SUMMARY,
    };
  }
  if (!results.length) {
    return { ok: false, verdict: "unverified", visionEnabled: true, results, summary: "Add at least one product photo" };
  }
  const mismatches = results
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.status === "mismatch");
  if (mismatches.length) {
    const lines = mismatches.map(({ r, i }) => `Photo ${i + 1}: ${r.reason}`);
    return {
      ok: false,
      verdict: "mismatch",
      visionEnabled: true,
      results,
      summary: lines.join(" "),
    };
  }
  if (results.some((r) => r.status !== "match")) {
    return { ok: false, verdict: "unverified", visionEnabled: true, results, summary: COULD_NOT_VERIFY };
  }
  return {
    ok: true,
    verdict: "verified",
    visionEnabled: true,
    results,
    summary: results.length === 1 ? "The photo matches this product." : `All ${results.length} photos match this product.`,
  };
}

// ---------------------------------------------------------------------------
// Image loading + model call
// ---------------------------------------------------------------------------

/** Only our own uploads or https images are read (no internal-network fetches). */
async function imageToDataUrl(imageUrl: string): Promise<string | null> {
  try {
    if (imageUrl.startsWith("/uploads/")) {
      const root = path.join(process.cwd(), "public", "uploads");
      const filePath = path.normalize(path.join(process.cwd(), "public", imageUrl));
      if (!filePath.startsWith(root + path.sep)) return null;
      const buf = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase().replace(".", "") || "jpeg";
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      return `data:${mime};base64,${buf.toString("base64")}`;
    }
    if (!imageUrl.startsWith("https://")) return null;
    // SSRF guard: reject obviously-internal hosts, and don't follow redirects (a
    // public host could 302 to an internal address).
    try {
      const host = new URL(imageUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
      const isInternal =
        host === "localhost" ||
        host.endsWith(".local") ||
        host === "0.0.0.0" ||
        host === "::1" ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^(fd|fe80)/.test(host);
      if (isInternal) return null;
    } catch {
      return null;
    }
    const res = await fetch(imageUrl, { redirect: "error" });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) return null;
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function openaiVisionCheck(input: {
  productName: string;
  description: string;
  categoryName?: string;
  imageUrl: string;
}): Promise<ImageVerifyResult> {
  const base = { imageUrl: input.imageUrl, provider: "openai" as const };
  const fail = (reason = COULD_NOT_VERIFY): ImageVerifyResult => ({
    ...base,
    status: "unverified",
    matched: false,
    confidence: "low",
    reason,
  });

  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return fail();

  const dataUrl = await imageToDataUrl(input.imageUrl);
  if (!dataUrl) return fail("Couldn't open this photo to check it — an admin will review the photos.");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildVisionPrompt(input) },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[verify-image] OpenAI error", res.status, errText.slice(0, 300));
      return fail();
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    return { ...base, ...parseVisionReply(raw, input.productName) };
  } catch (e) {
    console.error("[verify-image] vision request failed", e);
    return fail();
  }
}

export async function verifyProductImages(input: {
  productName: string;
  description?: string;
  categoryName?: string;
  imageUrls: string[];
}): Promise<VerifyImagesResult> {
  const urls = input.imageUrls.filter(Boolean).slice(0, 5);
  const enabled = visionEnabled();
  if (!enabled) {
    return summarizeResults(
      urls.map((imageUrl) => ({
        imageUrl,
        status: "unverified",
        matched: false,
        confidence: "low",
        reason: NO_VISION_SUMMARY,
        provider: "none",
      })),
      false
    );
  }
  const results: ImageVerifyResult[] = [];
  for (const imageUrl of urls) {
    results.push(
      await openaiVisionCheck({
        productName: input.productName.trim(),
        description: input.description || "",
        categoryName: input.categoryName,
        imageUrl,
      })
    );
  }
  return summarizeResults(results, true);
}
