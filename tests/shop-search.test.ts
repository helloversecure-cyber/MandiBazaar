import { describe, expect, it } from "vitest";
import {
  buildVocabulary,
  canonicalSpelling,
  editDistance,
  expandToken,
  flagForToken,
  normalizeText,
  suggestCorrection,
  tokenizeQuery,
  NO_RESULT_SUGGESTIONS,
} from "@/lib/search/synonyms";
import { buildProductSearchWhere, relevanceScore } from "@/lib/search/product-search";

describe("tokenizeQuery", () => {
  it("lower-cases, splits on spaces/punctuation and drops duplicates", () => {
    expect(tokenizeQuery("  Mash   DAAL! daal ")).toEqual(["mash", "daal"]);
    expect(tokenizeQuery("atta,5kg")).toEqual(["atta", "5kg"]);
  });
  it("drops filler words but keeps the query if it is only filler", () => {
    expect(tokenizeQuery("daal for the dinner")).toEqual(["daal", "dinner"]);
    expect(tokenizeQuery("the")).toEqual(["the"]);
  });
  it("keeps Urdu words", () => {
    expect(tokenizeQuery("دال ماش")).toEqual(["دال", "ماش"]);
  });
  it("caps the number of words", () => {
    expect(tokenizeQuery("a1 b2 c3 d4 e5 f6 g7 h8").length).toBe(6);
  });
  it("returns nothing for empty input", () => {
    expect(tokenizeQuery("   ")).toEqual([]);
    expect(tokenizeQuery("!!!")).toEqual([]);
  });
});

describe("normalizeText", () => {
  it("maps Arabic letter forms to Urdu ones", () => {
    expect(normalizeText("ك")).toBe("ک");
    expect(normalizeText("ي")).toBe("ی");
  });
});

describe("expandToken (spelling variants)", () => {
  const has = (t: string, ...expected: string[]) => {
    const v = expandToken(t);
    for (const e of expected) expect(v).toContain(normalizeText(e));
  };
  it("daal family", () => {
    has("dal", "daal", "dhal");
    has("dhal", "dal", "daal");
    has("DAAL", "dal");
  });
  it("chana family", () => has("chanay", "chana", "channa"));
  it("atta family", () => has("aata", "atta", "ata"));
  it("rice / chawal", () => {
    has("chawal", "rice");
    has("rice", "chawal");
  });
  it("other grocery words", () => {
    has("maash", "mash");
    has("mung", "moong");
    has("masur", "masoor");
    has("chini", "cheeni", "sugar");
    has("salt", "namak");
    has("chilli", "mirch");
    has("turmeric", "haldi");
    has("ghi", "ghee");
    has("besan", "besan");
  });
  it("Urdu words map to roman spellings", () => {
    has("دال", "daal", "dal");
    has("چنا", "chana");
    has("آٹا", "atta");
    has("چاول", "rice");
    has("لوبیا", "lobia");
  });
  it("adds a singular for English plurals", () => {
    has("apples", "apple", "seb");
    has("tomatoes", "tomato");
  });
  it("starts with the typed word and has no duplicates", () => {
    const v = expandToken("dal");
    expect(v[0]).toBe("dal");
    expect(new Set(v).size).toBe(v.length);
  });
  it("half-typed words expand to the full word's spellings", () => {
    has("daa", "daal", "dal");
    has("chaw", "chawal", "rice");
  });
  it("unknown words only expand to themselves", () => {
    expect(expandToken("laptop")).toEqual(["laptop"]);
  });
});

describe("flags", () => {
  it("organic / seasonal keywords", () => {
    expect(flagForToken("Organic")).toBe("isOrganic");
    expect(flagForToken("seasonal")).toBe("isSeasonal");
    expect(flagForToken("daal")).toBeNull();
  });
});

