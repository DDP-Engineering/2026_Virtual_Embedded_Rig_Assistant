// The EPLAN exchange engine (spec REQ-DATA-203d52e6), pure: the strict mapping profile, the strict semicolon exchange
// tables (the device list of devicelist /FORMAT:XDLCsvImporterExporter and the terminal and connection tables of the
// user's XMActionDCCommonExport scheme), device tags =plant+location-identifier, the reconcile with a stored
// electrical-documentation run, the device list import candidate, and the check result with the round-trip and
// eplan-tool outcome criteria. Nothing here reads or writes files or starts EPLAN.
import {
  type DocumentationListName,
  type ElectricalModel,
  type ElectricalResult,
  type EplanProfile,
  type EplanTable,
  electricalLimits,
  eplanLimits,
  eplanOutcomeSchema,
  eplanProfileSchema,
} from "@vera/shared";
import { csvRecords } from "./documentation.js";
import type { ElectricalOperation } from "./edit.js";
import { resultFreshness } from "./results.js";

export const eplanEngine = { name: "vera-eplan", version: "1.0.0" } as const;
type Verdict = ElectricalResult["criteria"][number]["verdict"];
type Criterion = ElectricalResult["criteria"][number];
const note = (text: string) => text.slice(0, 1000);
const first = (items: readonly string[], max = 10) =>
  items.length > max ? `${items.slice(0, max).join("; ")}; and ${items.length - max} more` : items.join("; ");
/** Control characters other than CR and LF, which a quoted cell may hold. */
const hasControl = (text: string) => /\p{Cc}/u.test(text.replace(/\r\n|\n/g, ""));
/** The UTF-8 byte order mark a Windows export may start with. */
const BOM = String.fromCharCode(0xfeff);

// ---------------------------------------------------------------------------------------------------------------
// Profile

/** Reads a profile strictly (REQ-DATA-203d52e6); throws `Invalid EPLAN profile <id>: <path>: <message>` lines. */
export function parseEplanProfile(text: string, id: string): EplanProfile {
  const fail = (lines: string[]): never => {
    throw Error(lines.map((line) => `Invalid EPLAN profile ${id}: ${line}`).join("\n"));
  };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return fail([`not valid JSON (${(error as Error).message}).`]);
  }
  const parsed = eplanProfileSchema.safeParse(json);
  if (!parsed.success)
    return fail(
      parsed.error.issues
        .slice(0, 20)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  const profile = parsed.data;
  const problems: string[] = [];
  if (profile.id !== id) problems.push(`id: must equal the file name ${id}`);
  for (const table of ["devices", "terminals", "connections"] as const) {
    const columns = profile.tables[table]?.columns as Record<string, string | undefined> | undefined;
    const seen = new Set<string>();
    for (const header of Object.values(columns ?? {})) {
      if (header === undefined) continue;
      if (seen.has(header)) problems.push(`tables.${table}.columns: the header ${header} is mapped twice`);
      seen.add(header);
    }
  }
  if (problems.length) fail(problems.slice(0, 20));
  return profile;
}

// ---------------------------------------------------------------------------------------------------------------
// Tables

export interface EplanRecord {
  line: number;
  cells: string[];
  /** The record's exact source text, its line ending included. */
  raw: string;
  /** The mapped cells by role (`tag`, `part`, ...); an empty cell is null. */
  values: Record<string, string | null>;
}
export interface EplanTableData {
  table: EplanTable;
  path: string;
  header: string[];
  headerRaw: string;
  bom: boolean;
  /** The header's line ending, used for appended records. */
  eol: "\r\n" | "\n";
  records: EplanRecord[];
  /** Headers the profile does not map, kept as they are. */
  unmapped: string[];
  /** Role -> column index. */
  index: Record<string, number>;
}

