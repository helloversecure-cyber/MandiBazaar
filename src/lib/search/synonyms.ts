/**
 * Shop search helpers (QA R3 / B1 / B3 / SHOP-03).
 *
 * Pure functions only (no Prisma / no DB) so they can be unit-tested:
 *  - tokenizeQuery("Mash  DAAL!")      → ["mash", "daal"]
 *  - expandToken("dal")                 → ["dal", "daal", "dhal", …]   (spelling variants, English, Urdu)
 *  - suggestCorrection("daaal", vocab)  → "daal"                       ("Did you mean daal?")
 */

/**
 * Words that mean the same thing to a Pakistani grocery shopper.
 * The FIRST entry of each group is the preferred spelling (used for "Did you mean …?").
 * Keep every entry a single word (multi-word queries are split into words first).
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ["daal", "dal", "dhal", "dhaal", "daala", "lentil", "lentils", "دال"],
  ["chana", "channa", "chanay", "chane", "chanaa", "chickpea", "chickpeas", "gram", "چنا", "چنے"],
  ["atta", "aata", "ata", "flour", "آٹا"],
  ["chawal", "chawal", "chaawal", "chawel", "rice", "چاول"],
  ["mash", "maash", "urad", "ماش"],
  ["moong", "mung", "mong", "مونگ"],
  ["masoor", "masur", "mosur", "مسور"],
  ["besan", "baisan", "بیسن"],
  ["ghee", "ghi", "گھی"],
  ["cheeni", "chini", "sugar", "چینی"],
  ["namak", "salt", "نمک"],
  ["mirch", "mirchi", "chilli", "chili", "chilly", "مرچ"],
  ["haldi", "turmeric", "ہلدی"],
  ["lobia", "lobiya", "lobhia", "لوبیا"],
  ["anda", "ande", "egg", "eggs", "انڈا", "انڈے"],
  ["doodh", "dudh", "milk", "دودھ"],
  ["dahi", "dahee", "yogurt", "yoghurt", "دہی"],
  ["makhan", "makkhan", "butter", "مکھن"],
  ["tamatar", "tomato", "tomatoes", "ٹماٹر"],
  ["aloo", "alu", "potato", "potatoes", "آلو"],
  ["piyaz", "pyaz", "onion", "onions", "پیاز"],
  ["tel", "oil", "تیل"],
  ["shahad", "shehad", "honey", "شہد"],
  ["aam", "mango", "mangoes", "آم"],
  ["kela", "banana", "bananas", "کیلا"],
  ["seb", "apple", "apples", "سیب"],
  ["sabzi", "sabzi", "vegetable", "vegetables", "سبزی"],
  ["phal", "fruit", "fruits", "پھل"],
  ["masala", "masalah", "spice", "spices", "مصالحہ", "مسالہ"],
  ["zeera", "jeera", "zira", "cumin", "زیرہ"],
  ["achar", "achaar", "pickle", "pickles", "اچار"],
  ["murgh", "murgi", "chicken", "مرغی"],
  ["pani", "water", "پانی"],
];

/** Query words that switch on a product flag instead of (or as well as) a text match. */
export const FLAG_KEYWORDS: Record<string, "isOrganic" | "isSeasonal"> = {
  organic: "isOrganic",
  "آرگینک": "isOrganic",
  seasonal: "isSeasonal",
};

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "to",
  "ka", "ki", "ke", "aur", "wala", "wali",
]);

/** Longest query we bother with — keeps the generated SQL small. */
export const MAX_TOKENS = 6;

const NON_WORD = new RegExp("[^\\p{L}\\p{N}]+", "gu");
const MARKS = new RegExp("\\p{M}+", "gu");

/** Lower-case, strip accents/harakat, unify Arabic vs Urdu letter forms. */
export function normalizeText(input: string): string {
  return (input || "")
    .normalize("NFKD")
    .replace(MARKS, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ي/g, "ی") // Arabic yeh → Farsi/Urdu yeh
    .replace(/ى/g, "ی") // alef maksura → Urdu yeh
    .replace(/ك/g, "ک") // Arabic kaf → Urdu keheh
    .replace(/ه/g, "ہ"); // Arabic heh → Urdu heh goal
}

/** Split a search box value into distinct words (any order, case-insensitive). */
export function tokenizeQuery(q: string): string[] {
  const words = normalizeText(q)
    .replace(NON_WORD, " ")
    .split(" ")
    .map((w) => w.trim())
    .filter(Boolean);
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  const list = meaningful.length ? meaningful : words;
  const out: string[] = [];
  for (const w of list) {
    if (!out.includes(w)) out.push(w);
    if (out.length >= MAX_TOKENS) break;
  }
  return out;
}

