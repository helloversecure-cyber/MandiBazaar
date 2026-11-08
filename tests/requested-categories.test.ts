import { describe, expect, it } from "vitest";
import { normalizeRequestedCategories } from "@/lib/catalog/requested-categories";

describe("normalizeRequestedCategories", () => {
  it("splits comma strings and dedupes by slug", () => {
    expect(
      normalizeRequestedCategories("Vegetables, Fruits, vegetables, Dairy")
    ).toEqual(["Vegetables", "Fruits", "Dairy"]);
  });

  it("ignores tiny tokens and caps length", () => {
    expect(normalizeRequestedCategories(["A", "Ok", "  Spices  "])).toEqual([
      "Ok",
      "Spices",
    ]);
  });
});
