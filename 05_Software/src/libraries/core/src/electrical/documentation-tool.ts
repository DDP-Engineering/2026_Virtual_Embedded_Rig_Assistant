// The electrical documentation tools (spec REQ-DATA-aa83ed5c "Tools"): electrical_documentation_check reads the
// model, a stored panel_engineering_check result, its panel file and motor_drives result, the named .qet schematics,
// an explicitly named tag file and an optional previous run, and prepares ONE new result through the write flow;
// electrical_documentation (read) pages a stored list or shows what changed since a run; electrical_documentation_export
// writes one CSV, XLSX or PDF file next to the run's result, as a new file after approval. Nothing is printed, ordered
// or sent, and no source file is changed.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import {
  type DocumentationResult,
  documentationLists,
  type ElectricalResult,
  electricalIdSchema,
  electricalModelPath,
  electricalResultsDir,
} from "@vera/shared";
import { z } from "zod";
import { assertAgentWritable, commitChange, type PreparedChange } from "../tools/changes.js";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { toolPathGuard } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import {
  analyzeDocumentation,
  changedSources,
  type DocumentationSchematic,
  parseTagFile,
  sourcePaths,
  type TagFile,
  tagFileLimits,
} from "./documentation.js";
import { documentationCsv, documentationPdf, documentationXlsx } from "./documentation-export.js";
import { readPanelFile } from "./panel-file.js";
import { readQetFile } from "./qet-tool.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { resultFreshness } from "./results.js";
import { fileDiff, listResults, readModelFile, readResultFile } from "./tools.js";
import { xmlLimits } from "./xml-strict.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const runId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const qetPath = z
  .string()
  .min(5)
  .max(120)
  .regex(/\.qet$/i, "must be a .qet file");
const csvPath = z
  .string()
  .min(5)
  .max(120)
  .regex(/\.csv$/i, "must be a .csv file");
const PAGE = 100;

/** Reads a tag file strictly, confined to the workbench (REQ-DATA-9ca17c7a). */
export async function readTagFile(
  root: string,
  path: string,
): Promise<{ path: string; sha256: string; file: TagFile }> {
  const target = await (await PathGuard.create(root)).resolve(csvPath.parse(path));
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(`The tag file ${target.relative} does not exist.`);
    throw error;
  }
  if (!info.isFile()) throw Error(`The tag file ${target.relative} is not an ordinary file.`);
  if (info.size > tagFileLimits.bytes) throw Error(`The tag file ${target.relative} is larger than 1 MiB.`);
  const bytes = await readFile(target.absolute);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Error(`Invalid tag file ${target.relative}: line 1: not UTF-8 text.`);
  }
  return { path: target.relative, sha256: hash(bytes), file: parseTagFile(text, target.relative) };
}

/** The current sha256 of each workbench file, or null when it is missing, unreadable or larger than any source. */
async function fileHashes(root: string, paths: readonly string[]): Promise<Map<string, string | null>> {
  const guard = await PathGuard.create(root);
  const out = new Map<string, string | null>();
  for (const path of new Set(paths)) {
    try {
      const target = await guard.resolve(path);
      const info = await lstat(target.absolute);
      if (!info.isFile() || info.size > xmlLimits.chars) throw Error("not a source file");
      out.set(path, hash(await readFile(target.absolute)));
    } catch {
      out.set(path, null);
    }
  }
  return out;
}

async function documentationResult(root: string, run: string): Promise<ElectricalResult> {
  const result = await readResultFile(root, run);
  if (result.producer.plugin !== "electrical-documentation" || !result.documentation)
    throw Error(`The result ${run} is not an electrical_documentation_check result.`);
  return result;
}

async function notCurrent(root: string, model: Parameters<typeof listResults>[1]) {
  return (await listResults(root, model)).flatMap((entry) =>
    entry.freshness === "current"
      ? []
      : [{ runId: entry.runId, plugin: entry.producer?.plugin ?? null, freshness: entry.freshness }],
  );
}

export const electricalDocumentationCheckParams = z.strictObject({
  panelRun: runId,
  schematics: z
    .array(z.strictObject({ path: qetPath, motor: electricalIdSchema.optional() }))
    .max(8)
    .optional(),
  document: electricalIdSchema.optional(),
  tags: csvPath.optional(),
  previousRun: runId.optional(),
});

