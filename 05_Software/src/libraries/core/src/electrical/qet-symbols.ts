// Self-authored QElectroTech element definitions for the starter templates (spec REQ-DATA-963cbdf6 "Templates").
// No element of QET's own collection is copied (its elements are CC-BY 3.0 outside a diagram, ELEMENTS.LICENSE).
// Coordinates are QET's: origin at the hotspot, y downwards, terminal orientation n/e/s/w = the conductor's direction.
import { createHash } from "node:crypto";
import { escapeAttribute, escapeText } from "./xml-strict.js";

type Line = [number, number, number, number, ("normal" | "dashed")?];
export interface Symbol {
  file: string;
  name: string;
  linkType: "simple" | "master" | "slave" | "terminal";
  kind?: { type: string; state?: string; number?: string };
  lines: Line[];
  rects?: [number, number, number, number][];
  circles?: [number, number, number][];
  texts?: [number, number, string][];
  terminals: [string, number, number, "n" | "s"][];
  /** Position of the label text relative to the hotspot. */
  label: [number, number];
}

const POLES = [0, 20, 40];
const blade = (x: number): Line[] => [
  [x, -20, x, -8],
  [x, 8, x - 9, -7],
  [x, 8, x, 20],
];
const ncBlade = (x: number): Line[] => [
  [x, -20, x, -8],
  [x, -8, x + 7, -8],
  [x, 8, x + 9, -10],
  [x, 8, x, 20],
];
const poles = (inputs: string[], outputs: string[]): Symbol["terminals"] =>
  POLES.flatMap((x, i) => [
    [inputs[i] as string, x, -20, "n"] as [string, number, number, "n"],
    [outputs[i] as string, x, 20, "s"] as [string, number, number, "s"],
  ]);
const button: Line[] = [
  [-4, 0, -16, 0, "dashed"],
  [-16, -5, -16, 5],
  [-16, -5, -19, -5],
  [-16, 5, -19, 5],
];
const delayMark: Line[] = [
  [-4, 0, -14, 0, "dashed"],
  [-14, -4, -14, 4],
];

