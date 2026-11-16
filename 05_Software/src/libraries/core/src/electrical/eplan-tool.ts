// The EPLAN tools (spec REQ-DATA-203d52e6): eplan (read) pages an exchange table or reconciles the tables with a
// stored electrical-documentation run; eplan_change prepares ONE new device list import file from a base export;
// eplan_check prepares ONE new result with the reconcile and round-trip criteria. They read the profile, the tables,
// the model and the documentation run, write nothing before approval and never start EPLAN: eplan-tool does that.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import {
  type ElectricalResult,
  type EplanProfile,
  type EplanTable,
  electricalIdSchema,
  electricalModelPath,
  eplanLimits,
  eplanProfileDir,
  eplanTables,
} from "@vera/shared";
import { z } from "zod";
import { assertAgentWritable, commitChange, type PreparedChange } from "../tools/changes.js";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { toolPathGuard } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import {
  analyzeEplan,
  decodeEplanTable,
  type EplanStampedTable,
  eplanCandidate,
  parseEplanProfile,
  reconcileEplan,
} from "./eplan.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { fileDiff, readModelFile, readResultFile } from "./tools.js";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const runId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "must be a lower-case sha256");
const tablePath = z
  .string()
  .min(5)
  .max(160)
  .regex(/\.(csv|txt)$/i, "must be a .csv or .txt file");
const csvPath = z
  .string()
  .min(5)
  .max(160)
  .regex(/\.csv$/i, "must be a .csv file");
const jsonPath = z
  .string()
  .min(6)
  .max(160)
  .regex(/\.json$/i, "must be a .json file");
const PAGE = 100;

/** A workbench file read whole, confined by PathGuard, or a clear error. */
async function workbenchFile(root: string, path: string, what: string, limit: number) {
  const target = await (await PathGuard.create(root)).resolve(path);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(`The ${what} ${target.relative} does not exist.`);
    throw error;
  }
  if (!info.isFile()) throw Error(`The ${what} ${target.relative} is not an ordinary file.`);
  if (info.size > limit)
    throw Error(`The ${what} ${target.relative} is larger than ${Math.round(limit / 1024)} KiB.`);
  const bytes = await readFile(target.absolute);
  return { path: target.relative, bytes, sha256: hash(bytes) };
}

/** Reads `electrical-automation-eplan/<id>.json` strictly (REQ-DATA-203d52e6). */
export async function readEplanProfile(
  root: string,
  id: string,
): Promise<{ profile: EplanProfile; path: string; sha256: string }> {
  const checked = electricalIdSchema.safeParse(id);
  if (!checked.success)
    throw Error(`The EPLAN profile ID ${id} is not an ID (lowercase words joined by '-').`);
  const file = await workbenchFile(
    root,
    `${eplanProfileDir}/${id}.json`,
    "EPLAN profile",
    eplanLimits.profileBytes,
  );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    throw Error(`Invalid EPLAN profile ${id}: not UTF-8 text.`);
  }
  return { profile: parseEplanProfile(text, id), path: file.path, sha256: file.sha256 };
}

/** Reads one exchange table strictly (REQ-DATA-e601f922). */
export async function readEplanTable(
  root: string,
  path: string,
  table: EplanTable,
  profile: EplanProfile,
): Promise<EplanStampedTable & { text: string }> {
  const file = await workbenchFile(root, path, `EPLAN ${table} table`, eplanLimits.tableBytes);
  const data = decodeEplanTable(file.bytes, file.path, table, profile);
  return { data, path: file.path, sha256: file.sha256, text: new TextDecoder("utf-8").decode(file.bytes) };
}

