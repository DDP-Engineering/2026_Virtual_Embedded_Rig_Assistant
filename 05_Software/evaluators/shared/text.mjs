/** Text helpers shared by the agent families: normalization, pattern matching, language. */

/** Lowercase, unified spaces and dashes, decimal commas as points, "degrees C" as °c. */
export function normalize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[    ]/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)\s*(?:°|º)?\s*(?:degrees?|grade)\s*(?:celsius|c)(?![a-z])/g, "$1 °c")
    .replace(/(\d)\s*º\s*c(?![a-z])/g, "$1 °c");
}

/**
 * Every string inside a tool result, so the evidence a model saw reads as text: a JSON result keeps
 * line breaks escaped, which would split "500\nms" into two tokens.
 */
export function resultText(summary) {
  try {
    const strings = [];
    const walk = (value) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(JSON.parse(summary));
    return strings.join("\n");
  } catch {
    return String(summary ?? "");
  }
}

/** Every pattern matches the normalized answer. */
export function matchesAll(answer, patterns) {
  const text = normalize(answer);
  return patterns.every((pattern) => new RegExp(pattern, "i").test(text));
}

export const matchesAny = (answer, patterns) =>
  patterns.some((pattern) => new RegExp(pattern, "i").test(normalize(answer)));

/** Whole words in any script: JavaScript's \b treats letters with diacritics as non-word characters. */
const words = (list) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${list})(?![\\p{L}\\p{N}_])`, "gu");
const RO_WORDS = words(
  "și|si|este|sunt|pentru|care|nu|din|într|această|acest|aceasta|valoarea|adresa|adresă|tensiunea|tensiune|alimentare|conform|documentul|documentele|foaia|pagina|registrul|bitul|biți|pinii|pinul|frecvența|frecventa|frecvență|senzorul|senzor|ceasul|temperatura|temperaturii|intervalul|limita|limită|sursa|sursă|liniile|citire|depanare|magistrala|oscilatorul|oscilator|curent|curentul|la|cu|de|pe|în|al|ale|lui|sau|iar|fost|măsurat|măsurată|trebuie|folosește|utilizează",
);
const EN_WORDS = words(
  "the|is|are|and|for|which|with|this|that|of|to|in|on|at|by|from|uses|use|value|address|voltage|supply|page|datasheet|manual|register|frequency|current|range|should|must|was|were",
);

/** Language of a text by function words and diacritics, ignoring quotes, code and citations. */
export function languageOf(text) {
  const own = normalize(text)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .replace(/\[\[[^\]]*\]\]|`[^`]*`|"[^"]*"|“[^”]*”|„[^”]*”/g, " ");
  const ro = (own.match(RO_WORDS) ?? []).length + 2 * (own.match(/[ăâîșşțţ]/g) ?? []).length;
  const en = (own.match(EN_WORDS) ?? []).length;
  if (!ro && !en) return "unknown";
  return ro > en ? "ro" : "en";
}

/** A search query is English when it has no Romanian word or diacritic. */
export const englishQuery = (query) =>
  !/[ăâîșşțţ]/.test(normalize(query)) && !(normalize(query).match(RO_WORDS) ?? []).length;