describe("buildProductSearchWhere", () => {
  it("returns null for an empty query", () => {
    expect(buildProductSearchWhere("")).toBeNull();
    expect(buildProductSearchWhere("  ")).toBeNull();
  });
  it("ANDs one clause per word, so word order does not matter", () => {
    const a = buildProductSearchWhere("mash daal") as { AND: unknown[] };
    const b = buildProductSearchWhere("daal mash") as { AND: unknown[] };
    expect(a.AND).toHaveLength(2);
    expect(b.AND).toHaveLength(2);
    expect(JSON.stringify([...a.AND].reverse())).toBe(JSON.stringify(b.AND));
  });
  it("searches name, Urdu name, description, tags, category and store", () => {
    const json = JSON.stringify(buildProductSearchWhere("kiryana"));
    for (const field of ["name", "urduName", "description", "shortDescription", "tags", "category", "store"]) {
      expect(json).toContain(`"${field}"`);
    }
  });
  it("includes spelling variants and the organic flag", () => {
    expect(JSON.stringify(buildProductSearchWhere("dal"))).toContain("daal");
    expect(JSON.stringify(buildProductSearchWhere("organic"))).toContain('"isOrganic":true');
    expect(JSON.stringify(buildProductSearchWhere("دال"))).toContain("daal");
  });
  it("short words only match at a word start", () => {
    const json = JSON.stringify(buildProductSearchWhere("dal"));
    expect(json).toContain('"startsWith":"dal"');
    expect(json).toContain('"contains":" dal"');
    expect(json).not.toContain('"contains":"dal"');
  });
});

describe("relevanceScore", () => {
  it("ranks a name match above a description-only match", () => {
    const named = relevanceScore({ name: "Daal mash" }, "daal");
    const described = relevanceScore({ name: "Mixed pack", description: "contains daal" }, "daal");
    expect(named).toBeGreaterThan(described);
  });
  it("matches variants and organic flag", () => {
    expect(relevanceScore({ name: "Moong Dal" }, "daal")).toBeGreaterThan(0);
    expect(relevanceScore({ name: "Carrots", isOrganic: true }, "organic")).toBeGreaterThan(0);
    expect(relevanceScore({ name: "Carrots" }, "organic")).toBe(-0.01);
  });
});

describe("did you mean", () => {
  const vocab = buildVocabulary(["Daal mash", "Daal Channa", "Basmati Rice", "Desi Ghee", "Shah Jee Kiryana Store"]);
  it("edit distance basics", () => {
    expect(editDistance("daal", "daal")).toBe(0);
    expect(editDistance("daaal", "daal")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
  });
  it("suggests the closest grocery word", () => {
    expect(suggestCorrection("daaal", vocab)).toBe("daal");
    expect(suggestCorrection("basmatti", vocab)).toBe("basmati");
    expect(suggestCorrection("kiryanna", vocab)).toBe("kiryana");
  });
  it("prefers the common spelling for synonym words", () => {
    expect(canonicalSpelling("dhal")).toBe("daal");
    expect(canonicalSpelling("چنا")).toBe("چنا");
  });
  it("fixes only the misspelt word of a multi-word query", () => {
    expect(suggestCorrection("desi ghhee", vocab)).toBe("desi ghee");
  });
  it("returns null when the words are fine or nothing is close", () => {
    expect(suggestCorrection("daal", vocab)).toBeNull();
    expect(suggestCorrection("dal", vocab)).toBeNull();
    expect(suggestCorrection("laptop", vocab)).toBeNull();
    expect(suggestCorrection("", vocab)).toBeNull();
  });
  it("vocabulary ignores numbers and tiny words", () => {
    const v = buildVocabulary(["5kg Rice of Pakistan 10"]);
    expect(v).toContain("rice");
    expect(v).not.toContain("10");
    expect(v).not.toContain("of");
  });
  it("no-result suggestions are grocery words", () => {
    expect(NO_RESULT_SUGGESTIONS).toEqual(expect.arrayContaining(["daal", "rice", "atta"]));
    expect(NO_RESULT_SUGGESTIONS).not.toContain("phone");
  });
});