async function documentationResult(root: string, run: string): Promise<ElectricalResult> {
  const result = await readResultFile(root, run);
  if (result.producer.plugin !== "electrical-documentation" || !result.documentation)
    throw Error(`The result ${run} is not an electrical_documentation_check result.`);
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// eplan (read)

export const eplanParams = z.strictObject({
  view: z.enum(["inspect", "reconcile"]),
  profile: electricalIdSchema,
  table: z.enum(eplanTables).optional(),
  path: tablePath.optional(),
  offset: z.number().int().min(0).optional(),
  documentationRun: runId.optional(),
  devices: tablePath.optional(),
  terminals: tablePath.optional(),
  connections: tablePath.optional(),
});
const eplanRequest = z.discriminatedUnion("view", [
  z.strictObject({
    view: z.literal("inspect"),
    profile: electricalIdSchema,
    table: z.enum(eplanTables),
    path: tablePath,
    offset: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    view: z.literal("reconcile"),
    profile: electricalIdSchema,
    documentationRun: runId,
    devices: tablePath,
    terminals: tablePath.optional(),
    connections: tablePath.optional(),
  }),
]);

async function eplanView(ctx: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const args = eplanRequest.parse(raw);
  const { profile } = await readEplanProfile(ctx.root, args.profile);
  if (args.view === "inspect") {
    const table = await readEplanTable(ctx.root, args.path, args.table, profile);
    const offset = args.offset ?? 0;
    const roles = new Set(Object.values(table.data.index));
    return {
      table: args.table,
      path: table.path,
      sha256: table.sha256,
      header: table.data.header,
      unmapped: table.data.unmapped,
      total: table.data.records.length,
      offset,
      records: table.data.records.slice(offset, offset + PAGE).map((record) => ({
        line: record.line,
        values: record.values,
        extra: Object.fromEntries(
          table.data.header.flatMap((name, i) => (roles.has(i) ? [] : [[name, record.cells[i] ?? ""]])),
        ),
      })),
    };
  }
  const documentation = await documentationResult(ctx.root, args.documentationRun);
  const model = (await readModelFile(ctx.root))?.model ?? null;
  const devices = await readEplanTable(ctx.root, args.devices, "devices", profile);
  const terminals = args.terminals
    ? await readEplanTable(ctx.root, args.terminals, "terminals", profile)
    : null;
  const connections = args.connections
    ? await readEplanTable(ctx.root, args.connections, "connections", profile)
    : null;
  const reconciled = reconcileEplan({
    profile,
    documentation,
    model,
    devices: devices.data,
    terminals: terminals?.data ?? null,
    connections: connections?.data ?? null,
  });
  return {
    documentationRun: documentation.runId,
    files: [devices, terminals, connections].flatMap((entry) =>
      entry ? [{ table: entry.data.table, path: entry.path, sha256: entry.sha256 }] : [],
    ),
    ...reconciled,
  };
}

export const eplanTool: ToolDefinition = {
  name: "eplan",
  class: "read",
  description:
    "EPLAN exchange views, writing nothing; profile = electrical-automation-eplan/<id>.json (target EPLAN Electric P8 2025, project link, column headers). view inspect {profile, table devices|terminals|connections, path, offset?}: one exported table read strictly (semicolon text with a header), 100 records per page with the mapped values and the unmapped columns. view reconcile {profile, documentationRun, devices, terminals?, connections?}: EPLAN devices (by VERA ID or the identifier after =plant+location-), part numbers (with the profile's manufacturer prefixes), terminal points and connections (ends, wire numbers) against a stored electrical_documentation_check run - matched, differing, EPLAN-only, VERA-only, duplicates - and update-object operations recording attributes.eplanTag that it never applies (use electrical_model_change).",
  params: eplanParams,
  execute: (ctx, args, signal) => {
    signal.throwIfAborted();
    return eplanView(ctx, args);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// eplan_change (write)

export const eplanChangeParams = z.strictObject({
  action: z.literal("candidate"),
  profile: electricalIdSchema,
  base: tablePath,
  sha256,
  documentationRun: runId,
  path: csvPath,
});

/** Prepares the device list import candidate as a new file (REQ-FUNC-0103d4c6, REQ-REL-f8d51ff3). */
export async function prepareEplanChange(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = eplanChangeParams.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const { profile } = await readEplanProfile(ctx.root, args.profile);
  const base = await readEplanTable(ctx.root, args.base, "devices", profile);
  if (base.sha256 !== args.sha256)
    throw Error(
      `The base export ${base.path} changed: its sha256 is ${base.sha256}, not ${args.sha256}. Inspect it again and build the candidate from the current file.`,
    );
  const documentation = await documentationResult(ctx.root, args.documentationRun);
  const model = (await readModelFile(ctx.root))?.model ?? null;
  const inside = await (await PathGuard.create(ctx.root)).resolve(args.path);
  const target = await (await toolPathGuard(ctx)).resolve(args.path);
  if (target.key !== inside.key) throw Error("The candidate must be inside the workbench.");
  await assertAgentWritable(ctx, target);
  try {
    await lstat(inside.absolute);
    throw Error(`The candidate ${inside.relative} already exists: name a new file.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const reconciled = reconcileEplan({ profile, documentation, model, devices: base.data });
  const { text, report } = eplanCandidate({ profile, base: base.data, reconciled });
  signal.throwIfAborted();
  const after = Buffer.from(text, "utf8");
  const afterSha256 = hash(after);
  const preview = fileDiff(inside.relative, "", text);
  const request = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool: "eplan_change" as const,
    path: inside.relative,
    args: Object.freeze({ ...args }),
    existed: false,
    beforeSha256: null,
    afterSha256,
    diff: preview.diff,
    bytes: after.length,
    protected: false,
  });
  return Object.freeze({
    request,
    apply: commitChange({
      ctx,
      signal,
      target,
      path: args.path,
      before: null,
      beforeSha256: null,
      after,
      afterSha256,
      changePath: inside.relative,
      diff: preview.diff,
      added: preview.added,
      removed: preview.removed,
      result: {
        path: inside.relative,
        sha256: afterSha256,
        bytes: after.length,
        base: { path: base.path, sha256: base.sha256 },
        documentationRun: documentation.runId,
        report,
      },
    }),
  });
}

export const eplanChangeTool: ToolDefinition = {
  name: "eplan_change",
  class: "write",
  description:
    "Prepare an EPLAN device list import candidate as a NEW .csv file: action candidate {profile, base (a device list exported with XDLCsvImporterExporter), sha256 (of the base, from eplan view inspect), documentationRun, path}. Every base record that does not change is copied byte for byte; matched devices get the documented order code (with the manufacturer prefix) in the part column and their model ID in an empty VERA ID column; documented devices missing in EPLAN are appended as -<tag>; nothing is removed. The result reports updated, added, unchanged and EPLAN-only devices and what cannot transfer (connections, terminals, macros, unmapped fields). A changed base or an existing path is refused. EPLAN is not touched: import the file into a copy with eplan-tool import. After approval like a write.",
  params: eplanChangeParams,
  prepare: (ctx, args, signal) => prepareEplanChange(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareEplanChange(ctx, args, signal)).apply(signal),
};

// ---------------------------------------------------------------------------------------------------------------
// eplan_check (write)

export const eplanCheckParams = z.strictObject({
  profile: electricalIdSchema,
  documentationRun: runId,
  exports: z.strictObject({
    devices: tablePath,
    terminals: tablePath.optional(),
    connections: tablePath.optional(),
  }),
  base: z.strictObject({ path: tablePath, sha256 }).optional(),
  candidate: csvPath.optional(),
  outcome: jsonPath.optional(),
});

/** Prepares one check result (REQ-FUNC-8b2ae38f, REQ-REL-803299e7); nothing is written before approval. */
export async function prepareEplanCheck(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = eplanCheckParams.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  if ((args.base === undefined) !== (args.candidate === undefined))
    throw Error("A round-trip check needs both base and candidate.");
  if (args.outcome !== undefined && args.candidate === undefined)
    throw Error("An eplan-tool outcome is checked only with base and candidate.");
  const file = await readModelFile(ctx.root);
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const profile = await readEplanProfile(ctx.root, args.profile);
  const documentation = await documentationResult(ctx.root, args.documentationRun);
  const devices = await readEplanTable(ctx.root, args.exports.devices, "devices", profile.profile);
  const terminals = args.exports.terminals
    ? await readEplanTable(ctx.root, args.exports.terminals, "terminals", profile.profile)
    : null;
  const connections = args.exports.connections
    ? await readEplanTable(ctx.root, args.exports.connections, "connections", profile.profile)
    : null;
  let roundTrip: Parameters<typeof analyzeEplan>[0]["roundTrip"] = null;
  if (args.base && args.candidate) {
    const base = await readEplanTable(ctx.root, args.base.path, "devices", profile.profile);
    if (base.sha256 !== args.base.sha256)
      throw Error(
        `The base export ${base.path} changed: its sha256 is ${base.sha256}, not ${args.base.sha256}.`,
      );
    const candidate = await readEplanTable(ctx.root, args.candidate, "devices", profile.profile);
    let outcome: { path: string; sha256: string; text: string } | null = null;
    if (args.outcome) {
      const read = await workbenchFile(
        ctx.root,
        args.outcome,
        "eplan-tool outcome",
        eplanLimits.outcomeBytes,
      );
      outcome = { path: read.path, sha256: read.sha256, text: new TextDecoder("utf-8").decode(read.bytes) };
    }
    roundTrip = { base, candidate, outcome };
  }
  signal.throwIfAborted();
  const { runId: run, now } = newRun();
  const result = analyzeEplan({
    profile: profile.profile,
    profilePath: profile.path,
    profileSha256: profile.sha256,
    documentation,
    model: file.model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    devices,
    terminals,
    connections,
    roundTrip,
    runId: run,
    now,
  });
  return prepareResultChange({
    ctx,
    signal,
    tool: "eplan_check",
    args,
    result,
    model: file.model,
    label: "EPLAN check",
  });
}

export const eplanCheckTool: ToolDefinition = {
  name: "eplan_check",
  class: "write",
  description:
    "Store one EPLAN check result: {profile, documentationRun, exports {devices, terminals?, connections?}} gives criteria source:documentation (the run is current), devices, part-numbers, terminals and connections against the documentation lists; with base {path, sha256}, candidate and outcome (eplan-tool's outcome.json of the import, exports = the re-export from the copy) also identity (every candidate device once in the re-export), unchanged (other cells as in the base), applied (every candidate value present) and outcome (completed import of this candidate into the profile's project with these re-exports). A missing, refused, failed or interrupted outcome fails outcome and leaves the run incomplete; success is never taken from EPLAN's exit code. No source file is changed; after approval like a write.",
  params: eplanCheckParams,
  prepare: (ctx, args, signal) => prepareEplanCheck(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareEplanCheck(ctx, args, signal)).apply(signal),
};
