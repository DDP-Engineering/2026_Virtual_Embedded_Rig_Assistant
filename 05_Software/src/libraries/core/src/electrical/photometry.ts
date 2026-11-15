// Photometry files (spec REQ-DATA-affb2e6b "Photometry"): IES LM-63 (type C, TILT=NONE) and EULUMDAT (symmetry 0, 1,
// 2 or 4) read into one table of absolute candela over C planes and gamma angles, with the luminaire flux integrated
// over the sphere. Anything outside that validated domain is refused with the reason; nothing is guessed.

export type PhotometrySymmetry = "rotational" | "quadrant" | "bilateral" | "full";
export interface Photometry {
  format: "ies" | "ldt";
  /** `LM-63-1986|1991|1995|2002|2019` or `EULUMDAT`. */
  standard: string;
  identity: { manufacturer?: string; name?: string; catalogNumber?: string };
  symmetry: PhotometrySymmetry;
  /** Stored C angles (degrees, ascending; a full distribution ends with 360 = 0). */
  cAngles: number[];
  /** Gamma angles (degrees from nadir, ascending). */
  gammas: number[];
  /** Absolute candela, `candela[c][g]`. */
  candela: number[][];
  /** Absolute photometry: no lamp flux, the candela belong to the luminaire as measured. */
  absolute: boolean;
  lampFlux: number | null;
  /** Integrated over the sphere, lm. */
  luminaireFlux: number;
  /** luminaireFlux / lampFlux for relative photometry. */
  lightOutputRatio: number | null;
  /** EULUMDAT LORL as a share. */
  declaredLightOutputRatio: number | null;
  inputWatts: number | null;
  /** Luminaire (IES: luminous opening) dimensions in metres. */
  dimensions: { length: number; width: number; height: number };
  messages: string[];
}

const FILE_NAME = /\.(ies|ldt)$/i;
const fail = (name: string, reason: string): never => {
  throw Error(`Invalid photometry file ${name}: ${reason}.`);
};
const deg = Math.PI / 180;
/** A UTF-8 byte order mark, decoded or read byte by byte as Latin-1. */
const BYTE_ORDER_MARK = new RegExp(
  `^(?:${String.fromCharCode(0xfeff)}|${String.fromCharCode(0xef, 0xbb, 0xbf)})`,
);

function numbers(name: string, tokens: string[]): number[] {
  return tokens.map((token) => {
    const value = Number(token.replace(",", "."));
    if (!Number.isFinite(value)) fail(name, `${JSON.stringify(token.slice(0, 20))} is not a number`);
    return value;
  });
}
const ascending = (values: number[]) =>
  values.every((value, index) => index === 0 || value > (values[index - 1] ?? 0));

function checkGammas(name: string, gammas: number[]) {
  const first = gammas[0];
  const last = gammas[gammas.length - 1];
  const fits =
    gammas.length >= 2 &&
    ascending(gammas) &&
    ((first === 0 && (last === 90 || last === 180)) || (first === 90 && last === 180));
  if (!fits) fail(name, "the vertical (gamma) angles must ascend from 0 to 90 or 180, or from 90 to 180");
}

function finish(name: string, base: Omit<Photometry, "luminaireFlux" | "lightOutputRatio">): Photometry {
  if (base.candela.some((row) => row.some((value) => value < 0))) fail(name, "an intensity is negative");
  const draft: Photometry = { ...base, luminaireFlux: 0, lightOutputRatio: null };
  const flux = integrateFlux(draft);
  if (!(flux > 0)) fail(name, "the distribution emits no light (every intensity is 0)");
  const largest = Math.max(base.dimensions.length, base.dimensions.width, base.dimensions.height);
  const messages = [...base.messages];
  if (largest > 5)
    messages.push(
      `${name}: a luminaire dimension is ${Number(largest.toFixed(3))} m - check the units (IES units type 1 feet, 2 metres; EULUMDAT mm).`,
    );
  if (base.inputWatts === null) messages.push(`${name}: no input power is given; the efficacy is unknown.`);
  return {
    ...draft,
    luminaireFlux: flux,
    lightOutputRatio: base.lampFlux ? flux / base.lampFlux : null,
    messages,
  };
}