const GROUP_BY_TERM: Map<string, readonly string[]> = (() => {
  const m = new Map<string, readonly string[]>();
  for (const group of SYNONYM_GROUPS) {
    const norm = group.map((g) => normalizeText(g));
    for (const term of norm) {
      const existing = m.get(term);
      // A word in two groups (rare) gets both groups' variants.
      m.set(term, existing ? Array.from(new Set([...existing, ...norm])) : norm);
    }
  }
  return m;
})();

/** Simple English plural → singular ("apples" → "apple", "tomatoes" → "tomato"). */
function singular(token: string): string[] {
  if (!/^[a-z]+$/.test(token) || token.length < 4) return [];
  if (token.endsWith("ss")) return [];
  const out: string[] = [];
  if (token.endsWith("es")) out.push(token.slice(0, -2));
  if (token.endsWith("s")) out.push(token.slice(0, -1));
  return out;
}

/**
 * Every spelling we should look for when the shopper typed `token`.
 * Always starts with the token itself; no duplicates.
 */
export function expandToken(token: string): string[] {
  const t = normalizeText(token).trim();
  if (!t) return [];
  const out: string[] = [t];
  const add = (w: string) => {
    if (w && !out.includes(w)) out.push(w);
  };
  for (const w of GROUP_BY_TERM.get(t) || []) add(w);
  for (const s of singular(t)) {
    add(s);
    for (const w of GROUP_BY_TERM.get(s) || []) add(w);
  }
  // Half-typed words ("daa" → daal / dal / dhal) so suggestions work while typing.
  if (t.length >= 3 && !GROUP_BY_TERM.has(t)) {
    GROUP_BY_TERM.forEach((group, term) => {
      if (term.length > t.length && term.startsWith(t)) for (const w of group) add(w);
    });
  }
  return out;
}

/** Product flag the token stands for, if any ("organic" → isOrganic). */
export function flagForToken(token: string): "isOrganic" | "isSeasonal" | null {
  return FLAG_KEYWORDS[normalizeText(token)] || null;
}

/** Preferred spelling for a word that belongs to a synonym group ("dhal" → "daal"). */
export function canonicalSpelling(word: string): string {
  const w = normalizeText(word);
  for (const group of SYNONYM_GROUPS) {
    if (group.some((g) => normalizeText(g) === w)) {
      // Keep the script the shopper used (Urdu stays Urdu).
      const isLatin = /^[a-z0-9]+$/.test(w);
      if (!isLatin) return w;
      return normalizeText(group[0]);
    }
  }
  return w;
}

/** Levenshtein edit distance (insert / delete / substitute = 1). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[b.length];
}

function maxDistanceFor(word: string): number {
  if (word.length <= 3) return 1;
  if (word.length <= 6) return 2;
  return 3;
}

/** Build the word list used for "Did you mean …?" from product/category/store names. */
export function buildVocabulary(names: string[]): string[] {
  const set = new Set<string>();
  for (const n of names) {
    for (const w of normalizeText(n).replace(NON_WORD, " ").split(" ")) {
      if (w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w)) set.add(w);
    }
  }
  for (const group of SYNONYM_GROUPS) for (const g of group) {
    const w = normalizeText(g);
    if (w.length >= 3) set.add(w);
  }
  return Array.from(set);
}

/**
 * Closest spelling for a query that found nothing, e.g. "daaal" → "daal",
 * "chanaa masoorr" → "chana masoor". Returns null when every word already
 * looks fine or nothing is close enough.
 */
export function suggestCorrection(q: string, vocabulary: string[]): string | null {
  const tokens = tokenizeQuery(q);
  if (!tokens.length) return null;
  const vocab = vocabulary.map((v) => normalizeText(v));
  const vocabSet = new Set(vocab);
  let changed = false;

  const fixed = tokens.map((token) => {
    const variants = expandToken(token);
    // Already a known word (or the start of one) — keep it.
    if (variants.some((v) => vocabSet.has(v))) return token;
    if (token.length >= 3 && vocab.some((v) => v.startsWith(token))) return token;
    if (/^\d+$/.test(token)) return token;

    const limit = maxDistanceFor(token);
    let best: string | null = null;
    let bestScore = Infinity;
    for (const word of vocab) {
      if (Math.abs(word.length - token.length) > limit) continue;
      const d = editDistance(token, word);
      if (d > limit) continue;
      // Prefer smaller distance, then a word that shares the first letter, then shorter.
      const score = d * 10 + (word[0] === token[0] ? 0 : 5) + word.length / 100;
      if (score < bestScore) {
        bestScore = score;
        best = word;
      }
    }
    if (!best) return token;
    changed = true;
    return canonicalSpelling(best);
  });

  if (!changed) return null;
  const suggestion = fixed.join(" ");
  return suggestion === tokens.join(" ") ? null : suggestion;
}

/** Grocery words we suggest when a search finds nothing (QA B2 — never "phone"). */
export const NO_RESULT_SUGGESTIONS = ["daal", "rice", "atta", "ghee", "chana", "masala"];