/** The role -> header map a profile declares for a table, or null when it declares no such table. */
export function eplanTableColumns(profile: EplanProfile, table: EplanTable): Record<string, string> | null {
  const columns = profile.tables[table]?.columns as Record<string, string | undefined> | undefined;
  if (!columns) return null;
  return Object.fromEntries(
    Object.entries(columns).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** Decodes and reads a table file strictly (REQ-DATA-e601f922). */
export function decodeEplanTable(
  bytes: Uint8Array,
  path: string,
  table: EplanTable,
  profile: EplanProfile,
): EplanTableData {
  if (bytes.length > eplanLimits.tableBytes)
    throw Error(`Invalid EPLAN ${table} table ${path}: line 1: larger than 4 MiB.`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw Error(`Invalid EPLAN ${table} table ${path}: line 1: not UTF-8 text.`);
  }
  return parseEplanTable(text, path, table, profile);
}

/** Reads semicolon-separated table text strictly; throws `Invalid EPLAN <table> table <path>: line <n>: <reason>.` */
export function parseEplanTable(
  text: string,
  path: string,
  table: EplanTable,
  profile: EplanProfile,
): EplanTableData {
  const fail = (line: number, reason: string): never => {
    throw Error(`Invalid EPLAN ${table} table ${path}: line ${line}: ${reason}.`);
  };
  const columns = eplanTableColumns(profile, table);
  if (!columns) throw Error(`The EPLAN profile ${profile.id} declares no ${table} table.`);
  if (text.length > eplanLimits.tableBytes) fail(1, "larger than 4 MiB");
  const bom = text.startsWith(BOM);
  const body = bom ? text.slice(1) : text;
  let records = csvRecords(body, fail, ";");
  const last = records.at(-1);
  if (records.length > 1 && last && last.fields.length === 1 && last.fields[0] === "")
    records = records.slice(0, -1);
  const head = records[0];
  if (!head) return fail(1, "no header");
  if (records.length - 1 > eplanLimits.tableRecords)
    fail(
      (records[eplanLimits.tableRecords + 1] as { line: number }).line,
      `more than ${eplanLimits.tableRecords} records`,
    );
  const header = head.fields;
  const seen = new Set<string>();
  for (const name of header) {
    if (/\p{Cc}/u.test(name)) fail(1, "a control character");
    if (seen.has(name)) fail(1, `the header holds ${name} twice`);
    seen.add(name);
  }
  const index: Record<string, number> = {};
  for (const [role, name] of Object.entries(columns)) {
    const at = header.indexOf(name);
    if (at < 0) fail(1, `the header lacks ${name}`);
    index[role] = at;
  }
  const mapped = new Set(Object.values(columns));
  const out: EplanRecord[] = [];
  for (const record of records.slice(1)) {
    if (record.fields.length !== header.length)
      fail(record.line, `${record.fields.length} fields, the header has ${header.length}`);
    if (record.fields.some(hasControl)) fail(record.line, "a control character");
    out.push({
      line: record.line,
      cells: record.fields,
      raw: body.slice(record.start, record.end),
      values: Object.fromEntries(
        Object.entries(index).map(([role, at]) => [role, (record.fields[at] as string) || null]),
      ),
    });
  }
  const headerRaw = body.slice(head.start, head.end);
  return {
    table,
    path,
    header,
    headerRaw,
    bom,
    eol: headerRaw.endsWith("\r\n") ? "\r\n" : "\n",
    records: out,
    unmapped: header.filter((name) => !mapped.has(name)),
    index,
  };
}

/** One record as table text: cells joined by `;`, quoted where they hold `;`, `"`, CR or LF. */
export function eplanRecordText(cells: readonly string[], eol: string): string {
  return `${cells.map((cell) => (/[;"\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(";")}${eol}`;
}

const TAG = /^((?:=[^=+\-:;\s]+)*(?:\+[^=+\-:;\s]+)*)-([^\s:;]+)$/u;
/** Splits a device tag of the documented form `=AP+PT1-X4` into its structure and identifier, or null. */
export function eplanTag(text: string): { tag: string; structure: string; identifier: string } | null {
  const match = TAG.exec(text);
  return match ? { tag: text, structure: match[1] as string, identifier: match[2] as string } : null;
}
/** Splits a connection end `<device tag>:<pin>` at the last colon, or null. */
export function eplanEnd(text: string): { identifier: string; pin: string; end: string } | null {
  const at = text.lastIndexOf(":");
  if (at <= 0 || at === text.length - 1) return null;
  const tag = eplanTag(text.slice(0, at));
  if (!tag) return null;
  const pin = text.slice(at + 1);
  return { identifier: tag.identifier, pin, end: `${tag.identifier}:${pin}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Reconcile

export interface EplanDeviceMatch {
  tag: string;
  eplan: string;
  line: number;
  by: "vera" | "identifier";
  object: string | null;
  recorded: string | null;
  part: { eplan: string | null; vera: string | null; verdict: "match" | "differs" | "unknown" };
}
export interface EplanReconcile {
  devices: {
    matched: EplanDeviceMatch[];
    differs: { tag: string; eplan: string; field: "part"; eplanValue: string; veraValue: string }[];
    eplanOnly: { tag: string; eplan: string; line: number }[];
    veraOnly: { tag: string; part: string | null; object: string | null }[];
    duplicates: string[];
    problems: string[];
  };
  terminals: { matched: number; eplanOnly: string[]; veraOnly: string[]; problems: string[] } | null;
  connections: {
    matched: number;
    wireDiffers: { ends: string; eplan: string; vera: string }[];
    eplanOnly: string[];
    veraOnly: string[];
    problems: string[];
  } | null;
  operations: ElectricalOperation[];
}

/** The rows of a documentation list as column -> cell records. */
function docRows(result: ElectricalResult, list: DocumentationListName): Record<string, string | null>[] {
  const entry = result.documentation?.lists.find((candidate) => candidate.list === list);
  if (!entry) return [];
  return entry.rows.map((row) =>
    Object.fromEntries(entry.columns.map((column, i) => [column, row.cells[i] ?? null])),
  );
}

/** Matches the EPLAN tables with the documentation lists and the model (REQ-FUNC-f415fdc8); proposes, never applies. */
export function reconcileEplan(input: {
  profile: EplanProfile;
  documentation: ElectricalResult;
  model: ElectricalModel | null;
  devices: EplanTableData;
  terminals?: EplanTableData | null;
  connections?: EplanTableData | null;
}): EplanReconcile {
  const { profile, documentation, model } = input;
  const prefixes = profile.tables.devices.partPrefixes ?? {};
  const labels = docRows(documentation, "labels");
  const deviceTags = [
    ...new Set(labels.filter((row) => row.kind === "device").map((row) => row.text as string)),
  ];
  const deviceSet = new Set(deviceTags);
  const strips = new Set(labels.filter((row) => row.kind === "strip").map((row) => row.text as string));
  const material = new Map<string, { orderCode: string | null; manufacturer: string | null }>();
  for (const row of docRows(documentation, "materials"))
    for (const tag of (row.tags ?? "").split(", "))
      if (tag && !material.has(tag))
        material.set(tag, { orderCode: row.orderCode ?? null, manufacturer: row.manufacturer ?? null });
  const expected = (tag: string): string | null => {
    const entry = material.get(tag);
    if (!entry?.orderCode) return null;
    return `${(entry.manufacturer && prefixes[entry.manufacturer]) || ""}${entry.orderCode}`;
  };
  const objects = model?.objects ?? [];
  const byRef = new Map(
    objects.filter((object) => object.ref).map((object) => [object.ref as string, object]),
  );
  const byId = new Map(objects.map((object) => [object.id, object]));

  const devices: EplanReconcile["devices"] = {
    matched: [],
    differs: [],
    eplanOnly: [],
    veraOnly: [],
    duplicates: [],
    problems: [],
  };
  const claims = new Map<string, { record: EplanRecord; tag: string; by: "vera" | "identifier" }[]>();
  for (const record of input.devices.records) {
    const text = record.values.tag;
    if (!text) {
      devices.problems.push(`line ${record.line}: no device tag`);
      continue;
    }
    const parsed = eplanTag(text);
    if (!parsed) {
      devices.problems.push(`line ${record.line}: ${text} is not a device tag (=plant+location-identifier)`);
      continue;
    }
    let key: string | null = null;
    let by: "vera" | "identifier" = "identifier";
    const vera = record.values.vera ?? null;
    if (vera) {
      const ref = byId.get(vera)?.ref;
      if (ref && deviceSet.has(ref)) {
        key = ref;
        by = "vera";
      } else devices.problems.push(`line ${record.line}: the VERA ID ${vera} names no documented device`);
    }
    if (!key && deviceSet.has(parsed.identifier)) key = parsed.identifier;
    if (!key) {
      devices.eplanOnly.push({ tag: parsed.identifier, eplan: text, line: record.line });
      continue;
    }
    claims.set(key, [...(claims.get(key) ?? []), { record, tag: text, by }]);
  }
  const operations: ElectricalOperation[] = [];
  for (const tag of deviceTags) {
    const found = claims.get(tag) ?? [];
    const object = byRef.get(tag);
    if (found.length === 0) {
      devices.veraOnly.push({ tag, part: expected(tag), object: object?.id ?? null });
      continue;
    }
    if (found.length > 1) {
      devices.duplicates.push(tag);
      continue;
    }
    const { record, tag: full, by } = found[0] as (typeof found)[number];
    const eplanPart = record.values.part ?? null;
    const veraPart = expected(tag);
    const verdict =
      eplanPart === null || veraPart === null ? "unknown" : eplanPart === veraPart ? "match" : "differs";
    devices.matched.push({
      tag,
      eplan: full,
      line: record.line,
      by,
      object: object?.id ?? null,
      recorded: record.values.vera ?? null,
      part: { eplan: eplanPart, vera: veraPart, verdict },
    });
    if (verdict === "differs")
      devices.differs.push({
        tag,
        eplan: full,
        field: "part",
        eplanValue: eplanPart as string,
        veraValue: veraPart as string,
      });
    if (object && object.attributes?.eplanTag !== full)
      operations.push({ op: "update-object", id: object.id, attributes: { eplanTag: full } });
  }
  operations.sort((a, b) => ((a as { id: string }).id < (b as { id: string }).id ? -1 : 1));

  let terminals: EplanReconcile["terminals"] = null;
  if (input.terminals) {
    const vera = new Set(
      docRows(documentation, "terminals")
        .filter((row) => row.strip && strips.has(row.strip))
        .map((row) => `${row.strip}:${row.point}`),
    );
    const eplan = new Set<string>();
    const problems: string[] = [];
    for (const record of input.terminals.records) {
      const strip = eplanTag(record.values.strip ?? "");
      if (!strip || !record.values.point) {
        problems.push(
          `line ${record.line}: ${record.values.strip ?? ""} ${record.values.point ?? ""} is not a terminal`,
        );
        continue;
      }
      const key = `${strip.identifier}:${record.values.point}`;
      if (eplan.has(key)) problems.push(`${key} appears twice`);
      eplan.add(key);
    }
    terminals = {
      matched: [...eplan].filter((key) => vera.has(key)).length,
      eplanOnly: [...eplan].filter((key) => !vera.has(key)),
      veraOnly: [...vera].filter((key) => !eplan.has(key)),
      problems,
    };
  }

  let connections: EplanReconcile["connections"] = null;
  if (input.connections) {
    const vera = new Map<string, string | null>();
    for (const row of docRows(documentation, "connections")) {
      const key = [row.from ?? "", row.to ?? ""].sort().join("|");
      if (!vera.has(key)) vera.set(key, row.wire ?? null);
    }
    const eplan = new Map<string, string | null>();
    const problems: string[] = [];
    for (const record of input.connections.records) {
      const from = eplanEnd(record.values.from ?? "");
      const to = eplanEnd(record.values.to ?? "");
      if (!from || !to) {
        problems.push(
          `line ${record.line}: ${record.values.from ?? ""} - ${record.values.to ?? ""} has no device:pin end`,
        );
        continue;
      }
      const key = [from.end, to.end].sort().join("|");
      if (eplan.has(key)) problems.push(`${key} appears twice`);
      else eplan.set(key, record.values.wire ?? null);
    }
    const wireDiffers: { ends: string; eplan: string; vera: string }[] = [];
    for (const [key, wire] of eplan) {
      const other = vera.get(key);
      if (wire && other && wire !== other) wireDiffers.push({ ends: key, eplan: wire, vera: other });
    }
    connections = {
      matched: [...eplan.keys()].filter((key) => vera.has(key)).length,
      wireDiffers,
      eplanOnly: [...eplan.keys()].filter((key) => !vera.has(key)),
      veraOnly: [...vera.keys()].filter((key) => !eplan.has(key)),
      problems,
    };
  }
  return { devices, terminals, connections, operations };
}

// ---------------------------------------------------------------------------------------------------------------
// Candidate

export interface EplanCandidateReport {
  updated: { tag: string; fields: ("part" | "vera")[] }[];
  added: string[];
  unchanged: number;
  eplanOnly: string[];
  notTransferred: string[];
}

/** The device list import candidate built from the base export (REQ-FUNC-0103d4c6). */
export function eplanCandidate(input: {
  profile: EplanProfile;
  base: EplanTableData;
  reconciled: EplanReconcile;
}): { text: string; report: EplanCandidateReport } {
  const { base, reconciled } = input;
  const partAt = base.index.part;
  const veraAt = base.index.vera;
  const tagAt = base.index.tag as number;
  if (partAt === undefined && veraAt === undefined)
    throw Error(
      `The EPLAN profile ${input.profile.id} maps neither a part nor a VERA ID column: nothing can be imported.`,
    );
  const byLine = new Map(reconciled.devices.matched.map((match) => [match.line, match]));
  const report: EplanCandidateReport = {
    updated: [],
    added: [],
    unchanged: 0,
    eplanOnly: reconciled.devices.eplanOnly.map((entry) => entry.tag),
    notTransferred: [
      "connections: the device list import carries no connections, and the external-editing import needs an .edc data configuration file whose format is not publicly documented (XMActionDCImport).",
      "terminals: the device list import carries no terminal points; terminals stay as they are in EPLAN.",
      "macros: the macro file format is not publicly documented and macro generation needs a macro project (generatemacros); no macro is placed.",
      "function texts, locations and every other VERA field the profile does not map as part or VERA ID are not written.",
    ],
  };
  if (partAt === undefined)
    report.notTransferred.push("part numbers: the profile maps no part number column.");
  if (veraAt === undefined)
    report.notTransferred.push(
      "VERA IDs: the profile maps no VERA ID column; identities rest on the device tag alone.",
    );
  let text = (base.bom ? BOM : "") + base.headerRaw;
  for (const record of base.records) {
    const match = byLine.get(record.line);
    const cells = [...record.cells];
    const fields: ("part" | "vera")[] = [];
    if (match) {
      // An empty EPLAN part is filled; only a check calls it unknown rather than a difference.
      if (partAt !== undefined && match.part.vera && match.part.eplan !== match.part.vera) {
        cells[partAt] = match.part.vera;
        fields.push("part");
      }
      if (veraAt !== undefined && !record.values.vera && match.object) {
        cells[veraAt] = match.object;
        fields.push("vera");
      }
      if (match.part.verdict === "unknown" && match.part.vera === null)
        report.notTransferred.push(
          `${match.tag}: the documentation states no order code; its part number is left as it is.`,
        );
    }
    if (fields.length && match) {
      const eol = record.raw.endsWith("\r\n") ? "\r\n" : record.raw.endsWith("\n") ? "\n" : "";
      text += eplanRecordText(cells, eol);
      report.updated.push({ tag: match.tag, fields });
    } else {
      text += record.raw;
      report.unchanged += 1;
    }
  }
  for (const missing of reconciled.devices.veraOnly) {
    const part = partAt !== undefined ? missing.part : null;
    const vera = veraAt !== undefined ? missing.object : null;
    if (part === null && vera === null) {
      report.notTransferred.push(`${missing.tag}: no order code and no model object; not added.`);
      continue;
    }
    const cells = base.header.map(() => "");
    cells[tagAt] = `-${missing.tag}`;
    if (part !== null) cells[partAt as number] = part;
    if (vera !== null) cells[veraAt as number] = vera;
    if (!text.endsWith("\n")) text += base.eol;
    text += eplanRecordText(cells, base.eol);
    report.added.push(missing.tag);
  }
  return { text, report };
}

// ---------------------------------------------------------------------------------------------------------------
// Round trip and outcome

const byTag = (data: EplanTableData) => {
  const out = new Map<string, EplanRecord[]>();
  for (const record of data.records) {
    const tag = record.values.tag ?? `line ${record.line}`;
    out.set(tag, [...(out.get(tag) ?? []), record]);
  }
  return out;
};
const cellOf = (data: EplanTableData, record: EplanRecord, header: string): string | undefined => {
  const at = data.header.indexOf(header);
  return at < 0 ? undefined : record.cells[at];
};

/** identity, unchanged and applied of a re-export against the base and the candidate (REQ-FUNC-8b2ae38f). */
export function roundTripCriteria(input: {
  base: EplanTableData;
  candidate: EplanTableData;
  reexport: EplanTableData;
}): Criterion[] {
  const { base, candidate, reexport } = input;
  const baseTags = byTag(base);
  const exported = byTag(reexport);
  const candidateTags = byTag(candidate);
  /**
   * The re-exported records of a candidate record: by its device tag, or, for a device the candidate appended as
   * -<tag> (EPLAN may add its structure), by identifier among the re-exported tags the candidate does not hold.
   */
  const found = (record: EplanRecord): EplanRecord[] => {
    const tag = record.values.tag ?? "";
    const exact = exported.get(tag) ?? [];
    if (exact.length || baseTags.has(tag)) return exact;
    const identifier = eplanTag(tag)?.identifier;
    if (!identifier) return [];
    return reexport.records.filter((other) => {
      const otherTag = other.values.tag ?? "";
      return !candidateTags.has(otherTag) && eplanTag(otherTag)?.identifier === identifier;
    });
  };
  const missing: string[] = [];
  const repeated: string[] = [];
  for (const record of candidate.records) {
    const count = found(record).length;
    if (count === 0) missing.push(record.values.tag ?? `line ${record.line}`);
    if (count > 1) repeated.push(record.values.tag ?? `line ${record.line}`);
  }
  const identity: Criterion = {
    id: "identity",
    title: "Every device of the candidate is in the re-export once, with its device tag",
    verdict: missing.length || repeated.length ? "fail" : "pass",
    ...(missing.length || repeated.length
      ? {
          note: note(
            [
              missing.length ? `missing in the re-export: ${first(missing)}` : "",
              repeated.length ? `more than once: ${first(repeated)}` : "",
            ]
              .filter(Boolean)
              .join("; "),
          ),
        }
      : {}),
  };
  const roles = Object.entries(candidate.index).filter(([role]) => role === "part" || role === "vera");
  const changedHeaders = (record: EplanRecord, before: EplanRecord | undefined): string[] =>
    roles
      .filter(([, at]) => (before ? before.cells[at] !== record.cells[at] : true))
      .map(([, at]) => candidate.header[at] as string);
  const unchanged: string[] = [];
  const notApplied: string[] = [];
  for (const record of candidate.records) {
    const tag = record.values.tag ?? "";
    const before = baseTags.get(tag)?.[0];
    const after = found(record);
    if (after.length !== 1) continue;
    const changed = changedHeaders(record, before);
    if (before)
      for (const header of base.header) {
        if (changed.includes(header)) continue;
        const now = cellOf(reexport, after[0] as EplanRecord, header);
        if (now !== cellOf(base, before, header))
          unchanged.push(`${tag}: ${header}${now === undefined ? " (column missing)" : ""}`);
      }
    for (const header of changed) {
      const want = cellOf(candidate, record, header) ?? "";
      const now = cellOf(reexport, after[0] as EplanRecord, header);
      if (now !== want)
        notApplied.push(`${tag}: ${header} is ${now ?? "(column missing)"}, the candidate has ${want}`);
    }
  }
  return [
    identity,
    {
      id: "unchanged",
      title: "Records and cells the candidate did not change are unchanged in the re-export",
      verdict: unchanged.length ? "fail" : "pass",
      ...(unchanged.length ? { note: note(`changed: ${first(unchanged)}`) } : {}),
    },
    {
      id: "applied",
      title: "Every value the candidate changed or added is in the re-export",
      verdict: notApplied.length ? "fail" : "pass",
      ...(notApplied.length ? { note: note(`not applied: ${first(notApplied)}`) } : {}),
    },
  ];
}

/** The outcome criterion: only a completed import of this candidate into the profile's project counts (REQ-REL-803299e7). */
export function outcomeCriterion(input: {
  profile: EplanProfile;
  profileSha256: string;
  outcome: { path: string; text: string } | null;
  candidateSha256: string;
  exports: { table: EplanTable; path: string; sha256: string }[];
}): Criterion {
  const title =
    "The eplan-tool import completed on the profile's project with this candidate and these re-exports";
  const failed = (reason: string): Criterion => ({
    id: "outcome",
    title,
    verdict: "fail",
    note: note(reason),
  });
  if (!input.outcome) return failed("no eplan-tool outcome: the import is not shown to have run.");
  let json: unknown;
  try {
    json = JSON.parse(input.outcome.text);
  } catch {
    return failed(`${input.outcome.path} is not a valid eplan-tool outcome (not JSON).`);
  }
  const parsed = eplanOutcomeSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failed(
      `${input.outcome.path} is not a valid eplan-tool outcome (${issue?.path.join(".") || "(root)"}: ${issue?.message}).`,
    );
  }
  const outcome = parsed.data;
  if (outcome.operation !== "import") return failed(`the outcome is not an import (${outcome.operation}).`);
  if (outcome.status !== "completed")
    return failed(`the eplan-tool import ${outcome.status}: ${outcome.reason ?? "no reason recorded"}.`);
  if (outcome.project !== input.profile.project.link)
    return failed(
      `the outcome names the project ${outcome.project}, the profile ${input.profile.project.link}.`,
    );
  if (outcome.candidate?.sha256 !== input.candidateSha256)
    return failed(
      `the outcome imported another candidate (sha256 ${outcome.candidate?.sha256 ?? "none"}), not ${input.candidateSha256}.`,
    );
  if (outcome.profile?.sha256 !== input.profileSha256)
    return failed(
      `the outcome ran with another profile (sha256 ${outcome.profile?.sha256 ?? "none"}), not ${input.profileSha256}.`,
    );
  const required = ["snapshot", "import", "reports", ...input.exports.map((file) => `export-${file.table}`)];
  for (const name of required) {
    const step = outcome.steps.find((entry) => entry.name === name);
    if (step?.exit !== 0) return failed(`the outcome records no ${name} step that exited 0.`);
  }
  for (const file of input.exports) {
    const recorded = outcome.files.find((entry) => entry.table === file.table);
    if (!recorded) return failed(`the outcome records no ${file.table} re-export.`);
    if (recorded.sha256 !== file.sha256)
      return failed(
        `the ${file.table} re-export ${file.path} (sha256 ${file.sha256}) differs from the outcome's file ${recorded.path} (sha256 ${recorded.sha256}).`,
      );
  }
  return { id: "outcome", title, verdict: "pass" };
}

// ---------------------------------------------------------------------------------------------------------------
// Check result

export interface EplanStampedTable {
  data: EplanTableData;
  path: string;
  sha256: string;
}
export interface EplanCheckInput {
  profile: EplanProfile;
  profilePath: string;
  profileSha256: string;
  documentation: ElectricalResult;
  model: ElectricalModel;
  modelPath: string;
  modelSha256: string;
  devices: EplanStampedTable;
  terminals: EplanStampedTable | null;
  connections: EplanStampedTable | null;
  roundTrip: {
    base: EplanStampedTable;
    candidate: EplanStampedTable;
    outcome: { path: string; sha256: string; text: string } | null;
  } | null;
  runId: string;
  now: string;
}

/** One result of the EPLAN check (REQ-FUNC-8b2ae38f): reconcile criteria and, with a candidate, the round trip. */
export function analyzeEplan(input: EplanCheckInput): ElectricalResult {
  const { profile, documentation, model } = input;
  const criteria: Criterion[] = [];
  const fresh = resultFreshness(documentation, model);
  criteria.push({
    id: "source:documentation",
    title: `The documentation run ${documentation.runId} is current`,
    verdict: fresh.freshness === "current" ? "pass" : "fail",
    ...(fresh.freshness === "current"
      ? {}
      : {
          note: note(
            `stale: changed ${first(fresh.changed)}${fresh.removed.length ? `; removed ${first(fresh.removed)}` : ""}; run electrical_documentation_check again.`,
          ),
        }),
  });
  const reconciled = reconcileEplan({
    profile,
    documentation,
    model,
    devices: input.devices.data,
    terminals: input.terminals?.data ?? null,
    connections: input.connections?.data ?? null,
  });
  const { devices } = reconciled;
  const deviceIssues = [
    ...devices.eplanOnly.map((entry) => `EPLAN only: ${entry.eplan}`),
    ...devices.veraOnly.map((entry) => `VERA only: ${entry.tag}`),
    ...devices.duplicates.map((tag) => `more than one EPLAN record: ${tag}`),
    ...devices.problems,
  ];
  criteria.push({
    id: "devices",
    title: "EPLAN devices match the documented devices",
    verdict: deviceIssues.length ? "fail" : "pass",
    ...(deviceIssues.length ? { note: note(first(deviceIssues)) } : {}),
  });
  const compared = devices.matched.filter((match) => match.part.verdict !== "unknown");
  const unknownParts = devices.matched.filter((match) => match.part.verdict === "unknown").map((m) => m.tag);
  criteria.push({
    id: "part-numbers",
    title: "EPLAN part numbers match the order codes of the materials list",
    verdict: devices.differs.length ? "fail" : compared.length ? "pass" : "unknown",
    ...(devices.differs.length || unknownParts.length
      ? {
          note: note(
            [
              ...devices.differs.map(
                (entry) => `${entry.tag}: EPLAN ${entry.eplanValue}, VERA ${entry.veraValue}`,
              ),
              ...(unknownParts.length
                ? [`not compared (no part or order code): ${unknownParts.join(", ")}`]
                : []),
            ].join("; "),
          ),
        }
      : {}),
  });
  const setCriterion = (
    id: "terminals" | "connections",
    title: string,
    entry: {
      eplanOnly: string[];
      veraOnly: string[];
      problems: string[];
      wireDiffers?: { ends: string; eplan: string; vera: string }[];
    } | null,
  ) => {
    if (!entry) {
      criteria.push({ id, title, verdict: "not-evaluated", note: `no ${id} export was named.` });
      return;
    }
    const issues = [
      ...entry.eplanOnly.map((key) => `EPLAN only: ${key}`),
      ...entry.veraOnly.map((key) => `VERA only: ${key}`),
      ...(entry.wireDiffers ?? []).map((wire) => `${wire.ends}: EPLAN wire ${wire.eplan}, VERA ${wire.vera}`),
      ...entry.problems,
    ];
    criteria.push({
      id,
      title,
      verdict: issues.length ? "fail" : "pass",
      ...(issues.length ? { note: note(first(issues)) } : {}),
    });
  };
  setCriterion(
    "terminals",
    "EPLAN terminal points match the panel strips of the terminals list",
    reconciled.terminals,
  );
  setCriterion(
    "connections",
    "EPLAN connections match the connections list (ends and wire numbers)",
    reconciled.connections,
  );

  let outcomeFailed = false;
  if (input.roundTrip) {
    const { base, candidate, outcome } = input.roundTrip;
    const round = roundTripCriteria({
      base: base.data,
      candidate: candidate.data,
      reexport: input.devices.data,
    });
    const result = outcomeCriterion({
      profile,
      profileSha256: input.profileSha256,
      outcome,
      candidateSha256: candidate.sha256,
      exports: [input.devices, input.terminals, input.connections].flatMap((entry) =>
        entry ? [{ table: entry.data.table, path: entry.path, sha256: entry.sha256 }] : [],
      ),
    });
    outcomeFailed = result.verdict !== "pass";
    for (const entry of round)
      criteria.push(
        outcomeFailed && entry.verdict === "pass"
          ? {
              ...entry,
              verdict: "unknown",
              note: "not counted: the eplan-tool outcome does not show this re-export.",
            }
          : entry,
      );
    criteria.push(result);
  }

  const failedSource = criteria.some((entry) => entry.id.startsWith("source:") && entry.verdict === "fail");
  const verdicts = criteria.map((entry) => entry.verdict as Verdict);
  const stamp = (kind: string, table: EplanStampedTable | { path: string; sha256: string } | null) =>
    table ? [`${kind}:${table.path}@sha256:${table.sha256}`] : [];
  const sources = [
    `eplan-profile:${input.profilePath}@sha256:${input.profileSha256}`,
    `model:${input.modelPath}@sha256:${input.modelSha256}`,
    `documentation:${documentation.runId}`,
    ...stamp("eplan-devices", input.devices),
    ...stamp("eplan-terminals", input.terminals),
    ...stamp("eplan-connections", input.connections),
    ...stamp("eplan-base", input.roundTrip?.base ?? null),
    ...stamp("eplan-candidate", input.roundTrip?.candidate ?? null),
    ...stamp("eplan-outcome", input.roundTrip?.outcome ?? null),
  ].map((source) => source.slice(0, 200));
  return {
    kind: "vera-electrical-result",
    format: 1,
    runId: input.runId,
    producer: { plugin: "eplan", operation: "check", engine: { ...eplanEngine } },
    method: {
      id: "eplan-exchange",
      title: "EPLAN exchange tables against the documentation lists and the import round trip",
      reference: "EPLAN API 2025 (eplan.help): devicelist, XMActionDCCommonExport, ProjectAction",
    },
    status: failedSource || outcomeFailed ? "incomplete" : "completed",
    preliminary: verdicts.some((verdict) => verdict !== "pass"),
    startedAt: input.now,
    finishedAt: input.now,
    model: { path: input.modelPath, sha256: input.modelSha256 },
    catalog: null,
    inputs: documentation.inputs.slice(0, electricalLimits.resultInputs),
    assumptions: [
      "An EPLAN device is the documented device whose model object its VERA ID names, else the one whose tag equals the identifier after =plant+location-.",
      "A part number is the order code with the profile's prefix for the catalog manufacturer.",
    ],
    sources: sources.slice(0, electricalLimits.resultList),
    conditions: { documentationRun: { text: documentation.runId }, profile: { text: profile.id } },
    intermediate: [
      { name: "devices:matched", value: devices.matched.length, unit: "1" },
      { name: "devices:eplanOnly", value: devices.eplanOnly.length, unit: "1" },
      { name: "devices:veraOnly", value: devices.veraOnly.length, unit: "1" },
      ...(reconciled.terminals
        ? [{ name: "terminals:matched", value: reconciled.terminals.matched, unit: "1" }]
        : []),
      ...(reconciled.connections
        ? [{ name: "connections:matched", value: reconciled.connections.matched, unit: "1" }]
        : []),
    ],
    criteria: criteria.slice(0, electricalLimits.resultList),
    limits: [
      "VERA reads and writes exchange files only; EPLAN runs only through eplan-tool, and success is taken from the re-export, never from EPLAN's exit code.",
      "Column layouts come from the profile and the user's EPLAN export schemes; EPLAN's own layouts, exit codes and licence behaviour are not confirmed without an installation.",
      "Connections, terminals and macros are compared, never imported.",
    ],
    messages: reconciled.operations.length
      ? [
          `${reconciled.operations.length} model objects do not record their EPLAN device tag yet; eplan view reconcile proposes the electrical_model_change operations.`,
        ]
      : [],
  };
}