function parseIes(name: string, text: string): Photometry {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? "").trim();
  const year =
    /^IES(?:NA)?:\s*LM-63-(\d{4})/i.exec(header)?.[1] ?? (/^IESNA91/i.test(header) ? "1991" : null);
  const standard = `LM-63-${year ?? "1986"}`;
  const keywords: Record<string, string> = {};
  let tiltAt = -1;
  for (const [index, line] of lines.entries()) {
    const keyword = /^\s*\[([A-Z0-9_]+)\]\s*(.*)$/i.exec(line);
    if (keyword) {
      keywords[(keyword[1] ?? "").toUpperCase()] ??= (keyword[2] ?? "").trim().slice(0, 200);
      continue;
    }
    const tilt = /^\s*TILT\s*=\s*(.*)$/i.exec(line);
    if (tilt) {
      if ((tilt[1] ?? "").trim().toUpperCase() !== "NONE")
        fail(
          name,
          `TILT=${(tilt[1] ?? "").trim().slice(0, 40)} (TILT=INCLUDE or a tilt file) is outside the validated domain (TILT=NONE only)`,
        );
      tiltAt = index;
      break;
    }
  }
  if (tiltAt < 0) fail(name, "no TILT= line");
  const values = numbers(
    name,
    lines
      .slice(tiltAt + 1)
      .join(" ")
      .split(/[\s,]+/)
      .filter(Boolean),
  );
  if (values.length < 13) fail(name, "too few values after TILT=NONE");
  const [lamps, lumens, multiplier, nV, nH, type, units, width, length, height, ballast, factor, watts] =
    values as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
  if (type !== 1)
    fail(
      name,
      `photometric type ${type === 2 ? "B" : type === 3 ? "A" : type} is outside the validated domain (type C only)`,
    );
  if (units !== 1 && units !== 2) fail(name, `units type ${units} is not 1 (feet) or 2 (metres)`);
  if (!Number.isInteger(nV) || !Number.isInteger(nH) || nV < 2 || nH < 1 || nV * nH > 100000)
    fail(name, "the angle counts are not valid");
  const needed = 13 + nV + nH + nV * nH;
  if (values.length < needed) fail(name, `too few values (${values.length} of ${needed})`);
  const gammas = values.slice(13, 13 + nV);
  const horizontal = values.slice(13 + nV, 13 + nV + nH);
  checkGammas(name, gammas);
  const last = horizontal[horizontal.length - 1];
  if (horizontal[0] !== 0 || !ascending(horizontal) || ![0, 90, 180, 360].includes(last ?? -1))
    fail(
      name,
      "the horizontal angles must start at 0 and end at 0, 90, 180 or 360 (other symmetries are outside the validated domain)",
    );
  const symmetry: PhotometrySymmetry =
    last === 0 ? "rotational" : last === 90 ? "quadrant" : last === 180 ? "bilateral" : "full";
  const old = ["LM-63-1986", "LM-63-1991", "LM-63-1995"].includes(standard);
  const scale = multiplier * ballast * (old && factor > 0 ? factor : 1);
  const raw = values.slice(13 + nV + nH, needed);
  const candela = horizontal.map((_, h) => raw.slice(h * nV, (h + 1) * nV).map((value) => value * scale));
  const feet = units === 1 ? 0.3048 : 1;
  const messages: string[] = [];
  if (values.length > needed)
    messages.push(`${name}: ${values.length - needed} values after the candela table are ignored.`);
  const absolute = lumens < 0;
  return finish(name, {
    format: "ies",
    standard,
    identity: {
      ...(keywords.MANUFAC ? { manufacturer: keywords.MANUFAC } : {}),
      ...(keywords.LUMINAIRE ? { name: keywords.LUMINAIRE } : {}),
      ...(keywords.LUMCAT ? { catalogNumber: keywords.LUMCAT } : {}),
    },
    symmetry,
    cAngles: horizontal,
    gammas,
    candela,
    absolute,
    lampFlux: absolute ? null : lamps * lumens,
    declaredLightOutputRatio: null,
    inputWatts: watts > 0 ? watts : null,
    dimensions: {
      width: Math.abs(width) * feet,
      length: Math.abs(length) * feet,
      height: Math.abs(height) * feet,
    },
    messages,
  });
}

