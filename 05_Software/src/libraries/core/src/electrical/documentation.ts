// The electrical documentation engine (spec REQ-DATA-aa83ed5c): material, connection, cable, terminal, label, I/O and
// contents lists derived only from the model, a stored panel result with its panel file, the named .qet schematics and
// an explicitly named tag file, each row traceable to its source; cross-document checks (numbering, wire ends,
// duplicates, missing references and connections, cable ends, terminal points, the I/O chain, the tag file, the
// revision) and the change report against a previous run. Pure: it reads nothing and changes no source.
import { createHash } from "node:crypto";
import {
  type DocumentationList,
  type DocumentationListName,
  type DocumentationResult,
  documentationColumns,
  documentationLimits,
  type ElectricalModel,
  type ElectricalObject,
  type ElectricalQuantity,
  type ElectricalResult,
  electricalLimits,
  type Panel,
} from "@vera/shared";
import { canonicalJson, modelEntities } from "./model.js";
import { type QetEnd, type QetProject, terminalKey } from "./qet.js";
import { assemblyChecks, projectChecks } from "./qet-check.js";
import { type Freshness, resultFreshness } from "./results.js";
import { attr, childrenNamed } from "./xml-strict.js";

export const documentationEngine = { name: "vera-documentation", version: "1.0.0" } as const;
export const documentationTitles: Readonly<Record<DocumentationListName, string>> = {
  materials: "Material list",
  connections: "Connection list",
  cables: "Cable list",
  terminals: "Terminal list",
  labels: "Label list",
  io: "I/O list",
  contents: "Table of contents",
};
type Verdict = "pass" | "fail" | "unknown" | "not-evaluated";
type Criterion = ElectricalResult["criteria"][number];
type Row = DocumentationList["rows"][number];

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const CONTROL = /\p{Cc}/gu;
const HAS_CONTROL = /\p{Cc}/u;
/** Text from a file as a cell: control characters become spaces, at most 1000 characters; empty is null. */
const cellText = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const clean = value.replace(CONTROL, " ").trim();
  return clean ? clean.slice(0, 1000) : null;
};
const fold = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const list = (items: readonly string[], max = 10) =>
  items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");
const note = (text: string) => text.slice(0, 1000);

// ---- tag file ---------------------------------------------------------------------------------------------------------

export const tagFileLimits = { rows: 5000, bytes: 1024 * 1024 } as const;
const TAG_COLUMNS = ["name", "address", "dataType", "comment"] as const;
export interface TagEntry {
  name: string;
  address: string;
  dataType: string | null;
  comment: string | null;
  line: number;
}
export interface TagFile {
  entries: TagEntry[];
}

/** Splits CSV text into records of fields with the line each record starts on (RFC 4180 quoting, CRLF or LF). */
function csvRecords(text: string, fail: (line: number, reason: string) => never) {
  const records: { line: number; fields: string[] }[] = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const start = line;
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    let closed = false;
    for (;;) {
      const char = text[i];
      if (quoted) {
        if (char === undefined) fail(start, "unterminated quoted field");
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            quoted = false;
            closed = true;
            i += 1;
          }
          continue;
        }
        if (char === "\n") line += 1;
        field += char;
        i += 1;
        continue;
      }
      if (char === undefined || char === "\n" || (char === "\r" && text[i + 1] === "\n")) {
        fields.push(field);
        i += char === undefined ? 0 : char === "\r" ? 2 : 1;
        line += char === undefined ? 0 : 1;
        break;
      }
      if (char === ",") {
        fields.push(field);
        field = "";
        closed = false;
        i += 1;
        continue;
      }
      if (closed) fail(line, "text after a closing quote");
      if (char === '"') {
        if (field !== "") fail(line, "a quote inside an unquoted field");
        quoted = true;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
    }
    records.push({ line: start, fields });
  }
  return records;
}

/** Reads a declared tag file strictly (REQ-DATA-9ca17c7a); throws `Invalid tag file <path>: line <n>: <reason>.`. */
export function parseTagFile(text: string, path: string): TagFile {
  const fail = (line: number, reason: string): never => {
    throw Error(`Invalid tag file ${path}: line ${line}: ${reason}.`);
  };
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records = csvRecords(body, fail).filter(
    (record) => !(record.fields.length === 1 && record.fields[0]?.trim() === ""),
  );
  const header = records[0];
  if (!header) return fail(1, "the header needs name and address");
  const columns = header.fields.map((field) => field.trim());
  const seen = new Set<string>();
  for (const column of columns) {
    if (!(TAG_COLUMNS as readonly string[]).includes(column))
      fail(header.line, `unknown column ${column.slice(0, 40) || "(empty)"}`);
    if (seen.has(column)) fail(header.line, `column ${column} twice`);
    seen.add(column);
  }
  if (!seen.has("name") || !seen.has("address")) fail(header.line, "the header needs name and address");
  if (records.length - 1 > tagFileLimits.rows) fail(header.line, `more than ${tagFileLimits.rows} rows`);
  const entries: TagEntry[] = [];
  for (const record of records.slice(1)) {
    if (record.fields.length !== columns.length)
      fail(record.line, `${record.fields.length} fields, the header has ${columns.length}`);
    const value = (column: string) => {
      const at = columns.indexOf(column);
      return at < 0 ? null : (record.fields[at] ?? "").trim();
    };
    const name = value("name") ?? "";
    const address = value("address") ?? "";
    if (!name) fail(record.line, "empty name");
    if (!address) fail(record.line, "empty address");
    if (name.length > 128) fail(record.line, "name longer than 128 characters");
    if (address.length > 64) fail(record.line, "address longer than 64 characters");
    if (HAS_CONTROL.test(name) || HAS_CONTROL.test(address))
      fail(record.line, "control character in name or address");
    entries.push({
      name,
      address,
      dataType: cellText(value("dataType")),
      comment: cellText(value("comment")),
      line: record.line,
    });
  }
  return { entries };
}
/** An address compared across the model and a tag file: `%` and spaces removed, upper case. */
export const normalizeAddress = (address: string) => address.replace(/[%\s]/g, "").toUpperCase();