/** Derives and checks the documentation and prepares the new result file; nothing is written before approval. */
export async function prepareElectricalDocumentationCheck(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const request = electricalDocumentationCheckParams.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const file = await readModelFile(ctx.root);
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const { model } = file;
  const panelResult = await readResultFile(ctx.root, request.panelRun);
  if (panelResult.producer.plugin !== "panel-engineering" || !panelResult.panel)
    throw Error(`The result ${request.panelRun} is not a panel_engineering_check result.`);
  const { panel, stamp } = await readPanelFile(ctx.root, panelResult.panel.id);
  const motorRun = panelResult.sources.find((source) => source.startsWith("motor-drives:"))?.slice(13);
  let motorDrives: ElectricalResult | null = null;
  if (motorRun)
    try {
      motorDrives = await readResultFile(ctx.root, motorRun);
    } catch {
      motorDrives = null;
    }
  if (request.document !== undefined) {
    const document = model.objects.find((object) => object.id === request.document);
    if (document?.type !== "document")
      throw Error(`The document ${request.document} is not a document object of the electrical model.`);
  }
  const schematics: DocumentationSchematic[] = [];
  for (const entry of request.schematics ?? []) {
    if (
      entry.motor !== undefined &&
      model.objects.find((object) => object.id === entry.motor)?.type !== "motor"
    )
      throw Error(
        `The schematic ${entry.path} names ${entry.motor}, which is not a motor of the electrical model.`,
      );
    const qet = await readQetFile(ctx.root, entry.path);
    if (schematics.some((schematic) => schematic.path === qet.path))
      throw Error(`The schematic ${qet.path} is named twice: name each schematic once.`);
    schematics.push({ path: qet.path, sha256: qet.sha256, motor: entry.motor ?? null, project: qet.project });
  }
  const tags = request.tags === undefined ? null : await readTagFile(ctx.root, request.tags);
  const previous =
    request.previousRun === undefined ? null : await documentationResult(ctx.root, request.previousRun);
  const hashes = await fileHashes(ctx.root, previous ? sourcePaths(previous) : []);
  const stale = await notCurrent(ctx.root, model);
  signal.throwIfAborted();
  const { runId: run, now } = newRun();
  const result = analyzeDocumentation({
    model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    panel,
    panelPath: stamp.path,
    panelSha256: stamp.sha256,
    panelResult,
    motorDrives,
    schematics,
    tags,
    document: request.document ?? null,
    previous,
    notCurrent: stale,
    fileHashes: hashes,
    runId: run,
    now,
  });
  return prepareResultChange({
    ctx,
    signal,
    tool: "electrical_documentation_check",
    args: request,
    result,
    model,
    label: "electrical documentation",
  });
}

export const electricalDocumentationCheckTool: ToolDefinition = {
  name: "electrical_documentation_check",
  class: "write",
  description:
    "Derive the project documentation from the electrical model, a stored panel_engineering_check result (its panel file and motor_drives run), the named .qet schematics (each with its motor) and an optional tag file (CSV name,address[,dataType,comment]) and store one result: material, connection (wire), cable, terminal, label, I/O and contents lists, each row with its source file sha256; checks of numbering, wire ends, duplicate connections, labels against panel and model, assembly connections, cable ends, terminal points, the device-terminal-I/O-tag chain and the tag file; the logical revision only from the named model document; with previousRun a change report (rows, objects, sources, stale results). Differences are reported, no source is changed; nothing is printed, ordered or sent; after approval like a write.",
  params: electricalDocumentationCheckParams,
  prepare: (ctx, args, signal) => prepareElectricalDocumentationCheck(ctx, args, signal),
  execute: async (ctx, args, signal) =>
    (await prepareElectricalDocumentationCheck(ctx, args, signal)).apply(signal),
};

export const electricalDocumentationParams = z.strictObject({
  view: z.enum(["list", "changes"]),
  runId,
  list: z.enum(documentationLists).optional(),
  offset: z.number().int().min(0).optional(),
});

