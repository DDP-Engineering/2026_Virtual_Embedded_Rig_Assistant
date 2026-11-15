// The electrical model's access port and its two tools (spec REQ-DATA-06c0bd54 "Tools"): electrical_model reads
// bounded views, electrical_model_change writes the model through the write flow (prepared change, diff, before
// hash, write queue, approval). Plugin helpers read the same files; only VERA writes the model.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ElectricalModel,
  type ElectricalResult,
  electricalIdSchema,
  electricalLimits,
  electricalModelPath,
  electricalObjectTypes,
  electricalResultFile,
  electricalResultsDir,
} from "@vera/shared";
import { formatPatch, structuredPatch } from "diff";
import { z } from "zod";
import type { LoadedPlugin } from "../plugins/store.js";
import { assertAgentWritable, commitChange, type PreparedChange } from "../tools/changes.js";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { toolPathGuard } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import { applyOperations, electricalOperationSchema } from "./edit.js";
import { checkModel, entityHash, modelIssues, parseModel, problemsText, serializeModel } from "./model.js";
import { renderResultReport } from "./report.js";
import { checkResult, resultFreshness } from "./results.js";

/** The model tools, offered while any plugin of the electrical or automation ecosystem is loaded. */
export const electricalModelToolNames: readonly string[] = ["electrical_model", "electrical_model_change"];
/** The plugin-specific tools, each offered only while its own plugin (by plugin ID) is loaded. */
export const electricalPluginTools: Readonly<Record<string, string>> = {
  industrial_catalog: "industrial-catalog",
  electrical_network: "electrical-network",
  protection_coordination: "protection-coordination",
  motor_drives: "motor-drives",
  power_quality: "power-quality-pfc",
  lighting_design: "lighting-design",
  qelectrotech: "qelectrotech",
  qelectrotech_change: "qelectrotech",
  qelectrotech_check: "qelectrotech",
};
/** Every tool a host offers only with electrical or automation plugins loaded. */
export const electricalToolNames: readonly string[] = [
  ...electricalModelToolNames,
  ...Object.keys(electricalPluginTools),
];
/** Whether a host whose loaded electrical/automation plugins have these IDs offers the tool. */
export function electricalToolOffered(name: string, plugins: readonly string[]): boolean {
  if (!electricalToolNames.includes(name)) return true;
  const owner = electricalPluginTools[name];
  return owner === undefined ? plugins.length > 0 : plugins.includes(owner);
}
/** Plugins of these ecosystems build on the electrical model; the desktop enables its tools while one is loaded. */
export const electricalModelEcosystems: readonly string[] = ["electrical", "automation"];
export function electricalModelPlugin(plugin: {
  manifest: Pick<LoadedPlugin["manifest"], "ecosystem">;
}): boolean {
  return electricalModelEcosystems.includes(plugin.manifest.ecosystem);
}

const PAGE_OBJECTS = 100;
const PAGE_RELATIONS = 200;
const RESULT_LIST = 100;
const ISSUE_LIST = 100;
const DIFF_LINES = 2000;
const DIFF_EDITS = 20000;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function fileBytes(path: string, limit: number, label: string): Promise<Buffer | null> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile()) throw Error(`The ${label} is not an ordinary file.`);
  if (info.size > limit) throw Error(`The ${label} is larger than ${limit / 1024 / 1024} MiB.`);
  return readFile(path);
}

export interface ModelFile {
  bytes: Buffer;
  sha256: string;
  model: ElectricalModel;
}
/** Reads the workbench's model file strictly; null when there is none. Always confined to the workbench. */
export async function readModelFile(root: string): Promise<ModelFile | null> {
  const target = await (await PathGuard.create(root)).resolve(electricalModelPath);
  const bytes = await fileBytes(target.absolute, electricalLimits.modelBytes, "electrical model");
  if (bytes === null) return null;
  return { bytes, sha256: hash(bytes), model: parseModel(bytes.toString("utf8")) };
}

