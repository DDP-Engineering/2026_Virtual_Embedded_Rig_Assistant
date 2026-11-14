import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import { formatPatch, structuredPatch } from "diff";
import { z } from "zod";
import type { LoadedPlugin } from "../plugins/store.js";
import { PathGuard } from "../workbench/path-guard.js";
import { isBinary } from "./binary.js";
import { assertAgentWritable, commitChange, type PreparedChange, protectedPath } from "./changes.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import { toolPathGuard } from "./context.js";

/** The official plugin whose candidates apply_candidate writes (spec REQ-DATA-891d5b5d §10). */
export const kicadLayoutPluginId = "kicad-layout";
/** Only the reviewed official package enables apply_candidate; a local copy with the same id does not. */
export function officialLayoutPlugin(plugin: Pick<LoadedPlugin, "manifest" | "record">): boolean {
  return plugin.manifest.id === kicadLayoutPluginId && plugin.record.tier === "official";
}

export const applyCandidateParams = z.strictObject({ run: z.string().min(1) });
const CANDIDATE_LIMIT = 64 * 1024 * 1024;
const DIFF_LINES = 2000;
const DIFF_EDITS = 20000;
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const stateSchema = z.object({
  format: z.literal(1),
  kind: z.literal("kicad-layout-state"),
  runId: z.string(),
  source: z.object({ path: z.string().min(1), sha256: sha }),
  candidate: z.object({ path: z.string().min(1), sha256: sha }),
  edits: z.number().int().nonnegative(),
  objectives: z.object({ status: z.string() }),
});
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const lockFile = (board: string) => join(dirname(board), `~${basename(board)}.lck`);
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function assertClosed(board: string): Promise<void> {
  if (await exists(lockFile(board)))
    throw Error(
      `The board is open in KiCad (${basename(lockFile(board))}): save or discard your changes there and close it, then apply again.`,
    );
}
async function boardBytes(path: string, label: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile()) throw Error(`The ${label} is not an ordinary file.`);
  if (info.size > CANDIDATE_LIMIT) throw Error(`The ${label} is larger than 64 MiB.`);
  const bytes = await readFile(path);
  if (isBinary(bytes) || !bytes.toString("utf8").startsWith("(kicad_pcb"))
    throw Error(`The ${label} is not a KiCad board file.`);
  return bytes;
}
/** A unified diff of the board text, cut to DIFF_LINES lines; the run's report lists every change. */
function boardDiff(
  path: string,
  before: string,
  after: string,
): { diff: string; added: number; removed: number } {
  const patch = structuredPatch(path, path, before, after, "", "", { maxEditLength: DIFF_EDITS });
  if (!patch)
    return {
      diff: `The board text differs in more than ${DIFF_EDITS} lines; the run's report.md lists the changes.\n`,
      added: 0,
      removed: 0,
    };
  const lines = patch.hunks.flatMap((hunk) => hunk.lines);
  const all = formatPatch(patch).split("\n");
  const diff =
    all.length > DIFF_LINES
      ? `${all.slice(0, DIFF_LINES).join("\n")}\n… ${all.length - DIFF_LINES} lines left out; the run's report.md lists the changes.\n`
      : all.join("\n");
  return {
    diff,
    added: lines.filter((line) => line.startsWith("+")).length,
    removed: lines.filter((line) => line.startsWith("-")).length,
  };
}

/**
 * Prepares writing a kicad-layout candidate over its source board: the run folder, its state, the candidate and the
 * target are checked here, and the apply step (the write flow's commitChange) checks the hashes and KiCad's lock file
 * again right before it writes.
 */
export async function prepareApplyCandidate(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = applyCandidateParams.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const workbench = await PathGuard.create(ctx.root);
  const run = await workbench.resolve(args.run);
  if (run.relative === "." || !(await lstat(run.absolute)).isDirectory())
    throw Error("Choose a kicad-layout run folder inside the workbench.");
  let state: z.infer<typeof stateSchema>;
  try {
    state = stateSchema.parse(JSON.parse(await readFile(join(run.absolute, "state.json"), "utf8")));
  } catch {
    throw Error("The folder holds no kicad-layout state (state.json, format 1).");
  }
  if (state.edits < 1) throw Error("The candidate has no edit to apply.");
  if (state.objectives.status !== "pass")
    throw Error(
      "The candidate did not pass its objectives (DRC and unconnected items); it cannot be applied.",
    );
  const candidatePath = posix.normalize(state.candidate.path.replaceAll("\\", "/"));
  if (
    candidatePath.startsWith("../") ||
    posix.isAbsolute(candidatePath) ||
    !candidatePath.endsWith(".kicad_pcb")
  )
    throw Error("The candidate must be a .kicad_pcb file inside the run folder.");
  const candidate = await workbench.resolve(`${run.relative}/${candidatePath}`);
  if (!candidate.relative.startsWith(`${run.relative}/`))
    throw Error("The candidate must be a .kicad_pcb file inside the run folder.");
  if (!state.source.path.toLowerCase().endsWith(".kicad_pcb"))
    throw Error("The target must be a .kicad_pcb file.");
  const inside = await workbench.resolve(state.source.path);
  const target = await (await toolPathGuard(ctx)).resolve(state.source.path);
  if (target.key !== inside.key || protectedPath(inside.relative))
    throw Error("The target must be a board inside the workbench that the agent may write.");
  await assertAgentWritable(ctx, target);
  const before = await boardBytes(target.absolute, "source board");
  const beforeSha256 = hash(before);
  if (beforeSha256 !== state.source.sha256)
    throw Error("The source board changed since the candidate was made; open a new candidate.");
  await assertClosed(target.absolute);
  const after = await boardBytes(candidate.absolute, "candidate");
  const afterSha256 = hash(after);
  if (afterSha256 !== state.candidate.sha256)
    throw Error("The candidate changed since its check; edit it again or open a new candidate.");
  const changePath = inside.relative;
  const { diff, added, removed } = boardDiff(changePath, before.toString("utf8"), after.toString("utf8"));
  const request = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool: "apply_candidate" as const,
    path: changePath,
    args: Object.freeze({ ...args }),
    existed: true,
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
      path: state.source.path,
      before,
      beforeSha256,
      after,
      afterSha256,
      changePath,
      diff,
      added,
      removed,
      result: { path: changePath, sha256: afterSha256, bytes: after.length, run: args.run },
      // The approval covers these bytes: a candidate changed since then, or a board opened in KiCad, stops the write.
      check: async () => {
        const current = await readFile(candidate.absolute).catch(() => null);
        if (current === null || hash(current) !== afterSha256)
          throw Error("Conflict: the candidate changed after approval. Check it again before applying.");
        await assertClosed(target.absolute);
      },
    }),
  });
}

export const applyCandidateTool: ToolDefinition = {
  name: "apply_candidate",
  class: "write",
  description:
    "Write a kicad-layout candidate over its source board after the user asks to apply it: give the run folder (`run`, e.g. electronics-results/<run-id>). Only a candidate whose objectives passed, whose source is unchanged and closed in KiCad, is applied; the change needs approval like a write.",
  params: applyCandidateParams,
  prepare: (ctx, args, signal) => prepareApplyCandidate(ctx, args, signal),
  execute: async (ctx, args, signal) => (await prepareApplyCandidate(ctx, args, signal)).apply(signal),
};