function parseLdt(name: string, text: string): Photometry {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (lines.length < 26) fail(name, "too few lines for EULUMDAT");
  const at = (index: number, label: string) => {
    const value = Number((lines[index] ?? "").replace(",", "."));
    if (!Number.isFinite(value) || lines[index] === undefined || lines[index] === "")
      fail(name, `line ${index + 1} (${label}) is not a number`);
    return value;
  };
  const isym = at(2, "symmetry");
  const mc = at(3, "number of C planes");
  const ng = at(5, "number of gamma angles");
  if (isym === 3)
    fail(name, "symmetry 3 (C90-C270 plane) is outside the validated domain (symmetry 0, 1, 2 or 4)");
  if (![0, 1, 2, 4].includes(isym)) fail(name, `symmetry ${isym} is not an EULUMDAT symmetry`);
  if (!Number.isInteger(mc) || !Number.isInteger(ng) || mc < 1 || ng < 2 || mc * ng > 100000)
    fail(name, "the angle counts are not valid");
  if (isym === 2 && mc % 2) fail(name, "symmetry 2 needs an even number of C planes");
  if (isym === 4 && mc % 4) fail(name, "symmetry 4 needs a number of C planes divisible by 4");
  const sets = at(25, "number of lamp sets");
  if (!Number.isInteger(sets) || sets < 1 || sets > 20) fail(name, "the number of lamp sets is not valid");
  const lampCount = at(26, "number of lamps");
  const lampFlux = at(28, "lamp flux");
  const watts = at(31, "wattage");
  const rest = 26 + 6 * sets;
  if (lines.length < rest + 10) fail(name, "too few lines for EULUMDAT");
  const tokens = lines
    .slice(rest + 10)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  const stored = isym === 1 ? 1 : isym === 2 ? mc / 2 + 1 : isym === 4 ? mc / 4 + 1 : mc;
  const needed = mc + ng + stored * ng;
  if (tokens.length < needed) fail(name, `too few values (${tokens.length} of ${needed})`);
  const values = numbers(name, tokens.slice(0, needed));
  const allC = values.slice(0, mc);
  const gammas = values.slice(mc, mc + ng);
  checkGammas(name, gammas);
  const cAngles = isym === 1 ? [0] : allC.slice(0, stored);
  const end = { 0: 360 - 360 / mc, 1: 0, 2: 180, 4: 90 }[isym as 0 | 1 | 2 | 4];
  if (cAngles[0] !== 0 || !ascending(cAngles) || Math.abs((cAngles[cAngles.length - 1] ?? -1) - end) > 1e-6)
    fail(name, `the stored C angles must run from 0 to ${end} for symmetry ${isym}`);
  const conversion = at(23, "conversion factor");
  const absolute = lampCount < 0;
  if (!(lampFlux > 0)) fail(name, "lamp set 1 has no luminous flux");
  const scale = (conversion > 0 ? conversion : 1) * (lampFlux / 1000);
  const raw = values.slice(mc + ng);
  const candela = cAngles.map((_, c) => raw.slice(c * ng, (c + 1) * ng).map((value) => value * scale));
  if (isym === 0) {
    cAngles.push(360);
    candela.push([...(candela[0] ?? [])]);
  }
  const messages: string[] = [];
  if (sets > 1) messages.push(`${name}: ${sets} lamp sets; VERA uses lamp set 1.`);
  const lorl = at(22, "light output ratio");
  const width = at(13, "width");
  const length = at(12, "length");
  return finish(name, {
    format: "ldt",
    standard: "EULUMDAT",
    identity: {
      ...(lines[0] ? { manufacturer: lines[0].slice(0, 200) } : {}),
      ...(lines[8] ? { name: lines[8].slice(0, 200) } : {}),
      ...(lines[9] ? { catalogNumber: lines[9].slice(0, 200) } : {}),
    },
    symmetry: isym === 1 ? "rotational" : isym === 2 ? "bilateral" : isym === 4 ? "quadrant" : "full",
    cAngles,
    gammas,
    candela,
    absolute,
    lampFlux: absolute ? null : lampFlux,
    declaredLightOutputRatio: lorl > 0 ? lorl / 100 : null,
    inputWatts: watts > 0 ? watts : null,
    dimensions: {
      length: length / 1000,
      width: (width > 0 ? width : length) / 1000,
      height: at(14, "height") / 1000,
    },
    messages,
  });
}