export interface ResultEntry {
  runId: string;
  freshness: "current" | "stale" | "invalid";
  problem?: string;
  status?: string;
  preliminary?: boolean;
  producer?: { plugin: string; operation: string };
  method?: string;
  finishedAt?: string | null;
  criteria?: Record<string, number>;
  changed?: string[];
  removed?: string[];
}
/** The newest result folders first (by name), each with its freshness against the model. */
export async function listResults(root: string, model: ElectricalModel | null): Promise<ResultEntry[]> {
  const folder = await (await PathGuard.create(root)).resolve(electricalResultsDir);
  let names: string[];
  try {
    names = (await readdir(folder.absolute, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: ResultEntry[] = [];
  for (const runId of names.sort().reverse().slice(0, RESULT_LIST)) {
    const invalid = (problem: string): ResultEntry => ({ runId, freshness: "invalid", problem });
    let bytes: Buffer | null;
    try {
      bytes = await fileBytes(
        join(folder.absolute, runId, electricalResultFile),
        electricalLimits.resultBytes,
        "result",
      );
    } catch (error) {
      entries.push(invalid(error instanceof Error ? error.message : "The result cannot be read."));
      continue;
    }
    if (bytes === null) {
      entries.push(invalid(`${electricalResultFile} is missing`));
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch {
      entries.push(invalid(`${electricalResultFile} is not JSON`));
      continue;
    }
    const checked = checkResult(raw, runId);
    if ("problem" in checked) {
      entries.push(invalid(`${checked.problem.path}: ${checked.problem.message}`));
      continue;
    }
    const { result } = checked;
    const fresh = resultFreshness(result, model);
    const criteria: Record<string, number> = {};
    for (const criterion of result.criteria)
      criteria[criterion.verdict] = (criteria[criterion.verdict] ?? 0) + 1;
    entries.push({
      runId,
      freshness: fresh.freshness,
      status: result.status,
      preliminary: result.preliminary,
      producer: { plugin: result.producer.plugin, operation: result.producer.operation },
      method: result.method.title,
      finishedAt: result.finishedAt,
      criteria,
      ...(fresh.freshness === "stale" ? { changed: fresh.changed, removed: fresh.removed } : {}),
    });
  }
  return entries;
}

/** One stored result, strictly read; throws when it is missing or invalid. */
export async function readResultFile(root: string, runId: string): Promise<ElectricalResult> {
  const path = `${electricalResultsDir}/${runId}/${electricalResultFile}`;
  const target = await (await PathGuard.create(root)).resolve(path);
  const bytes = await fileBytes(target.absolute, electricalLimits.resultBytes, "result");
  if (bytes === null) throw Error(`The result ${runId} does not exist.`);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw Error(`The result ${runId} is invalid: ${electricalResultFile} is not JSON.`);
  }
  const checked = checkResult(raw, runId);
  if ("problem" in checked)
    throw Error(`The result ${runId} is invalid: ${checked.problem.path}: ${checked.problem.message}`);
  return checked.result;
}

export const electricalModelParams = z.strictObject({
  view: z.enum(["summary", "objects", "relations", "results", "report"]),
  type: z.enum(electricalObjectTypes).optional(),
  runId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
    .optional(),
  ids: z.array(electricalIdSchema).max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
});

async function readView(ctx: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const args = electricalModelParams.parse(raw);
  const file = await readModelFile(ctx.root);
  if (args.view === "results")
    return { path: electricalResultsDir, results: await listResults(ctx.root, file?.model ?? null) };
  if (args.view === "report") {
    if (args.runId === undefined) throw Error("view report needs a runId.");
    const result = await readResultFile(ctx.root, args.runId);
    const fresh = resultFreshness(result, file?.model ?? null);
    return {
      runId: args.runId,
      freshness: fresh.freshness,
      ...(fresh.freshness === "stale" ? { changed: fresh.changed, removed: fresh.removed } : {}),
      report: renderResultReport(result, fresh, file?.model ?? null),
    };
  }
  if (!file) return { exists: false, path: electricalModelPath };
  const { model } = file;
  const offset = args.offset ?? 0;
  const ids = args.ids && new Set(args.ids);
  if (args.view === "summary") {
    const counts: Record<string, number> = {};
    for (const object of model.objects) counts[object.type] = (counts[object.type] ?? 0) + 1;
    const issues = modelIssues(model);
    return {
      exists: true,
      path: electricalModelPath,
      sha256: file.sha256,
      project: model.project,
      sources: model.sources.length,
      objects: model.objects.length,
      counts,
      relations: model.relations.length,
      issues: issues.slice(0, ISSUE_LIST),
      ...(issues.length > ISSUE_LIST ? { issuesTruncated: true } : {}),
    };
  }
  if (args.view === "objects") {
    const all = model.objects.filter(
      (object) => (!args.type || object.type === args.type) && (!ids || ids.has(object.id)),
    );
    const page = all.slice(offset, offset + PAGE_OBJECTS);
    return {
      sha256: file.sha256,
      total: all.length,
      offset,
      objects: page.map((object) => ({ ...object, sha256: entityHash(object) })),
      ...(offset + page.length < all.length ? { next: offset + page.length } : {}),
    };
  }
  const all = model.relations.filter((relation) => !ids || ids.has(relation.from) || ids.has(relation.to));
  const page = all.slice(offset, offset + PAGE_RELATIONS);
  return {
    sha256: file.sha256,
    total: all.length,
    offset,
    relations: page,
    ...(offset + page.length < all.length ? { next: offset + page.length } : {}),
  };
}

export const electricalModelTool: ToolDefinition = {
  name: "electrical_model",
  class: "read",
  description:
    "Read the workbench's electrical project model (electrical-automation-model.json) and its plugin results. view summary: project, normative profile, counts and completeness issues; objects: objects (optionally by type or ids) with their sha256; relations: relations (optionally touching ids); results: runs under electrical-automation-results with status, criteria and freshness - a stale result names the changed inputs and is not a current result; report (with runId): the Markdown report of one stored result with its freshness. value null means unknown, never zero.",
  params: electricalModelParams,
  execute: (ctx, args, signal) => {
    signal.throwIfAborted();
    return readView(ctx, args);
  },
};

export const electricalModelChangeParams = z.strictObject({
  operations: z.array(electricalOperationSchema).min(1).max(200),
});

export function fileDiff(path: string, before: string, after: string) {
  const patch = structuredPatch(path, path, before, after, "", "", { maxEditLength: DIFF_EDITS });
  if (!patch) return { diff: `The model differs in more than ${DIFF_EDITS} lines.\n`, added: 0, removed: 0 };
  const lines = patch.hunks.flatMap((hunk) => hunk.lines);
  const all = formatPatch(patch).split("\n");
  const diff =
    all.length > DIFF_LINES
      ? `${all.slice(0, DIFF_LINES).join("\n")}\n… ${all.length - DIFF_LINES} lines left out.\n`
      : all.join("\n");
  return {
    diff,
    added: lines.filter((line) => line.startsWith("+")).length,
    removed: lines.filter((line) => line.startsWith("-")).length,
  };
}

/** Applies the operations in memory, validates the whole model and prepares one write of its canonical bytes. */
export async function prepareElectricalModelChange(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = electricalModelChangeParams.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const workbench = await PathGuard.create(ctx.root);
  const inside = await workbench.resolve(electricalModelPath);
  const target = await (await toolPathGuard(ctx)).resolve(electricalModelPath);
  if (target.key !== inside.key) throw Error("The electrical model must be inside the workbench.");
  await assertAgentWritable(ctx, target);
  const before = await fileBytes(inside.absolute, electricalLimits.modelBytes, "electrical model");
  const beforeSha256 = before === null ? null : hash(before);
  const current = before === null ? null : parseModel(before.toString("utf8"));
  const { model, ids } = await applyOperations(current, args.operations, {
    readImport: async (path) => {
      const source = await workbench.resolve(path);
      const bytes = await fileBytes(source.absolute, electricalLimits.modelBytes, "exchange file");
      if (bytes === null) throw Error(`The exchange file ${path} does not exist.`);
      return bytes.toString("utf8");
    },
  });
  signal.throwIfAborted();
  const checked = checkModel(model);
  if ("problems" in checked) throw Error(problemsText("electrical model change", checked.problems));
  const output = serializeModel(checked.model);
  const original = before?.toString("utf8") ?? "";
  if (output === original) throw Error("The operations leave the electrical model unchanged.");
  const after = Buffer.from(output, "utf8");
  const afterSha256 = hash(after);
  const changePath = inside.relative;
  const { diff, added, removed } = fileDiff(changePath, original, output);
  const request = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool: "electrical_model_change" as const,
    path: changePath,
    args: Object.freeze({ ...args }),
    existed: before !== null,
    beforeSha256,
    afterSha256,
    diff,
    bytes: after.length,
    protected: false,
  });
  return Object.freeze({
    request,
    apply: commitChange({
      ctx,
      signal,
      target,
      path: electricalModelPath,
      before,
      beforeSha256,
      after,
      afterSha256,
      changePath,
      diff,
      added,
      removed,
      result: { path: changePath, sha256: afterSha256, bytes: after.length, ids },
    }),
  });
}

export const electricalModelChangeTool: ToolDefinition = {
  name: "electrical_model_change",
  class: "write",
  description:
    'Change the workbench\'s electrical project model with ordered operations: set-project, add-source, remove-source, add-object, update-object (null removes a field), remove-object, add-relation, remove-relation, import (a format-1 exchange file in the workbench with a mapping that names every imported ID as "new" or an existing ID). IDs are stable (e.g. mot-p1) and separate from visible references (ref M1, QF1); omitted IDs are generated and returned. A quantity is {value, unit, basis} with value null when unknown. The whole model is validated before the change; it needs approval like a write and fails if the model changed meanwhile.',
  params: electricalModelChangeParams,
  prepare: (ctx, args, signal) => prepareElectricalModelChange(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareElectricalModelChange(ctx, args, signal)).apply(signal),
};
