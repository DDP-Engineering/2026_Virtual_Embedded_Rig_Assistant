// The verified DOL, reversing and star-delta templates (spec REQ-DATA-963cbdf6 "Templates and candidates"): renders a
// two-folio QElectroTech project from one motor_drives assembly. The power folio draws the assembly's power
// connections phase by phase; the control folio is the method's fixed circuit with the assembly's tags. The result is
// only text: qet-check.ts reads it back and validates it before anything is written.
import { randomUUID } from "node:crypto";
import type { ElectricalAssembly } from "@vera/shared";
import {
  definitionXml,
  type SymbolId,
  symbolFont,
  symbolPath,
  symbols,
  terminalUuid,
} from "./qet-symbols.js";
import { escapeAttribute, escapeText } from "./xml-strict.js";

export const qetTemplateMethods = ["dol", "reversing", "star-delta"] as const;
export type QetTemplateMethod = (typeof qetTemplateMethods)[number];
const ROLES: Record<QetTemplateMethod, string[]> = {
  dol: ["protection", "line-contactor"],
  reversing: ["protection", "line-contactor", "reverse-contactor"],
  "star-delta": ["protection", "line-contactor", "delta-contactor", "star-contactor", "overload-relay"],
};
/** Template terminals of the power devices: inputs and outputs of phases 1..3. */
export const POLE_IN = ["1", "3", "5"];
export const POLE_OUT = ["2", "4", "6"];
export const SUPPLY_TAG = "X0";
export const CONTROL_TAG = "X1";
/** The star-delta timer whose delayed contacts switch star to delta. */
export const TIMER_TAG = "KT1";

interface Placed {
  uuid: string;
  symbol: SymbolId;
  folio: number;
  x: number;
  y: number;
  label: string;
  info: Record<string, string>;
  links: string[];
}
interface Wire {
  folio: number;
  a: [Placed, string];
  b: [Placed, string];
}
export interface TemplateInput {
  assembly: ElectricalAssembly;
  motorRef: string;
  title: string;
  newUuid?: () => string;
}

/** Splits `motor:U1,V1,W1` or `F1:5,3,1` into the tag and its listed terminals. */
export function connectionTarget(to: string): { tag: string; terminals: string[] | null } {
  const at = to.indexOf(":");
  if (at < 0) return { tag: to, terminals: null };
  const terminals = to.slice(at + 1).split(",");
  return { tag: to.slice(0, at), terminals: terminals.length === 3 ? terminals : null };
}