export const symbols = {
  supply: {
    file: "supply3.elmt",
    name: "Three-phase supply L1 L2 L3",
    linkType: "simple",
    lines: [...POLES.map((x): Line => [x, 0, x, 10]), [-6, 0, 46, 0]],
    texts: POLES.map((x, i): [number, number, string] => [x - 5, -4, `L${i + 1}`]),
    terminals: POLES.map((x, i): [string, number, number, "s"] => [`L${i + 1}`, x, 10, "s"]),
    label: [52, -6],
  },
  breaker: {
    file: "breaker3.elmt",
    name: "Three-pole motor circuit breaker",
    linkType: "simple",
    lines: [
      ...POLES.flatMap((x): Line[] => [...blade(x), [x - 3, -11, x + 3, -5], [x - 3, -5, x + 3, -11]]),
      [-5, 0, 37, 0, "dashed"],
    ],
    terminals: poles(["1", "3", "5"], ["2", "4", "6"]),
    label: [50, -6],
  },
  contacts: {
    file: "contacts3.elmt",
    name: "Contactor main contacts (3 NO)",
    linkType: "slave",
    kind: { type: "power", state: "NO", number: "3" },
    lines: [...POLES.flatMap((x) => blade(x)), [-5, 0, 37, 0, "dashed"]],
    circles: POLES.map((x): [number, number, number] => [x - 2, -12, 4]),
    terminals: poles(["1", "3", "5"], ["2", "4", "6"]),
    label: [50, -6],
  },
  overload: {
    file: "overload3.elmt",
    name: "Thermal overload relay, power part",
    linkType: "master",
    kind: { type: "protection" },
    lines: POLES.flatMap((x): Line[] => [
      [x, -20, x, -6],
      [x, -6, x + 6, -6],
      [x + 6, -6, x + 6, 6],
      [x + 6, 6, x, 6],
      [x, 6, x, 20],
    ]),
    rects: [[-6, -10, 58, 20]],
    terminals: poles(["1", "3", "5"], ["2", "4", "6"]),
    label: [58, -6],
  },
  motor: {
    file: "motor3.elmt",
    name: "Three-phase motor U1 V1 W1",
    linkType: "simple",
    lines: [
      [0, -20, 0, 0],
      [0, 0, 8, 12],
      [20, -20, 20, 7],
      [40, -20, 40, 0],
      [40, 0, 32, 12],
    ],
    circles: [[2, 7, 36]],
    texts: [
      [15, 27, "M"],
      [13, 38, "3~"],
    ],
    terminals: [
      ["U1", 0, -20, "n"],
      ["V1", 20, -20, "n"],
      ["W1", 40, -20, "n"],
    ],
    label: [44, 10],
  },
  motor6: {
    file: "motor6.elmt",
    name: "Three-phase motor U1 V1 W1 / U2 V2 W2",
    linkType: "simple",
    lines: [
      [0, -20, 0, 0],
      [0, 0, 8, 12],
      [20, -20, 20, 7],
      [40, -20, 40, 0],
      [40, 0, 32, 12],
      [0, 70, 0, 50],
      [0, 50, 8, 38],
      [20, 70, 20, 43],
      [40, 70, 40, 50],
      [40, 50, 32, 38],
    ],
    circles: [[2, 7, 36]],
    texts: [
      [15, 27, "M"],
      [13, 38, "3~"],
    ],
    terminals: [
      ["U1", 0, -20, "n"],
      ["V1", 20, -20, "n"],
      ["W1", 40, -20, "n"],
      ["U2", 0, 70, "s"],
      ["V2", 20, 70, "s"],
      ["W2", 40, 70, "s"],
    ],
    label: [44, 10],
  },
  coil: {
    file: "coil.elmt",
    name: "Contactor coil",
    linkType: "master",
    kind: { type: "coil" },
    lines: [
      [0, -20, 0, -8],
      [0, 8, 0, 20],
    ],
    rects: [[-12, -8, 24, 16]],
    terminals: [
      ["A1", 0, -20, "n"],
      ["A2", 0, 20, "s"],
    ],
    label: [16, -6],
  },
  timer: {
    file: "timer-coil.elmt",
    name: "Timer coil, on-delay",
    linkType: "master",
    kind: { type: "coil" },
    lines: [
      [0, -20, 0, -8],
      [0, 8, 0, 20],
      [-12, -8, -4, 8],
      [-4, -8, -12, 8],
    ],
    rects: [[-12, -8, 24, 16]],
    terminals: [
      ["A1", 0, -20, "n"],
      ["A2", 0, 20, "s"],
    ],
    label: [16, -6],
  },
  no1314: {
    file: "aux-no-13-14.elmt",
    name: "Auxiliary contact NO 13-14",
    linkType: "slave",
    kind: { type: "simple", state: "NO", number: "1" },
    lines: blade(0),
    terminals: [
      ["13", 0, -20, "n"],
      ["14", 0, 20, "s"],
    ],
    label: [8, -6],
  },
  nc2122: {
    file: "aux-nc-21-22.elmt",
    name: "Auxiliary contact NC 21-22",
    linkType: "slave",
    kind: { type: "simple", state: "NC", number: "1" },
    lines: ncBlade(0),
    terminals: [
      ["21", 0, -20, "n"],
      ["22", 0, 20, "s"],
    ],
    label: [12, -6],
  },
  nc9596: {
    file: "overload-nc-95-96.elmt",
    name: "Overload relay contact NC 95-96",
    linkType: "slave",
    kind: { type: "simple", state: "NC", number: "1" },
    lines: [...ncBlade(0), [-4, 0, -14, 0, "dashed"]],
    terminals: [
      ["95", 0, -20, "n"],
      ["96", 0, 20, "s"],
    ],
    label: [12, -6],
  },
  timerNc: {
    file: "timer-nc-55-56.elmt",
    name: "Timer contact NC 55-56, opening on-delay",
    linkType: "slave",
    kind: { type: "delayOn", state: "NC", number: "1" },
    lines: [...ncBlade(0), ...delayMark],
    terminals: [
      ["55", 0, -20, "n"],
      ["56", 0, 20, "s"],
    ],
    label: [12, -6],
  },
  timerNo: {
    file: "timer-no-67-68.elmt",
    name: "Timer contact NO 67-68, closing on-delay",
    linkType: "slave",
    kind: { type: "delayOn", state: "NO", number: "1" },
    lines: [...blade(0), ...delayMark],
    terminals: [
      ["67", 0, -20, "n"],
      ["68", 0, 20, "s"],
    ],
    label: [8, -6],
  },
  start: {
    file: "button-no.elmt",
    name: "Start push button NO",
    linkType: "simple",
    lines: [...blade(0), ...button],
    terminals: [
      ["3", 0, -20, "n"],
      ["4", 0, 20, "s"],
    ],
    label: [8, -6],
  },
  stop: {
    file: "button-nc.elmt",
    name: "Stop push button NC",
    linkType: "simple",
    lines: [...ncBlade(0), ...button],
    terminals: [
      ["1", 0, -20, "n"],
      ["2", 0, 20, "s"],
    ],
    label: [12, -6],
  },
  controlL: {
    file: "control-l.elmt",
    name: "Control supply terminal L",
    linkType: "terminal",
    lines: [[0, 0, 0, 10]],
    circles: [[-3, -6, 6]],
    texts: [[6, 0, "L"]],
    terminals: [["L", 0, 10, "s"]],
    label: [12, -8],
  },
  controlN: {
    file: "control-n.elmt",
    name: "Control supply terminal N",
    linkType: "terminal",
    lines: [[0, -10, 0, 0]],
    circles: [[-3, 0, 6]],
    texts: [[6, 8, "N"]],
    terminals: [["N", 0, -10, "n"]],
    label: [12, 2],
  },
} satisfies Record<string, Symbol>;
export type SymbolId = keyof typeof symbols;
export const symbolPath = (id: SymbolId) => `embed://import/vera/${symbols[id].file}`;

