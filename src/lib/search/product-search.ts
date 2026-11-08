import type { Prisma } from "@prisma/client";
import { expandToken, flagForToken, normalizeText, tokenizeQuery } from "@/lib/search/synonyms";

/**
 * Prisma filter for a shop search box value (QA R3).
 *
 * Every word must match (AND), in any order. A word matches when ANY of its
 * spelling variants (dal/daal/dhal, دال …) is found in the product name, Urdu name,
 * description, tags, category name or store name. "organic" also matches products
 * flagged organic.
 *
 * Words of 3 letters or fewer only match at the start of a word, so "dal" finds
 * "Moong Dal" but not "Sandal".
 */
export function buildProductSearchWhere(q: string | null | undefined): Prisma.ProductWhereInput | null {
  const tokens = tokenizeQuery(q || "");
  if (!tokens.length) return null;
  return {
    AND: tokens.map((token) => {
      const variants = expandToken(token);
      const or: Prisma.ProductWhereInput[] = [];
      for (const v of variants) or.push(...textConditions(v));
      or.push({ tags: { hasSome: variants } });
      const flag = flagForToken(token);
      if (flag === "isOrganic") or.push({ isOrganic: true });
      if (flag === "isSeasonal") or.push({ isSeasonal: true });
      return { OR: or };
    }),
  };
}

const ci = "insensitive" as const;

function textConditions(v: string): Prisma.ProductWhereInput[] {
  if (v.length <= 3) {
    const ws = ` ${v}`;
    return [
      { name: { startsWith: v, mode: ci } },
      { name: { contains: ws, mode: ci } },
      { urduName: { startsWith: v, mode: ci } },
      { urduName: { contains: ws, mode: ci } },
      { shortDescription: { contains: ws, mode: ci } },
      { description: { contains: ws, mode: ci } },
      { category: { name: { startsWith: v, mode: ci } } },
      { store: { name: { startsWith: v, mode: ci } } },
      { store: { name: { contains: ws, mode: ci } } },
    ];
  }
  return [
    { name: { contains: v, mode: ci } },
    { urduName: { contains: v, mode: ci } },
    { shortDescription: { contains: v, mode: ci } },
    { description: { contains: v, mode: ci } },
    { category: { name: { contains: v, mode: ci } } },
    { store: { name: { contains: v, mode: ci } } },
  ];
}

export type RankableProduct = {
  name: string;
  urduName?: string | null;
  tags?: string[] | null;
  shortDescription?: string | null;
  description?: string | null;
  isOrganic?: boolean;
  isSeasonal?: boolean;
  category?: { name: string } | null;
  store?: { name: string } | null;
};

function words(s: string | null | undefined): string[] {
  return normalizeText(s || "")
    .split(new RegExp("[^\\p{L}\\p{N}]+", "u"))
    .filter(Boolean);
}

/** Higher = better match. Used for the default "Best match" order of search results. */
export function relevanceScore(p: RankableProduct, q: string): number {
  const tokens = tokenizeQuery(q);
  if (!tokens.length) return 0;
  const nameWords = words(p.name);
  const urduWords = words(p.urduName);
  const tagWords = (p.tags || []).map((t) => normalizeText(t));
  const cat = normalizeText(p.category?.name || "");
  const store = normalizeText(p.store?.name || "");
  const desc = normalizeText(`${p.shortDescription || ""} ${p.description || ""}`);

  let score = 0;
  tokens.forEach((token, idx) => {
    let best = 0;
    const flag = flagForToken(token);
    if (flag && p[flag]) best = 6;
    for (const v of expandToken(token)) {
      const exact = v === token;
      let s = 0;
      if (nameWords.includes(v)) s = 10;
      else if (nameWords.some((w) => w.startsWith(v))) s = 8;
      else if (urduWords.includes(v) || urduWords.some((w) => w.startsWith(v))) s = 8;
      else if (nameWords.some((w) => w.includes(v))) s = 6;
      else if (tagWords.includes(v)) s = 5;
      else if (cat.includes(v)) s = 4;
      else if (store.includes(v)) s = 3;
      else if (desc.includes(v)) s = 1;
      if (!exact) s *= 0.9; // a spelling variant is slightly weaker than what was typed
      if (s > best) best = s;
    }
    // Words typed first matter a little more.
    score += best * (1 + (tokens.length - idx) * 0.05);
  });
  // Shorter names that match are usually what the shopper meant ("Daal" over "Daal masala mix").
  return score - nameWords.length * 0.01;
}