// ---- inputs -----------------------------------------------------------------------------------------------------------

export interface DocumentationSchematic {
  path: string;
  sha256: string;
  motor: string | null;
  project: QetProject;
}
export interface DocumentationInput {
  model: ElectricalModel;
  modelPath: string;
  modelSha256: string;
  panel: Panel;
  panelPath: string;
  panelSha256: string;
  panelResult: ElectricalResult;
  motorDrives: ElectricalResult | null;
  schematics: DocumentationSchematic[];
  tags: { path: string; sha256: string; file: TagFile } | null;
  document: string | null;
  previous: ElectricalResult | null;
  /** Stored results that are not current now (listResults), for the change report. */
  notCurrent: { runId: string; plugin: string | null; freshness: "stale" | "invalid" }[];
  /** Current sha256 of each `<path>` the previous run's sources name; null when the file is missing. */
  fileHashes: ReadonlyMap<string, string | null>;
  runId: string;
  now: string;
}

class Context {
  readonly criteria: Criterion[] = [];
  readonly used = new Set<string>();
  readonly objects: Map<string, ElectricalObject>;
  readonly outgoing = new Map<string, ElectricalModel["relations"]>();
  readonly incoming = new Map<string, ElectricalModel["relations"]>();
  readonly strips: Map<string, Panel["strips"][number]>;
  readonly modelSource: string;
  constructor(readonly input: DocumentationInput) {
    this.objects = new Map(input.model.objects.map((object) => [object.id, object]));
    for (const relation of input.model.relations) {
      this.outgoing.set(relation.from, [...(this.outgoing.get(relation.from) ?? []), relation]);
      this.incoming.set(relation.to, [...(this.incoming.get(relation.to) ?? []), relation]);
    }
    this.strips = new Map(input.panel.strips.map((strip) => [fold(strip.tag), strip]));
    this.modelSource = `model:${input.modelPath}@sha256:${input.modelSha256}`;
  }
  add(criterion: Omit<Criterion, "note"> & { note: string }) {
    this.criteria.push({
      ...criterion,
      title: criterion.title.slice(0, 200),
      id: criterion.id.slice(0, 200),
      note: note(criterion.note),
    });
  }
  ref(id: string) {
    return this.objects.get(id)?.ref ?? id;
  }
  /** Relations of a type from or to an object; each relation read is an input of the result. */
  from(id: string, type: string) {
    const relations = (this.outgoing.get(id) ?? []).filter((relation) => relation.type === type);
    for (const relation of relations) this.use(relation.id);
    return relations;
  }
  to(id: string, type: string) {
    const relations = (this.incoming.get(id) ?? []).filter((relation) => relation.type === type);
    for (const relation of relations) this.use(relation.id);
    return relations;
  }
  use(id: string) {
    this.used.add(id);
  }
  object(id: string) {
    const object = this.objects.get(id);
    if (object) this.use(id);
    return object;
  }
  /** The panel equipment that stands for a model object (by `model` ID or tag = ref). */
  equipmentOf(object: ElectricalObject) {
    return this.input.panel.equipment.find(
      (entry) =>
        entry.model === object.id || (object.ref !== undefined && fold(entry.tag) === fold(object.ref)),
    );
  }
}

const quantity = (value: ElectricalQuantity | undefined) =>
  value ? (value.value === null ? `unknown ${value.unit}` : `${value.value} ${value.unit}`) : null;

// ---- schematics --------------------------------------------------------------------------------------------------------

interface Drawn {
  schematic: DocumentationSchematic;
  /** Resolved device name per element UUID. */
  names: Map<string, string>;
  unresolved: string[];
}

/** Resolves each labelled element to its panel tag (by motor and schematic tag, or tag) or model ref. */
function resolveNames(ctx: Context, schematic: DocumentationSchematic): Drawn {
  const { panel } = ctx.input;
  const names = new Map<string, string>();
  const unresolved = new Set<string>();
  const motor = schematic.motor;
  for (const element of schematic.project.elements) {
    if (element.label === null) continue;
    const label = element.label;
    const key = fold(label);
    const scoped =
      motor === null
        ? undefined
        : panel.equipment.find(
            (entry) => entry.motor === motor && fold(entry.schematicTag ?? entry.tag) === key,
          );
    const tagged =
      scoped ??
      panel.equipment.find(
        (entry) => fold(entry.tag) === key && (entry.motor === undefined || entry.motor === motor),
      ) ??
      panel.strips.find(
        (strip) => fold(strip.tag) === key && (strip.motor === undefined || strip.motor === motor),
      );
    if (tagged) {
      names.set(element.uuid, tagged.tag);
      continue;
    }
    const object = ctx.input.model.objects.find(
      (candidate) => candidate.ref !== undefined && fold(candidate.ref) === key,
    );
    if (object) {
      ctx.use(object.id);
      names.set(element.uuid, object.ref as string);
      continue;
    }
    names.set(element.uuid, label);
    unresolved.add(label);
  }
  return { schematic, names, unresolved: [...unresolved].sort() };
}

function endName(drawn: Drawn, end: QetEnd | null): string {
  if (!end) return "?";
  const element = drawn.schematic.project.byUuid.get(end.element);
  const device = drawn.names.get(end.element) ?? element?.position ?? "?";
  const terminal = element?.definition?.terminals[end.terminal]?.name || String(end.terminal);
  return `${device}:${terminal}`;
}

interface Connection {
  wire: string | null;
  from: string;
  to: string;
  path: string;
  row: Row;
  ends: [QetEnd | null, QetEnd | null];
}

