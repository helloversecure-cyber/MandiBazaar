import { describe, expect, it } from "vitest";
import { isSafeLink, safeLinkOr } from "@/lib/validators/safe-link";

describe("safe banner links (QA S15)", () => {
  it.each(["/products", "/stores/shah-jee?x=1", "https://www.mandibazaar.pk/deals"])(
    "allows %s",
    (v) => expect(isSafeLink(v)).toBe(true)
  );
  it.each([
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,<b>x</b>",
    "//evil.example.com",
    "http://insecure.example.com",
    "not a url",
    "",
  ])("rejects %s", (v) => expect(isSafeLink(v)).toBe(false));
  it("falls back for unsafe stored links", () => {
    expect(safeLinkOr("javascript:alert(1)")).toBe("/products");
  });
});
