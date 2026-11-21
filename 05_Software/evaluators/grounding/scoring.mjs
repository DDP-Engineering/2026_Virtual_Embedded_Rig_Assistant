/**
 * Deterministic checks of a document answer: normalized text, the technical values it states, whether
 * the model saw each value (grounding), abstention, language and citation targets. No model judges.
 */

import { normalize } from "../shared/text.mjs";

export { englishQuery, languageOf, matchesAll, matchesAny, normalize } from "../shared/text.mjs";

const UNIT = {
  mv: "mv",
  v: "v",
  µa: "ua",
  μa: "ua",
  ua: "ua",
  ma: "ma",
  a: "a",
  hz: "hz",
  khz: "khz",
  mhz: "mhz",
  ghz: "ghz",
  ns: "ns",
  µs: "us",
  μs: "us",
  us: "us",
  ms: "ms",
  s: "s",
  pf: "pf",
  nf: "nf",
  µf: "uf",
  μf: "uf",
  uf: "uf",
  kohm: "kohm",
  kω: "kohm",
  ohm: "ohm",
  ω: "ohm",
  "°c": "c",
  baud: "baud",
  bps: "baud",
};
const UNITS = Object.keys(UNIT)
  .sort((a, b) => b.length - a.length)
  .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const VALUE = new RegExp(
  `0x[0-9a-f]+(?![0-9a-z])|(?<![a-z0-9])(?:p[a-k]\\d{1,2}|gpio\\d{1,3})(?![0-9a-z])|(?<![\\w.])\\d+(?:\\.\\d+)?\\s*(?:${UNITS})(?![a-z0-9])`,
  "g",
);

/** Canonical form of one value: hex without leading zeros, pins as is, number + unit. */
function canonical(raw) {
  const value = raw.replace(/\s+/g, "");
  if (value.startsWith("0x")) return `0x${(BigInt(value) || 0n).toString(16)}`;
  const quantity = /^(\d+(?:\.\d+)?)(.+)$/.exec(value);
  return quantity ? `${Number(quantity[1])}${UNIT[quantity[2]] ?? quantity[2]}` : value;
}

/** "0 to 70 °c", "3.15-3.45 v": the unit applies to both ends of a range. */
const RANGE = new RegExp(
  `(?<![\\w.])(\\d+(?:\\.\\d+)?)\\s*(?:to|-|…|\\.\\.|până la|pana la|and|și)\\s*\\+?(\\d+(?:\\.\\d+)?)\\s*(${UNITS})(?![a-z0-9])`,
  "g",
);

/** The technical values a text states (hex, pins, quantities with units), canonical and unique. */
export function extractValues(text) {
  const clean = normalize(text).replace(/\[\[[^\]]*\]\]/g, " ");
  const values = [...clean.matchAll(VALUE)].map((m) => canonical(m[0]));
  for (const [, low, high, unit] of clean.matchAll(RANGE))
    values.push(canonical(`${low}${unit}`), canonical(`${high}${unit}`));
  return [...new Set(values)];
}

/** Values of `answer` that appear in none of the evidence texts the model received. */
export function ungroundedValues(answer, evidence) {
  const known = new Set(evidence.flatMap((text) => extractValues(text)));
  return extractValues(answer).filter((value) => !known.has(value));
}

const ABSTAIN_EN =
  /\b(?:not (?:specified|mentioned|stated|documented|listed|given|provided|defined|found|covered|included|available|described|contain)|(?:does|do|did)(?: not|n't) (?:specify|mention|state|document|list|give|provide|define|include|contain|cover|describe|appear)|no (?:information|mention|data|specification|value|details?|reference)|(?:could|can)(?:not|n't| not) (?:find|locate|confirm)|unable to (?:find|locate|confirm)|there is no|isn't (?:specified|mentioned|documented|listed)|nothing (?:about|on|in the))/;
const ABSTAIN_RO =
  /\bnu (?:este|sunt|apare|apar|con[tț]in|am g[aă]sit|exist[aă]|se (?:specific|men[tț]ion|preciz|indic)|ofer|men[tț]ioneaz|preciz|includ|indic|g[aă]sesc|specific|descri)|nicio informa[tț]ie|niciun[aă]? (?:men[tț]iune|valoare|specifica)|lipse[sș]te|lipsesc/;

/** The answer says the documents do not contain the requested value. */
export const abstains = (answer) => {
  const text = normalize(answer);
  return ABSTAIN_EN.test(text) || ABSTAIN_RO.test(text);
};

/** A citation ref points to a target: same path and, for a page target, a page range that covers it. */
export function onTarget(ref, targets) {
  const [path, anchor = ""] = ref.split("#");
  return targets.some((target) => {
    if (path !== target.path) return false;
    if (target.page === undefined) return true;
    const page = /^p=(\d+)(?:-(\d+))?/.exec(anchor);
    return !!page && Number(page[1]) <= target.page && target.page <= Number(page[2] ?? page[1]);
  });
}