/** Reads an `.ies` or `.ldt` file (Latin-1 text); throws `Invalid photometry file <name>: <reason>.` */
export function parsePhotometry(name: string, text: string): Photometry {
  const kind = FILE_NAME.exec(name)?.[1]?.toLowerCase();
  if (!kind) fail(name, "the name must end in .ies or .ldt");
  // A UTF-8 byte order mark (EF BB BF, read as Latin-1) would hide the IES header line.
  const body = text.replace(BYTE_ORDER_MARK, "");
  return kind === "ies" ? parseIes(name, body) : parseLdt(name, body);
}

/** The stored C angle that carries the intensity of direction C (degrees) under the symmetry. */
function storedC(symmetry: PhotometrySymmetry, c: number): number {
  const angle = ((c % 360) + 360) % 360;
  if (symmetry === "rotational") return 0;
  if (symmetry === "bilateral") return angle <= 180 ? angle : 360 - angle;
  if (symmetry === "quadrant")
    return angle <= 90 ? angle : angle <= 180 ? 180 - angle : angle <= 270 ? angle - 180 : 360 - angle;
  return angle;
}
/** Index i with values[i] <= x <= values[i + 1] and the weight of values[i + 1]. */
function bracket(values: readonly number[], x: number): [number, number] {
  if (values.length === 1) return [0, 0];
  let low = 0;
  let high = values.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((values[mid] ?? 0) <= x) low = mid;
    else high = mid;
  }
  const a = values[low] ?? 0;
  const b = values[low + 1] ?? a;
  return [low, b > a ? Math.min(1, Math.max(0, (x - a) / (b - a))) : 0];
}

/** Candela towards C (degrees, counter-clockwise from C0 seen from above) and gamma (degrees from nadir). */
export function intensityAt(photometry: Photometry, c: number, gamma: number): number {
  const { gammas, cAngles, candela } = photometry;
  const first = gammas[0] ?? 0;
  const last = gammas[gammas.length - 1] ?? 0;
  if (gamma < first - 1e-9 || gamma > last + 1e-9) return 0;
  const [g, gw] = bracket(gammas, Math.min(last, Math.max(first, gamma)));
  const along = (row: readonly number[]) => (row[g] ?? 0) * (1 - gw) + (row[g + 1] ?? row[g] ?? 0) * gw;
  const [i, cw] = bracket(cAngles, storedC(photometry.symmetry, c));
  const a = along(candela[i] ?? []);
  return cw === 0 ? a : a * (1 - cw) + along(candela[i + 1] ?? []) * cw;
}

/** The flux in lm: 1-degree C steps and 0.5-degree gamma zones over the interpolated distribution. */
export function integrateFlux(photometry: Photometry): number {
  const zones = 360;
  const zone = 0.5;
  const cSteps = photometry.symmetry === "rotational" ? 1 : 360;
  let flux = 0;
  for (let ci = 0; ci < cSteps; ci += 1) {
    const c = ci + 0.5;
    let plane = 0;
    for (let gi = 0; gi < zones; gi += 1) {
      const low = gi * zone;
      plane +=
        intensityAt(photometry, c, low + zone / 2) * (Math.cos(low * deg) - Math.cos((low + zone) * deg));
    }
    flux += plane * ((2 * Math.PI) / cSteps);
  }
  return flux;
}