/** Renders the candidate project XML; throws when the assembly does not fit the template. */
export function renderTemplate(input: TemplateInput): string {
  const { assembly, motorRef } = input;
  const method = assembly.method as QetTemplateMethod;
  if (!(qetTemplateMethods as readonly string[]).includes(method))
    throw Error(
      `No QElectroTech template for the ${assembly.method} method (templates: dol, reversing, star-delta).`,
    );
  const tagOf = new Map(assembly.devices.map((device) => [device.role, device]));
  for (const role of ROLES[method])
    if (!tagOf.has(role))
      throw Error(`The ${method} assembly has no ${role} device, which the template needs.`);
  const newUuid = input.newUuid ?? (() => `{${randomUUID()}}`);
  const placed: Placed[] = [];
  const wires: Wire[] = [];
  const place = (
    symbol: SymbolId,
    folio: number,
    x: number,
    y: number,
    label: string,
    info: Record<string, string> = {},
  ) => {
    const item: Placed = { uuid: newUuid(), symbol, folio, x, y, label, info, links: [] };
    placed.push(item);
    return item;
  };
  const wire = (folio: number, a: Placed, at: string, b: Placed, bt: string) =>
    wires.push({ folio, a: [a, at], b: [b, bt] });
  const link = (master: Placed, slave: Placed) => {
    master.links.push(slave.uuid);
    slave.links.push(master.uuid);
  };
  const tag = (role: string) => tagOf.get(role)?.tag as string;
  const orderInfo = (role: string): Record<string, string> => {
    const code = tagOf.get(role)?.orderCode;
    return code ? { manufacturer_reference: code } : {};
  };

  // ---- folio 1: power circuit ---------------------------------------------------------------------------------------
  const hasRelay = tagOf.has("overload-relay");
  const power = new Map<string, Placed>();
  power.set("supply", place("supply", 0, 120, 70, SUPPLY_TAG));
  power.set(tag("protection"), place("breaker", 0, 120, 170, tag("protection"), orderInfo("protection")));
  const coils = new Map<string, Placed>();
  const contactor = (role: string, x: number, y: number) => {
    const contacts = place("contacts", 0, x, y, tag(role));
    power.set(tag(role), contacts);
    const coil = place("coil", 1, 0, 0, tag(role), orderInfo(role));
    link(coil, contacts);
    coils.set(tag(role), coil);
  };
  contactor("line-contactor", 120, 270);
  if (method === "reversing") contactor("reverse-contactor", 320, 270);
  if (method === "star-delta") {
    contactor("delta-contactor", 320, 370);
    contactor("star-contactor", 520, 370);
  }
  let relayPower: Placed | null = null;
  if (hasRelay) {
    relayPower = place("overload", 0, 120, 370, tag("overload-relay"), orderInfo("overload-relay"));
    power.set(tag("overload-relay"), relayPower);
  }
  power.set("motor", place(method === "star-delta" ? "motor6" : "motor", 0, 120, 480, motorRef));
  for (const connection of assembly.connections) {
    if (connection.kind !== "power") continue;
    const from = power.get(connection.from);
    const target = connectionTarget(connection.to);
    const to = power.get(target.tag);
    if (!from || !to)
      throw Error(`The template does not draw the connection ${connection.from} -> ${connection.to}.`);
    const outputs = from.symbol === "supply" ? ["L1", "L2", "L3"] : POLE_OUT;
    const inputs = target.terminals ?? POLE_IN;
    for (let phase = 0; phase < 3; phase++)
      wire(0, from, outputs[phase] as string, to, inputs[phase] as string);
  }
  if (method === "star-delta") {
    // KM3's outputs go to U2 V2 W2 (assembly), so its inputs form the star point.
    const star = power.get(tag("star-contactor")) as Placed;
    wire(0, star, "1", star, "3");
    wire(0, star, "3", star, "5");
  }

  // ---- folio 2: control circuit -------------------------------------------------------------------------------------
  const lineL = place("controlL", 1, 100, 60, CONTROL_TAG);
  const lineN = place("controlN", 1, 100, 620, CONTROL_TAG);
  let feed: [Placed, string] = [lineL, "L"];
  if (relayPower) {
    const nc = place("nc9596", 1, 100, 130, tag("overload-relay"));
    link(relayPower, nc);
    wire(1, feed[0], feed[1], nc, "95");
    feed = [nc, "96"];
  }
  const stop = place("stop", 1, 100, 210, "S0");
  wire(1, feed[0], feed[1], stop, "1");
  feed = [stop, "2"];
  const aux = (symbol: SymbolId, master: string, x: number, y: number) => {
    const contact = place(symbol, 1, x, y, master);
    link(coils.get(master) as Placed, contact);
    return contact;
  };
  /** A start button with the coil's 13-14 seal-in across it; returns the node after both. */
  const started = (button: string, coilTag: string, x: number): [Placed, string] => {
    const start = place("start", 1, x, 290, button);
    const seal = aux("no1314", coilTag, x + 60, 290);
    wire(1, feed[0], feed[1], start, "3");
    wire(1, feed[0], feed[1], seal, "13");
    wire(1, start, "4", seal, "14");
    return [start, "4"];
  };
  /** Series contacts from a node down to a coil, the coil's A2 to N. */
  const rung = (from: [Placed, string], contacts: Placed[], coilTag: string, x: number) => {
    let at = from;
    for (const contact of contacts) {
      const [first, second] = symbols[contact.symbol].terminals.map((t) => t[0]) as [string, string];
      wire(1, at[0], at[1], contact, first);
      at = [contact, second];
    }
    const coil = coils.get(coilTag) as Placed;
    coil.x = x;
    coil.y = 540;
    wire(1, at[0], at[1], coil, "A1");
    wire(1, coil, "A2", lineN, "N");
  };
  const line = tag("line-contactor");
  if (method === "dol") rung(started("S1", line, 100), [], line, 100);
  else if (method === "reversing") {
    const reverse = tag("reverse-contactor");
    rung(started("S1", line, 100), [aux("nc2122", reverse, 100, 420)], line, 100);
    rung(started("S2", reverse, 300), [aux("nc2122", line, 300, 420)], reverse, 300);
  } else {
    const delta = tag("delta-contactor");
    const star = tag("star-contactor");
    const node = started("S1", line, 100);
    rung(node, [], line, 100);
    const timer = place("timer", 1, 400, 540, TIMER_TAG);
    coils.set(TIMER_TAG, timer);
    wire(1, node[0], node[1], timer, "A1");
    wire(1, timer, "A2", lineN, "N");
    rung(node, [aux("timerNc", TIMER_TAG, 560, 360), aux("nc2122", delta, 560, 450)], star, 560);
    rung(node, [aux("timerNo", TIMER_TAG, 720, 360), aux("nc2122", star, 720, 450)], delta, 720);
  }
  return projectXml(input.title, method, placed, wires);
}