function schematicConnections(drawn: Drawn): Connection[] {
  const { schematic } = drawn;
  const seen = new Map<string, number>();
  return schematic.project.conductors.map((conductor) => {
    const from = endName(drawn, conductor.ends[0]);
    const to = endName(drawn, conductor.ends[1]);
    const first = conductor.ends[0] ?? conductor.ends[1];
    const potential = first ? (schematic.project.potentialOf.get(terminalKey(first)) ?? null) : null;
    const base = `${schematic.path}#${[from, to].sort().join("|")}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const wire = cellText(conductor.num);
    return {
      wire,
      from,
      to,
      path: schematic.path,
      ends: conductor.ends,
      row: {
        key: count > 1 ? `${base}#${count}` : base,
        cells: [
          wire,
          from,
          to,
          potential,
          String(conductor.folio + 1),
          cellText(conductor.section),
          cellText(conductor.color),
          cellText(conductor.cable),
          schematic.path,
        ],
        source: `qet:${schematic.path}@sha256:${schematic.sha256}#folio${conductor.folio + 1}/conductor${conductor.index}`,
      },
    };
  });
}

function schematicChecks(ctx: Context, drawn: Drawn, connections: Connection[]) {
  const { schematic } = drawn;
  const { path, project } = schematic;
  const { checks } = projectChecks(project, ctx.input.model, path);
  for (const [id, as] of [
    ["labels", "labels"],
    ["conductor-numbering", "numbering"],
    ["cross-references", "cross-references"],
  ] as const) {
    const found = checks.find((entry) => entry.id === id);
    if (found)
      ctx.add({
        id: `${as}:${path}`,
        title: `${found.title} of ${path}`,
        verdict: found.verdict,
        note: found.note,
      });
  }
  const numbered = connections.some((connection) => connection.wire !== null);
  const open = connections
    .filter((c) => c.ends[0] === null || c.ends[1] === null)
    .map((c) => `${c.from} - ${c.to}`);
  const bare = numbered ? connections.filter((c) => c.wire === null).map((c) => `${c.from} - ${c.to}`) : [];
  ctx.add({
    id: `wire-ends:${path}`,
    title: `Wire ends of ${path}`,
    verdict: open.length || bare.length ? "fail" : numbered ? "pass" : "unknown",
    note:
      open.length || bare.length
        ? `${open.length ? `Unresolved ends: ${list(open)}. ` : ""}${bare.length ? `Conductors without a number: ${list(bare)}.` : ""}`.trim()
        : numbered
          ? `${connections.length} conductors, each with both ends and a number.`
          : "No conductor is numbered: the wire-end labels cannot be derived.",
  });
  const groups = new Map<string, Connection[]>();
  for (const connection of connections) {
    const key = connection.row.key.replace(/#\d+$/, "");
    groups.set(key, [...(groups.get(key) ?? []), connection]);
  }
  const doubled = [...groups.values()].filter((group) => group.length > 1);
  ctx.add({
    id: `duplicates:${path}`,
    title: `Duplicate connections in ${path}`,
    verdict: doubled.length ? "fail" : "pass",
    note: doubled.length
      ? `Drawn more than once: ${list(doubled.map((group) => `${group[0]?.from} - ${group[0]?.to} (${group.length} times)`))}.`
      : "No two conductors join the same two terminals.",
  });
  ctx.add({
    id: `device-refs:${path}`,
    title: `Device references of ${path}`,
    verdict: drawn.unresolved.length ? "fail" : "pass",
    note: drawn.unresolved.length
      ? `Not in the panel or the model: ${list(drawn.unresolved)}.`
      : "Every label is a panel tag or a model reference.",
  });
  const assembly =
    schematic.motor === null
      ? undefined
      : (ctx.input.motorDrives?.assemblies ?? []).find((entry) => entry.motor === schematic.motor);
  if (schematic.motor !== null && assembly) {
    for (const entry of assemblyChecks(project, assembly, ctx.ref(schematic.motor), null))
      if (entry.id === "assembly-devices" || entry.id.startsWith("connection:"))
        ctx.add({
          id: `assembly:${path}:${entry.id}`,
          title: `${entry.title} (${path})`,
          subject: schematic.motor,
          verdict: entry.verdict,
          note: entry.note,
        });
  } else if (schematic.motor !== null)
    ctx.add({
      id: `assembly:${path}`,
      title: `Assembly connections of ${path}`,
      subject: schematic.motor,
      verdict: "unknown",
      note: `The motor_drives result holds no assembly of ${ctx.ref(schematic.motor)}: its connections are not compared.`,
    });
}

/** QET folio revisions (`indexrev`) of a schematic, by folio number. */
function folioRevisions(project: QetProject): { folio: number; revision: string }[] {
  return childrenNamed(project.root, "diagram").flatMap((diagram, i) => {
    const revision = (attr(diagram, "indexrev") ?? "").trim();
    return revision ? [{ folio: i + 1, revision }] : [];
  });
}

// ---- model lists ------------------------------------------------------------------------------------------------------

interface CableInfo {
  ref: string;
  from: string[];
  to: string[];
  row: Row;
}

/** Circuits the panel's board feeds directly or through a busbar it contains. */
function boardCircuits(ctx: Context): Set<string> {
  const board = ctx.input.panel.board;
  const feeders = new Set([board, ...ctx.from(board, "contains").map((relation) => relation.to)]);
  const circuits = new Set<string>();
  for (const feeder of feeders)
    for (const relation of ctx.from(feeder, "feeds"))
      if (ctx.objects.get(relation.to)?.type === "circuit") circuits.add(relation.to);
  return circuits;
}

function cables(ctx: Context): CableInfo[] {
  const circuits = boardCircuits(ctx);
  const excluded = new Map(ctx.input.panel.excluded.map((entry) => [entry.object, entry.reason]));
  const out: CableInfo[] = [];
  const problems: string[] = [];
  for (const cable of ctx.input.model.objects.filter((object) => object.type === "cable")) {
    const circuit = ctx.from(cable.id, "routes")[0]?.to;
    if (circuit === undefined || !circuits.has(circuit)) continue;
    ctx.use(cable.id);
    ctx.use(circuit);
    const fed = ctx.from(circuit, "feeds").map((relation) => relation.to);
    for (const id of fed) ctx.use(id);
    const fedRefs = fed.map((id) => ctx.ref(id));
    const from: string[] = [];
    const to: string[] = [];
    const other: string[] = [];
    const wrongStrip: string[] = [];
    for (const relation of ctx.from(cable.id, "connects")) {
      const end = ctx.object(relation.to);
      if (!end) continue;
      const ref = end.ref ?? end.id;
      const owner = ref.includes(":") ? ref.slice(0, ref.indexOf(":")) : null;
      const strip = owner === null ? undefined : ctx.strips.get(fold(owner));
      if (fed.includes(end.id) || (owner !== null && fedRefs.some((fedRef) => fold(fedRef) === fold(owner))))
        to.push(ref);
      else if (end.type === "terminal" && strip) {
        from.push(ref);
        if (strip.motor !== undefined && !fed.includes(strip.motor))
          wrongStrip.push(`${strip.tag} belongs to ${ctx.ref(strip.motor)}`);
      } else if (ctx.equipmentOf(end)) from.push(ref);
      else other.push(ref);
    }
    const exclusion = fed.map((id) => excluded.get(id)).find((reason) => reason !== undefined);
    const issues: string[] = [];
    if (exclusion === undefined) {
      if (!from.length) issues.push("no panel-side end");
      if (!to.length) issues.push(`no field-side end at ${list(fedRefs) || "a fed motor or load"}`);
      issues.push(...[...new Set(wrongStrip)]);
      if (other.length) issues.push(`ends neither in the panel nor at the load: ${list(other)}`);
    }
    if (issues.length) problems.push(`${cable.ref ?? cable.id}: ${issues.join("; ")}`);
    const state =
      exclusion !== undefined ? `excluded: ${exclusion}` : issues.length ? issues.join("; ") : "ok";
    out.push({
      ref: cable.ref ?? cable.id,
      from,
      to,
      row: {
        key: cable.ref ?? cable.id,
        cells: [
          cable.ref ?? cable.id,
          ctx.ref(circuit),
          from.join(", ") || null,
          to.join(", ") || null,
          quantity(cable.properties?.crossSection),
          quantity(cable.properties?.length),
          cellText(
            typeof cable.attributes?.installationMethod === "string"
              ? cable.attributes.installationMethod
              : null,
          ),
          cellText(state),
        ],
        source: `${ctx.modelSource}#${cable.id}`,
      },
    });
  }
  ctx.add({
    id: "cable-ends",
    title: "Cable ends",
    verdict: !out.length ? "not-evaluated" : problems.length ? "fail" : "pass",
    note: !out.length
      ? `No model cable routes a circuit fed by ${ctx.ref(ctx.input.panel.board)}.`
      : problems.length
        ? list(problems, 8)
        : `${out.length} cables, each with its circuit, a panel-side end and a field-side end.`,
  });
  return out;
}

interface TerminalInfo {
  object: ElectricalObject;
  owner: string;
  point: string;
  strip: Panel["strips"][number] | undefined;
}

/** Model terminals `<owner>:<point>` checked against the panel strips and the I/O modules (terminal-points). */
function terminalPoints(ctx: Context): TerminalInfo[] {
  const out: TerminalInfo[] = [];
  const problems: string[] = [];
  for (const object of ctx.input.model.objects.filter((candidate) => candidate.type === "terminal")) {
    ctx.use(object.id);
    const ref = object.ref ?? object.id;
    const at = ref.indexOf(":");
    if (at <= 0 || at === ref.length - 1) {
      problems.push(`${ref} is not <strip or module>:<point>`);
      continue;
    }
    const owner = ref.slice(0, at);
    const point = ref.slice(at + 1);
    const strip = ctx.strips.get(fold(owner));
    if (strip) {
      if (/^\d+$/.test(point) && (Number(point) < 1 || Number(point) > strip.count))
        problems.push(`${ref} is beyond the ${strip.count} points of ${strip.tag}`);
    } else {
      const container = ctx.to(object.id, "contains")[0]?.from;
      const module = container === undefined ? undefined : ctx.object(container);
      if (!module || fold(module.ref ?? "") !== fold(owner) || !ctx.equipmentOf(module))
        problems.push(`${ref} names no panel strip or panel module containing it`);
    }
    out.push({ object, owner: strip?.tag ?? owner, point, strip });
  }
  ctx.add({
    id: "terminal-points",
    title: "Terminal points",
    verdict: !out.length && !problems.length ? "not-evaluated" : problems.length ? "fail" : "pass",
    note:
      !out.length && !problems.length
        ? "The model has no terminal objects."
        : problems.length
          ? list(problems, 8)
          : `${out.length} terminals, each on a panel strip within its count or on its panel module.`,
  });
  return out;
}

interface IoRow {
  row: Row;
}

function ioList(ctx: Context): IoRow[] {
  const { tags } = ctx.input;
  const byName = new Map<string, TagEntry[]>();
  for (const entry of tags?.file.entries ?? [])
    byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
  const rows: IoRow[] = [];
  const chainProblems: string[] = [];
  const fileProblems: string[] = [];
  const modelTags = new Set<string>();
  const tagSource = tags ? `tags:${tags.path}@sha256:${tags.sha256}` : null;
  for (const io of ctx.input.model.objects.filter((object) => object.type === "io")) {
    ctx.use(io.id);
    const address = io.ref ?? null;
    const signal = typeof io.attributes?.signal === "string" ? io.attributes.signal : null;
    const issues: string[] = [];
    if (address === null) issues.push("no address (ref)");
    const container = ctx.to(io.id, "contains")[0]?.from;
    const module = container === undefined ? undefined : ctx.object(container);
    const equipment = module ? ctx.equipmentOf(module) : undefined;
    if (!module) issues.push("no module contains it");
    else if (!equipment) issues.push(`module ${module.ref ?? module.id} is not in the panel`);
    const input = signal === "DI" || signal === "AI";
    const output = signal === "DO" || signal === "AO";
    const devices = [
      ...(output ? [] : ctx.to(io.id, "signals").map((relation) => relation.from)),
      ...(input ? [] : ctx.from(io.id, "controls").map((relation) => relation.to)),
    ].map((id) => ctx.object(id));
    if (!devices.length)
      issues.push(input ? "no device signals it" : output ? "it controls no device" : "no device");
    const terminals = ctx
      .to(io.id, "connects")
      .map((relation) => ctx.object(relation.from))
      .filter((object): object is ElectricalObject => object?.type === "terminal");
    if (!terminals.length) issues.push("no physical terminal");
    const tagged = ctx
      .to(io.id, "tag-of")
      .map((relation) => ctx.object(relation.from))
      .filter((object): object is ElectricalObject => object !== undefined);
    if (!tagged.length) issues.push("no tag");
    if (tagged.length > 1) issues.push(`${tagged.length} tags`);
    const tag = tagged[0]?.ref ?? tagged[0]?.id ?? null;
    let fileAddress: string | null = null;
    let line: number | null = null;
    if (tag !== null) {
      modelTags.add(tag);
      const found = byName.get(tag);
      if (tags) {
        if (!found?.length) {
          issues.push("not in the tag file");
          fileProblems.push(`${tag} (${address ?? "?"}) is not in the tag file`);
        } else {
          fileAddress = found[0]?.address ?? null;
          line = found[0]?.line ?? null;
          if (
            address !== null &&
            fileAddress !== null &&
            normalizeAddress(fileAddress) !== normalizeAddress(address)
          ) {
            issues.push(`tag file gives ${fileAddress}`);
            fileProblems.push(`${tag}: ${fileAddress} in the tag file, ${address} in the model`);
          }
          if (found.length > 1) fileProblems.push(`${tag} ${found.length} times in the tag file`);
        }
      }
    }
    const chain = issues.filter(
      (issue) => !issue.startsWith("tag file gives") && issue !== "not in the tag file",
    );
    if (chain.length) chainProblems.push(`${address ?? io.id}: ${chain.join(", ")}`);
    rows.push({
      row: {
        key: address ?? io.id,
        cells: [
          address,
          signal,
          equipment?.tag ?? module?.ref ?? null,
          devices.map((device) => device?.ref ?? device?.id ?? "?").join(", ") || null,
          terminals.map((terminal) => terminal.ref ?? terminal.id).join(", ") || null,
          tag,
          fileAddress,
          issues.length ? issues.join("; ") : "ok",
        ],
        source: `${ctx.modelSource}#${io.id}${tagSource && line !== null ? ` + ${tagSource}#line${line}` : ""}`,
      },
    });
  }
  if (tags) {
    const byAddress = new Map<string, string[]>();
    for (const entry of tags.file.entries) {
      const key = normalizeAddress(entry.address);
      byAddress.set(key, [...(byAddress.get(key) ?? []), entry.name]);
      if (modelTags.has(entry.name)) continue;
      fileProblems.push(`${entry.name} (${entry.address}) has no model tag`);
      rows.push({
        row: {
          key: `file:${entry.name}`,
          cells: [entry.address, null, null, null, null, entry.name, entry.address, "only in the tag file"],
          source: `${tagSource}#line${entry.line}`,
        },
      });
    }
    for (const [address, names] of byAddress)
      if (names.length > 1) fileProblems.push(`%${address} twice in the tag file (${list(names)})`);
  }
  const ios = ctx.input.model.objects.filter((object) => object.type === "io").length;
  ctx.add({
    id: "io-chain",
    title: "Device, terminal, I/O address and tag",
    verdict: !ios ? "not-evaluated" : chainProblems.length ? "fail" : "pass",
    note: !ios
      ? "The model has no I/O."
      : chainProblems.length
        ? list(chainProblems, 8)
        : `${ios} I/O, each with its device, terminal, panel module and one tag.`,
  });
  ctx.add({
    id: "tag-file",
    title: "Tags against the tag file",
    verdict: !tags ? "not-evaluated" : fileProblems.length ? "fail" : "pass",
    note: !tags
      ? "No tag file named: the tags come only from the model."
      : fileProblems.length
        ? list(fileProblems, 10)
        : `${tags.file.entries.length} tag file entries match the model's tags and addresses.`,
  });
  return rows;
}

// ---- assembly ---------------------------------------------------------------------------------------------------------

function materials(ctx: Context): Row[] {
  const { panelResult } = ctx.input;
  const groups = new Map<string, { lines: NonNullable<ElectricalResult["panel"]>["bom"] }>();
  for (const line of panelResult.panel?.bom ?? []) {
    const key =
      line.item !== null && line.catalog !== null ? `item:${line.catalog}/${line.item}` : `tag:${line.tag}`;
    const group = groups.get(key) ?? { lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups].map(([key, { lines }]) => {
    const first = lines[0] as (typeof lines)[number];
    return {
      key,
      cells: [
        first.orderCode,
        first.manufacturer,
        first.name,
        String(lines.reduce((sum, line) => sum + line.quantity, 0)),
        lines.map((line) => line.tag).join(", "),
        first.catalog,
        first.item,
      ],
      source: `panel-result:${panelResult.runId}#bom/${lines.map((line) => line.tag).join(",")}`.slice(
        0,
        1000,
      ),
    };
  });
}

function sourceChecks(ctx: Context) {
  const { input } = ctx;
  const panelFresh = resultFreshness(input.panelResult, input.model);
  const stale = (fresh: Freshness) =>
    `stale: changed ${list(fresh.changed.map((id) => ctx.ref(id))) || "none"}; removed ${list(fresh.removed) || "none"}`;
  ctx.add({
    id: "source:panel-result",
    title: "Panel result against the model",
    verdict: panelFresh.freshness === "current" ? "pass" : "fail",
    note:
      panelFresh.freshness === "current"
        ? `${input.panelResult.runId} is current.`
        : `${input.panelResult.runId} is ${stale(panelFresh)}: run panel_engineering_check again.`,
  });
  const named = input.panelResult.sources.find((source) => source.startsWith("motor-drives:"))?.slice(13);
  if (!input.motorDrives)
    ctx.add({
      id: "source:motor-drives",
      title: "motor_drives result of the panel result",
      verdict: "fail",
      note: `The motor_drives result ${named ?? "(none named)"} the panel result names cannot be read.`,
    });
  else {
    const fresh = resultFreshness(input.motorDrives, input.model);
    ctx.add({
      id: "source:motor-drives",
      title: "motor_drives result of the panel result",
      verdict: fresh.freshness === "current" ? "pass" : "fail",
      note:
        fresh.freshness === "current"
          ? `${input.motorDrives.runId} is current.`
          : `${input.motorDrives.runId} is ${stale(fresh)}: run motor_drives again.`,
    });
  }
  const compared = (prefix: string, path: string) =>
    input.panelResult.sources
      .map((source) => new RegExp(`^${prefix}:(.+)@sha256:([0-9a-f]{64})$`).exec(source))
      .find((match) => match?.[1] === path)?.[2];
  const panelSha = compared("panel", input.panelPath);
  ctx.add({
    id: "source:panel-file",
    title: "Panel file as checked",
    verdict: panelSha === input.panelSha256 ? "pass" : "fail",
    note:
      panelSha === input.panelSha256
        ? `${input.panelPath} is the file the panel result checked.`
        : `${input.panelPath} changed since the panel check ${input.panelResult.runId}: run panel_engineering_check again.`,
  });
  for (const schematic of input.schematics) {
    const sha = compared("qet", schematic.path);
    ctx.add({
      id: `source:schematic:${schematic.path}`,
      title: `Schematic ${schematic.path} as checked`,
      verdict: sha === undefined ? "unknown" : sha === schematic.sha256 ? "pass" : "fail",
      note:
        sha === undefined
          ? `The panel result did not compare ${schematic.path} with the panel.`
          : sha === schematic.sha256
            ? `${schematic.path} is the file the panel result compared.`
            : `${schematic.path} changed since the panel check ${input.panelResult.runId}.`,
    });
  }
  ctx.add({
    id: "source:tags",
    title: "Tag file",
    verdict: input.tags ? "pass" : "not-evaluated",
    note: input.tags
      ? `${input.tags.path}: ${input.tags.file.entries.length} entries read.`
      : "No tag file named.",
  });
}

function revision(ctx: Context, lists: DocumentationList[]): DocumentationResult["revision"] {
  const { input } = ctx;
  const document = input.document === null ? undefined : ctx.object(input.document);
  const attribute = (name: string) => {
    const value = document?.attributes?.[name];
    return typeof value === "string" ? value : null;
  };
  const value = attribute("revision");
  const folios = input.schematics.flatMap((schematic) =>
    folioRevisions(schematic.project).map(
      (entry) => `${schematic.path} folio ${entry.folio} states revision ${entry.revision}`,
    ),
  );
  const other = input.schematics.flatMap((schematic) =>
    folioRevisions(schematic.project)
      .filter((entry) => value !== null && entry.revision !== value)
      .map((entry) => `${schematic.path} folio ${entry.folio} states revision ${entry.revision}`),
  );
  const previous = input.previous?.documentation;
  const changed =
    previous && value !== null && previous.revision.value === value
      ? lists
          .filter((entry) => entry.list !== "contents")
          .filter((entry) => previous.lists.find((old) => old.list === entry.list)?.sha256 !== entry.sha256)
          .map((entry) => entry.list)
      : [];
  const problems = [
    ...(other.length ? [`${list(other)}, the model document ${value}`] : []),
    ...(changed.length
      ? [
          `the lists ${list(changed)} changed since ${input.previous?.runId} under the same revision ${value}: raise the revision in the model document`,
        ]
      : []),
  ];
  ctx.add({
    id: "revision",
    title: "Logical revision",
    ...(document ? { subject: document.id } : {}),
    verdict: value === null ? "unknown" : problems.length ? "fail" : "pass",
    note:
      value === null
        ? `The logical revision is not stated${document ? ` (${document.ref ?? document.id} has no revision attribute)` : " (no model document named)"}; VERA does not invent one.${folios.length ? ` ${list(folios)}.` : ""}`
        : problems.length
          ? `${problems.join("; ")}.`
          : `Revision ${value} from ${document?.ref ?? document?.id}${folios.length ? `; ${list(folios)}` : ""}.`,
  });
  return {
    value,
    document: document?.id ?? null,
    date: attribute("date"),
    author: attribute("author"),
  };
}

/**
 * Stores a list within the section's limits: cells cleaned and cut to 1000 characters, sources to 1000, keys to 300 and
 * made unique (`#2`, `#3`...), at most 2000 rows; anything cut is a failed `limits:<list>` criterion.
 */
function finishList(name: DocumentationListName, rows: Row[], ctx: Context): DocumentationList {
  const seen = new Map<string, number>();
  let cut = 0;
  const clean = rows.map((row) => {
    const cells = row.cells.map((cell) => {
      if (cell !== null && cell.length > 1000) cut += 1;
      return cellText(cell);
    });
    let base = row.key.replace(CONTROL, " ");
    if (base.length > 280) {
      cut += 1;
      base = `${base.slice(0, 260)}~${sha256(row.key).slice(0, 12)}`;
    }
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    if (row.source.length > 1000) cut += 1;
    return { key: count > 1 ? `${base}#${count}` : base, cells, source: row.source.slice(0, 1000) };
  });
  const problems = [
    ...(rows.length > documentationLimits.rows
      ? [`${rows.length} rows: only the first ${documentationLimits.rows} are stored`]
      : []),
    ...(cut ? [`${cut} cells, keys or sources were longer than the stored limit and are cut`] : []),
  ];
  if (problems.length)
    ctx.add({
      id: `limits:${name}`,
      title: `Size of the ${documentationTitles[name].toLowerCase()}`,
      verdict: "fail",
      note: `${problems.join("; ")}.`,
    });
  const kept = clean.slice(0, documentationLimits.rows);
  return {
    list: name,
    title: documentationTitles[name],
    columns: [...documentationColumns[name]],
    rows: kept,
    sha256: sha256(canonicalJson(kept)),
  };
}

/** Rows added, removed or changed per list by key, against a previous documentation section. */
function rowChanges(previous: DocumentationResult, lists: DocumentationList[]) {
  const rows: NonNullable<DocumentationResult["changes"]>["rows"] = [];
  for (const entry of lists) {
    if (entry.list === "contents") continue;
    const old = new Map(
      (previous.lists.find((candidate) => candidate.list === entry.list)?.rows ?? []).map((row) => [
        row.key,
        row,
      ]),
    );
    const now = new Map(entry.rows.map((row) => [row.key, row]));
    for (const [key, row] of now) {
      const before = old.get(key);
      if (!before) rows.push({ list: entry.list, key, change: "added" });
      else if (canonicalJson(before.cells) !== canonicalJson(row.cells))
        rows.push({ list: entry.list, key, change: "changed" });
    }
    for (const key of old.keys()) if (!now.has(key)) rows.push({ list: entry.list, key, change: "removed" });
  }
  return rows;
}

const FILE_SOURCE = /^(?:model|panel|qet|tags):(.+)@sha256:([0-9a-f]{64})$/;
/** The `<kind>:<path>@sha256:<hex>` sources of a result whose file is now different or missing. */
export function changedSources(
  result: ElectricalResult,
  fileHashes: ReadonlyMap<string, string | null>,
): { source: string; state: "changed" | "missing" }[] {
  const out: { source: string; state: "changed" | "missing" }[] = [];
  for (const source of result.sources) {
    const match = FILE_SOURCE.exec(source);
    if (!match) continue;
    const now = fileHashes.get(match[1] as string);
    if (now === undefined) continue;
    if (now === null) out.push({ source, state: "missing" });
    else if (now !== match[2]) out.push({ source, state: "changed" });
  }
  return out.slice(0, documentationLimits.sources);
}
/** The workbench paths named by a result's file sources. */
export const sourcePaths = (result: ElectricalResult) =>
  result.sources.flatMap((source) => {
    const match = FILE_SOURCE.exec(source);
    return match ? [match[1] as string] : [];
  });

/** Builds the documentation result; pure. */
export function analyzeDocumentation(input: DocumentationInput): ElectricalResult {
  const ctx = new Context(input);
  const { model, panel, panelResult } = input;
  ctx.use(model.project.id);
  ctx.use(panel.board);
  sourceChecks(ctx);
  // Schematics: connections, terminals drawn, wire-end labels.
  const drawn = input.schematics.map((schematic) => resolveNames(ctx, schematic));
  const connections = drawn.map((entry) => schematicConnections(entry));
  for (const [i, entry] of drawn.entries()) schematicChecks(ctx, entry, connections[i] ?? []);
  const cableInfo = cables(ctx);
  const terminalInfo = terminalPoints(ctx);
  const ioRows = ioList(ctx);

  // Terminals: model terminals and schematic points of elements labelled with a strip tag, merged by key.
  interface Point {
    strip: string;
    point: string;
    wires: Set<string>;
    inside: Set<string>;
    outside: Set<string>;
    cables: Set<string>;
    ios: Set<string>;
    origins: Set<string>;
    sources: Set<string>;
  }
  const points = new Map<string, Point>();
  const point = (strip: string, name: string) => {
    const key = `${strip}:${name}`;
    let entry = points.get(key);
    if (!entry) {
      entry = {
        strip,
        point: name,
        wires: new Set(),
        inside: new Set(),
        outside: new Set(),
        cables: new Set(),
        ios: new Set(),
        origins: new Set(),
        sources: new Set(),
      };
      points.set(key, entry);
    }
    return entry;
  };
  for (const info of terminalInfo) {
    const entry = point(info.owner, info.point);
    entry.origins.add("model");
    entry.sources.add(`${ctx.modelSource}#${info.object.id}`);
    for (const relation of ctx.to(info.object.id, "connects")) {
      const cable = ctx.objects.get(relation.from);
      if (cable?.type !== "cable") continue;
      entry.cables.add(cable.ref ?? cable.id);
      for (const far of cableInfo.find((c) => c.ref === (cable.ref ?? cable.id))?.to ?? [])
        entry.outside.add(far);
    }
    for (const relation of ctx.from(info.object.id, "connects")) {
      const io = ctx.objects.get(relation.to);
      if (io?.type !== "io") continue;
      entry.ios.add(io.ref ?? io.id);
      for (const signal of ctx.to(io.id, "signals")) entry.outside.add(ctx.ref(signal.from));
      for (const control of ctx.from(io.id, "controls")) entry.outside.add(ctx.ref(control.to));
    }
  }
  drawn.forEach((entry, i) => {
    const { project, path, sha256: sha } = entry.schematic;
    for (const element of project.elements) {
      const name = entry.names.get(element.uuid);
      const strip = name === undefined ? undefined : ctx.strips.get(fold(name));
      if (!strip) continue;
      for (const connection of connections[i] ?? [])
        connection.ends.forEach((end, side) => {
          if (end?.element !== element.uuid) return;
          const terminal = element.definition?.terminals[end.terminal]?.name || String(end.terminal);
          const target = point(strip.tag, terminal);
          target.origins.add("schematic");
          if (connection.wire !== null) target.wires.add(connection.wire);
          target.inside.add(side === 0 ? connection.to : connection.from);
          target.sources.add(`qet:${path}@sha256:${sha}#${strip.tag}`);
        });
    }
  });
  const join = (values: Set<string>) => [...values].join(", ") || null;
  const terminalRows: Row[] = [...points.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([key, entry]) => ({
      key,
      cells: [
        entry.strip,
        entry.point,
        join(entry.wires),
        join(entry.inside),
        join(entry.outside),
        join(entry.cables),
        join(entry.ios),
        entry.origins.size > 1 ? "both" : ([...entry.origins][0] ?? null),
      ],
      source: [...entry.sources].join(" + ").slice(0, 1000),
    }));

  // Labels: devices and strips of the BOM, wire ends, cable ends.
  const labelRows: Row[] = [];
  const labelKeys = new Map<string, number>();
  const label = (text: string, kind: string, at: string | null, schematic: string | null, source: string) => {
    const base = `${kind}:${text}@${at ?? ""}${schematic ? `#${schematic}` : ""}`;
    const count = (labelKeys.get(base) ?? 0) + 1;
    labelKeys.set(base, count);
    labelRows.push({
      key: count > 1 ? `${base}#${count}` : base,
      cells: [text, kind, at, schematic],
      source,
    });
  };
  for (const line of panelResult.panel?.bom ?? [])
    label(
      line.tag,
      line.kind === "strip" ? "strip" : "device",
      line.location,
      null,
      `panel-result:${panelResult.runId}#bom/${line.tag}`,
    );
  for (const group of connections)
    for (const connection of group) {
      if (connection.wire === null) continue;
      label(connection.wire, "wire-end", connection.from, connection.path, connection.row.source);
      label(connection.wire, "wire-end", connection.to, connection.path, connection.row.source);
    }
  for (const cable of cableInfo) {
    if (!cable.from.length && !cable.to.length) continue;
    label(cable.ref, "cable", cable.from.join(", ") || null, null, cable.row.source);
    label(cable.ref, "cable", cable.to.join(", ") || null, null, cable.row.source);
  }

  const lists: DocumentationList[] = [
    finishList("materials", materials(ctx), ctx),
    finishList(
      "connections",
      connections.flatMap((group) => group.map((connection) => connection.row)),
      ctx,
    ),
    finishList(
      "cables",
      cableInfo.map((cable) => cable.row),
      ctx,
    ),
    finishList("terminals", terminalRows, ctx),
    finishList("labels", labelRows, ctx),
    finishList(
      "io",
      ioRows.map((entry) => entry.row),
      ctx,
    ),
  ];
  const stated = revision(ctx, lists);
  lists.push(
    finishList(
      "contents",
      lists.map((entry) => ({
        key: entry.list,
        cells: [entry.list, entry.title, String(entry.rows.length), entry.sha256, stated.value],
        source: `result:${input.runId}`,
      })),
      ctx,
    ),
  );

  const previous = input.previous?.documentation;
  let changes: DocumentationResult["changes"];
  if (input.previous && previous) {
    const rows = rowChanges(previous, lists);
    const fresh = resultFreshness(input.previous, model);
    changes = {
      previousRun: input.previous.runId,
      previousRevision: previous.revision.value,
      rows: rows.slice(0, documentationLimits.changes),
      truncated: rows.length > documentationLimits.changes,
      objects: { changed: fresh.changed, removed: fresh.removed },
      sources: changedSources(input.previous, input.fileHashes),
      results: input.notCurrent.slice(0, documentationLimits.results),
    };
  }

  // Inputs: every model entity a list read, with the project.
  const entities = modelEntities(model);
  const read = [...ctx.used].filter((id) => entities.has(id));
  const inputs = read
    .slice(0, electricalLimits.resultInputs)
    .map((id) => ({ id, snapshot: entities.get(id) as ElectricalResult["inputs"][number]["snapshot"] }));
  const failedSource = ctx.criteria.some(
    (entry) => entry.id.startsWith("source:") && entry.verdict === "fail",
  );
  const sources = [
    `model:${input.modelPath}@sha256:${input.modelSha256}`,
    `panel:${input.panelPath}@sha256:${input.panelSha256}`,
    `panel-result:${panelResult.runId}`,
    ...(input.motorDrives ? [`motor-drives:${input.motorDrives.runId}`] : []),
    ...input.schematics.map((schematic) => `qet:${schematic.path}@sha256:${schematic.sha256}`),
    ...(input.tags ? [`tags:${input.tags.path}@sha256:${input.tags.sha256}`] : []),
    ...(stated.document ? [`document:${stated.document}`] : []),
  ].map((source) => source.slice(0, 200));
  const verdicts = ctx.criteria.map((entry) => entry.verdict as Verdict);
  return {
    kind: "vera-electrical-result",
    format: 1,
    runId: input.runId,
    producer: {
      plugin: "electrical-documentation",
      operation: "documentation",
      engine: { ...documentationEngine },
    },
    method: {
      id: "documentation-lists",
      title: "Project documentation lists and cross-document checks",
    },
    status: failedSource ? "incomplete" : "completed",
    preliminary: verdicts.some((verdict) => verdict !== "pass"),
    startedAt: input.now,
    finishedAt: input.now,
    model: { path: input.modelPath, sha256: input.modelSha256 },
    catalog: null,
    inputs: inputs.length ? inputs : [{ id: model.project.id, snapshot: null }],
    assumptions: [
      "A schematic label stands for the panel equipment with the schematic's motor and that schematic tag, else for the panel equipment or strip with that tag, else for the model object with that reference.",
      "A terminal reference <strip>:<point> names a point of that panel strip; <module>:<point> a terminal of the module that contains it.",
    ],
    sources: sources.slice(0, electricalLimits.resultList),
    conditions: {
      panelRun: { text: panelResult.runId },
      ...(input.motorDrives ? { motorDrivesRun: { text: input.motorDrives.runId } } : {}),
      ...(input.previous ? { previousRun: { text: input.previous.runId } } : {}),
    },
    intermediate: lists.map((entry) => ({ name: `rows:${entry.list}`, value: entry.rows.length, unit: "1" })),
    criteria: ctx.criteria.slice(0, electricalLimits.resultList),
    limits: [
      "The lists derive only from the model, the named panel result and panel file, the named QElectroTech schematics and the named tag file; differences are reported, no source is changed.",
      "PLC tags come only from the model and an explicitly named tag file; no PLC project or SDK is read.",
      "Nothing is printed, ordered or sent; exports are separate files written after approval.",
    ],
    messages: [
      ...(ctx.criteria.length > electricalLimits.resultList
        ? [
            `${ctx.criteria.length - electricalLimits.resultList} criteria beyond ${electricalLimits.resultList} are not stored.`,
          ]
        : []),
      ...(read.length > electricalLimits.resultInputs
        ? [
            `${read.length - electricalLimits.resultInputs} model entities read beyond ${electricalLimits.resultInputs} are not stored as inputs: a change to them does not make this result stale.`,
          ]
        : []),
    ],
    documentation: {
      project: { id: model.project.id, name: model.project.name },
      revision: stated,
      panel: { run: panelResult.runId, path: input.panelPath, sha256: input.panelSha256 },
      lists,
      ...(changes ? { changes } : {}),
    },
  };
}