async function readView(ctx: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const args = electricalDocumentationParams.parse(raw);
  const result = await documentationResult(ctx.root, args.runId);
  const doc = result.documentation as DocumentationResult;
  if (args.view === "list") {
    if (!args.list) throw Error("The list view needs list.");
    const entry = doc.lists.find((candidate) => candidate.list === args.list);
    const offset = args.offset ?? 0;
    return {
      runId: result.runId,
      revision: doc.revision.value,
      list: args.list,
      title: entry?.title,
      columns: entry?.columns ?? [],
      total: entry?.rows.length ?? 0,
      offset,
      rows: (entry?.rows ?? []).slice(offset, offset + PAGE),
      sha256: entry?.sha256,
    };
  }
  const file = await readModelFile(ctx.root);
  const fresh = resultFreshness(result, file?.model ?? null);
  const sources = changedSources(result, await fileHashes(ctx.root, sourcePaths(result)));
  const results = await notCurrent(ctx.root, file?.model ?? null);
  return {
    runId: result.runId,
    revision: doc.revision.value,
    stale: fresh.freshness === "stale" || sources.length > 0,
    objects: { changed: fresh.changed, removed: fresh.removed },
    sources,
    results,
  };
}

export const electricalDocumentationTool: ToolDefinition = {
  name: "electrical_documentation",
  class: "read",
  description:
    "Electrical documentation views, writing nothing. view list {runId, list materials|connections|cables|terminals|labels|io|contents, offset?}: one stored list, 100 rows per page with each row's key and source; changes {runId}: the model objects changed or removed since that documentation run, its source files (model, panel, .qet, tag file) changed or missing, the stored results that are stale now, and whether the run is stale.",
  params: electricalDocumentationParams,
  execute: (ctx, args, signal) => {
    signal.throwIfAborted();
    return readView(ctx, args);
  },
};

export const electricalDocumentationExportParams = z.strictObject({
  runId,
  format: z.enum(["csv", "xlsx", "pdf"]),
  list: z.enum(documentationLists).optional(),
});

/** Prepares one export file of a stored documentation run, as a new file in its run folder. */
export async function prepareElectricalDocumentationExport(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = electricalDocumentationExportParams.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const result = await documentationResult(ctx.root, args.runId);
  if (args.format === "csv" && !args.list) throw Error("A CSV export needs list.");
  const name = args.format === "csv" ? `documentation-${args.list}.csv` : `documentation.${args.format}`;
  const path = `${electricalResultsDir}/${result.runId}/${name}`;
  const inside = await (await PathGuard.create(ctx.root)).resolve(path);
  const target = await (await toolPathGuard(ctx)).resolve(path);
  if (target.key !== inside.key) throw Error("The export must be inside the workbench.");
  await assertAgentWritable(ctx, target);
  try {
    await lstat(inside.absolute);
    throw Error(`The ${name} of run ${result.runId} was already exported: a run's documents never change.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const text =
    args.format === "csv" ? documentationCsv(result, args.list as (typeof documentationLists)[number]) : null;
  const after = Buffer.from(
    text ?? (args.format === "xlsx" ? documentationXlsx(result) : documentationPdf(result)),
  );
  const afterSha256 = hash(after);
  const preview =
    text === null
      ? {
          diff: `Binary file ${inside.relative} (${args.format.toUpperCase()}): ${after.length} bytes, sha256 ${afterSha256}\n`,
          added: 1,
          removed: 0,
        }
      : fileDiff(inside.relative, "", text);
  const changeRequest = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool: "electrical_documentation_export" as const,
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
    request: changeRequest,
    apply: commitChange({
      ctx,
      signal,
      target,
      path,
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
        runId: result.runId,
        format: args.format,
        sha256: afterSha256,
        bytes: after.length,
        revision: (result.documentation as DocumentationResult).revision.value,
      },
    }),
  });
}

export const electricalDocumentationExportTool: ToolDefinition = {
  name: "electrical_documentation_export",
  class: "write",
  description:
    "Export a stored electrical_documentation_check run as a new file in its run folder: format csv with list (documentation-<list>.csv), xlsx (documentation.xlsx, one sheet per list) or pdf (documentation.pdf, contents page and one section per list). Each file starts with the controlled header: project, document, revision (or not stated), run, generated, model sha256. An existing export is refused; nothing is printed or sent; after approval like a write.",
  params: electricalDocumentationExportParams,
  prepare: (ctx, args, signal) => prepareElectricalDocumentationExport(ctx, args, signal),
  execute: async (ctx, args, signal) =>
    (await prepareElectricalDocumentationExport(ctx, args, signal)).apply(signal),
};