function projectXml(title: string, method: string, placed: Placed[], wires: Wire[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<project title="${escapeAttribute(title)}" version="0.90">`,
    "    <properties>",
    `        <property name="vera-template" show="1">${method} 1</property>`,
    "    </properties>",
  ];
  const folioTitles = ["Power circuit", "Control circuit"];
  let terminalId = 0;
  for (const [folio, folioTitle] of folioTitles.entries()) {
    out.push(
      `    <diagram title="${folioTitle}" order="${folio + 1}" version="0.90" cols="17" rows="8" colsize="60" rowsize="80" height="660" displaycols="true" displayrows="true" folio="%id/%total" author="VERA" date="" filename="" plant="" locmach="" indexrev="" displayAt="bottom" freezeNewConductor="false" freezeNewElement="false">`,
      "        <elements>",
    );
    for (const item of placed.filter((entry) => entry.folio === folio)) {
      const symbol = symbols[item.symbol];
      out.push(
        `            <element uuid="${item.uuid}" type="${symbolPath(item.symbol)}" x="${item.x}" y="${item.y}" z="10" orientation="0" prefix="" freezeLabel="false">`,
        "                <terminals>",
      );
      for (const [, x, y, orientation] of symbol.terminals)
        out.push(
          `                    <terminal id="${terminalId++}" x="${x}" y="${y}" orientation="${orientation === "n" ? 0 : 2}"/>`,
        );
      out.push(
        "                </terminals>",
        "                <inputs/>",
        "                <elementInformations>",
      );
      for (const [name, value] of Object.entries({ label: item.label, ...item.info }))
        out.push(
          `                    <elementInformation name="${name}" show="1">${escapeText(value)}</elementInformation>`,
        );
      out.push("                </elementInformations>");
      if (item.links.length) {
        out.push("                <links_uuids>");
        for (const uuid of item.links) out.push(`                    <link_uuid uuid="${uuid}"/>`);
        out.push("                </links_uuids>");
      }
      out.push(
        "                <dynamic_texts>",
        `                    <dynamic_elmt_text uuid="${terminalUuid(item.symbol, `label@${item.uuid}`)}" text_from="ElementInfo" x="${symbol.label[0]}" y="${symbol.label[1]}" rotation="0" frame="false" text_width="-1" Halignment="AlignLeft" Valignment="AlignTop" keep_visual_rotation="true" font="${symbolFont}">`,
        "                        <text></text>",
        "                        <info_name>label</info_name>",
        "                    </dynamic_elmt_text>",
        "                </dynamic_texts>",
        "                <texts_groups/>",
        "            </element>",
      );
    }
    out.push("        </elements>", "        <conductors>");
    for (const { a, b } of wires.filter((entry) => entry.folio === folio))
      out.push(
        `            <conductor element1="${a[0].uuid}" terminal1="${terminalUuid(a[0].symbol, a[1])}" element2="${b[0].uuid}" terminal2="${terminalUuid(b[0].symbol, b[1])}" num="" type="multi" x="0" y="0" freezeLabel="false" displaytext="1" numsize="7" condsize="1" onetextperfolio="0" horizrotatetext="0" vertirotatetext="270">`,
        "                <sequentialNumbers/>",
        "            </conductor>",
      );
    out.push("        </conductors>", "        <inputs/>", "        <shapes/>", "    </diagram>");
  }
  out.push(
    "    <collection>",
    '        <category name="import">',
    '            <names><name lang="en">Imported elements</name></names>',
    '            <category name="vera">',
    '                <names><name lang="en">VERA templates</name></names>',
  );
  const used = [...new Set(placed.map((item) => item.symbol))].sort();
  for (const id of used)
    out.push(
      `                <element name="${symbols[id].file}">`,
      definitionXml(id, "                    "),
      "                </element>",
    );
  out.push("            </category>", "        </category>", "    </collection>", "</project>", "");
  return out.join("\n");
}