/** A stable UUID derived from the text, so a definition's terminals keep their UUIDs across candidates. */
export function stableUuid(text: string): string {
  const hex = createHash("sha256").update(`vera-qet:${text}`).digest("hex");
  return `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}}`;
}
export const terminalUuid = (id: SymbolId, name: string) => stableUuid(`${symbols[id].file}#${name}`);

const STYLE = {
  normal: "line-style:normal;line-weight:normal;filling:none;color:black",
  dashed: "line-style:dashed;line-weight:thin;filling:none;color:black",
};
const FONT = "Sans Serif,9,-1,5,50,0,0,0,0,0";

/** The `<definition>` of a symbol, indented for the collection. */
export function definitionXml(id: SymbolId, indent: string): string {
  const symbol: Symbol = symbols[id];
  const xs = [0, ...symbol.terminals.map((t) => t[1]), ...symbol.lines.flatMap((l) => [l[0], l[2]])];
  const ys = [0, ...symbol.terminals.map((t) => t[2]), ...symbol.lines.flatMap((l) => [l[1], l[3]])];
  for (const [x, y, w, h] of symbol.rects ?? []) {
    xs.push(x, x + w);
    ys.push(y, y + h);
  }
  for (const [x, y, d] of symbol.circles ?? []) {
    xs.push(x, x + d);
    ys.push(y, y + d);
  }
  const minX = Math.floor((Math.min(...xs) - 5) / 10) * 10;
  const minY = Math.floor((Math.min(...ys) - 5) / 10) * 10;
  const width = Math.ceil((Math.max(...xs) + 5 - minX) / 10) * 10;
  const height = Math.ceil((Math.max(...ys) + 5 - minY) / 10) * 10;
  const i2 = `${indent}    `;
  const i3 = `${i2}    `;
  const lines = [
    `${indent}<definition type="element" link_type="${symbol.linkType}" version="0.90" width="${width}" height="${height}" hotspot_x="${-minX}" hotspot_y="${-minY}">`,
    `${i2}<uuid uuid="${stableUuid(symbol.file)}"/>`,
    `${i2}<names>`,
    `${i3}<name lang="en">${escapeText(symbol.name)}</name>`,
    `${i2}</names>`,
  ];
  if (symbol.kind) {
    lines.push(`${i2}<kindInformations>`);
    for (const [key, value] of Object.entries(symbol.kind))
      lines.push(`${i3}<kindInformation name="${key}" show="1">${escapeText(value)}</kindInformation>`);
    lines.push(`${i2}</kindInformations>`);
  }
  lines.push(
    `${i2}<informations>Author: VERA qelectrotech plugin (self-authored template element)</informations>`,
  );
  lines.push(`${i2}<description>`);
  for (const [x1, y1, x2, y2, style] of symbol.lines)
    lines.push(
      `${i3}<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" end1="none" end2="none" length1="1.5" length2="1.5" antialias="false" style="${STYLE[style ?? "normal"]}"/>`,
    );
  for (const [x, y, w, h] of symbol.rects ?? [])
    lines.push(
      `${i3}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0" ry="0" antialias="false" style="${STYLE.normal}"/>`,
    );
  for (const [x, y, d] of symbol.circles ?? [])
    lines.push(`${i3}<circle x="${x}" y="${y}" diameter="${d}" antialias="true" style="${STYLE.normal}"/>`);
  for (const [x, y, text] of symbol.texts ?? [])
    lines.push(
      `${i3}<text x="${x}" y="${y}" text="${escapeAttribute(text)}" rotation="0" color="#000000" font="${FONT}"/>`,
    );
  for (const [name, x, y, orientation] of symbol.terminals)
    lines.push(
      `${i3}<terminal uuid="${terminalUuid(id, name)}" name="${escapeAttribute(name)}" x="${x}" y="${y}" orientation="${orientation}" type="Generic"/>`,
    );
  lines.push(`${i2}</description>`, `${indent}</definition>`);
  return lines.join("\n");
}
export const symbolFont = FONT;
