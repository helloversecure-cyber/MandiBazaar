import { afterEach, describe, expect, it } from "vitest";
import {
  COULD_NOT_VERIFY,
  buildVisionPrompt,
  parseVisionReply,
  summarizeResults,
  verifyProductImages,
  type ImageVerifyResult,
} from "@/lib/products/verify-image";

const r = (status: ImageVerifyResult["status"], reason = "x"): ImageVerifyResult => ({
  imageUrl: "/uploads/products/a.jpg",
  status,
  matched: status === "match",
  confidence: "high",
  reason,
  provider: "openai",
});

describe("verify-image parsing (N8)", () => {
  it("reports a mismatch with what the photo shows", () => {
    const out = parseVisionReply(
      '{"seen":"red tomatoes","matched":false,"confidence":"high","reason":"Photo shows tomatoes."}',
      "Oats"
    );
    expect(out.status).toBe("mismatch");
    expect(out.reason).toMatch(/tomatoes, not Oats/);
  });

  it("accepts a clear match", () => {
    const out = parseVisionReply('```json\n{"seen":"rolled oats","matched":true,"confidence":"high","reason":"ok"}\n```', "Oats");
    expect(out.status).toBe("match");
  });

  it.each([
    ["", "empty"],
    ["not json at all", "garbage"],
    ['{"matched":"maybe"}', "non-boolean"],
    ['{"confidence":"high"}', "missing matched"],
    ['{"matched":true,"confidence":"low"}', "low-confidence match"],
  ])("never passes by default: %s (%s)", (raw) => {
    const out = parseVisionReply(raw, "Oats");
    expect(out.status).toBe("unverified");
    expect(out.matched).toBe(false);
  });

  it("non-string replies are unverified", () => {
    expect(parseVisionReply(undefined, "Oats").status).toBe("unverified");
    expect(parseVisionReply({ matched: true }, "Oats").status).toBe("unverified");
  });

  it("prompt names the product and asks for a per-photo JSON verdict", () => {
    const p = buildVisionPrompt({ productName: 'Oats "x"', categoryName: "Grains" });
    expect(p).toMatch(/Oats 'x'/);
    expect(p).toMatch(/"matched"/);
  });
});

describe("verify-image summary", () => {
  it("lists each mismatching photo", () => {
    const s = summarizeResults([r("match"), r("mismatch", "This photo looks like tomatoes, not Oats.")], true);
    expect(s.ok).toBe(false);
    expect(s.verdict).toBe("mismatch");
    expect(s.summary).toMatch(/Photo 2: This photo looks like tomatoes/);
  });
  it("unknown result → couldn't verify, not ok", () => {
    const s = summarizeResults([r("match"), r("unverified")], true);
    expect(s).toMatchObject({ ok: false, verdict: "unverified", summary: COULD_NOT_VERIFY });
  });
  it("all match → verified", () => {
    expect(summarizeResults([r("match"), r("match")], true)).toMatchObject({ ok: true, verdict: "verified" });
  });
  it("no vision provider → unavailable, never 'consistent'", () => {
    const s = summarizeResults([r("unverified")], false);
    expect(s.ok).toBe(false);
    expect(s.verdict).toBe("unavailable");
    expect(s.summary).not.toMatch(/consistent/i);
  });
});

describe("verifyProductImages without a key", () => {
  const saved = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved;
  });
  it("does not pass tomato photos for Oats", async () => {
    delete process.env.OPENAI_API_KEY;
    const s = await verifyProductImages({ productName: "Oats", imageUrls: ["/uploads/products/tomato.jpg"] });
    expect(s.ok).toBe(false);
    expect(s.verdict).toBe("unavailable");
    expect(s.visionEnabled).toBe(false);
  });
});
