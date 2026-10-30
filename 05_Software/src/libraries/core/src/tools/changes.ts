import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type Database from "better-sqlite3";
import { formatPatch, parsePatch, structuredPatch } from "diff";
import { z } from "zod";
import { type GuardedPath, PathGuard } from "../workbench/path-guard.js";
import type { WriteQueue } from "../workbench/write-queue.js";
import { isBinary } from "./binary.js";
import type { ToolContext } from "./context.js";
import { toolPathGuard } from "./context.js";

export const writeParams = z.strictObject({ path: z.string().min(1), content: z.string() });
export const editParams = z.strictObject({
  path: z.string().min(1),
  oldString: z.string().min(1),
  newString: z.string(),
  replaceAll: z.boolean().optional(),
});
export interface ChangeHost {
  db: Database.Database;
  queue: WriteQueue;
  sessionId: string;
  turnId: string;
  callId: string;
  now(): string;
  assertWritable?(): void;
  /** Persist in the caller's transaction; optional publication runs after commit. */
  recorded(event: ChangeEvent): (() => void) | undefined;
}
export interface ChangeEvent {
  type: "change.recorded";
  changeId: number;
  path: string;
  added: number;
  removed: number;
}
export interface FileChangeRequest {
  readonly workbench: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly tool: "write" | "edit";
  readonly path: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly existed: boolean;
  readonly beforeSha256: string | null;
  readonly afterSha256: string;
  readonly diff: string;
  readonly bytes: number;
  readonly protected: boolean;
  readonly scope?: "filesystem";
}
export type ChangeRequest =
  | FileChangeRequest
  | (Omit<FileChangeRequest, "tool" | "afterSha256"> & {
      readonly tool: "web_download";
      readonly afterSha256: null;
      readonly download: { readonly url: string; readonly maxBytes: number };
    });
export interface PreparedChange {
  readonly request: ChangeRequest;
  apply(signal: AbortSignal): Promise<Record<string, unknown>>;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const conflict = () => Error("Conflict: the file changed. Read it again before preparing a new change.");
async function contents(target: GuardedPath): Promise<Buffer | null> {
  try {
    if (!(await lstat(target.absolute)).isFile()) throw Error("Choose an ordinary workbench file.");
    return await readFile(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export function protectedPath(path: string): boolean {
  const key = process.platform === "win32" ? path.toLowerCase() : path;
  return key === ".vera" || key.startsWith(".vera/");
}
/** Output bytes live only in this closure, never in an observer-mutable request. */
export async function prepareChange(
  ctx: ToolContext,
  tool: "write" | "edit",
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = tool === "write" ? writeParams.parse(raw) : editParams.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const guard = await toolPathGuard(ctx);
  const target = await guard.resolve(args.path);
  if (target.relative === ".") throw Error("Choose a workbench file.");
  const before = await contents(target);
  const beforeSha256 = before === null ? null : hash(before);
  if (before !== null && !ctx.lastReads.has(target.key))
    throw Error(
      tool === "write" ? "Read the file before overwriting it." : "Read the file before editing it.",
    );
  if (before !== null && ctx.lastReads.get(target.key)?.sha256 !== beforeSha256) throw conflict();
  if (before !== null && isBinary(before)) throw Error("Cannot change a binary file with text tools.");
  let replacements = 0;
  let output: string;
  const original = before?.toString("utf8") ?? "";
  if ("content" in args) output = args.content;
  else {
    if (before === null) throw Error("File not found. Read an existing file before editing it.");
    const bom = original.startsWith("\ufeff") ? "\ufeff" : "";
    const text = bom ? original.slice(1) : original;
    const crlf = text.includes("\r\n");
    const normalize = (value: string) => (crlf ? value.replace(/\r?\n/g, "\r\n") : value);
    const oldString = normalize(args.oldString),
      newString = normalize(args.newString);
    const parts = text.split(oldString);
    replacements = parts.length - 1;
    if (!replacements) throw Error("oldString was not found. Read the file and use exact text.");
    if (replacements > 1 && !args.replaceAll)
      throw Error(`oldString has ${replacements} matches. Use unique text or replaceAll.`);
    output = bom + parts.join(newString);
  }
  const after = Buffer.from(output, "utf8");
  const afterSha256 = hash(after);
  const changePath = guard.scope === "filesystem" ? target.absolute.replaceAll("\\", "/") : target.relative;
  const patch = structuredPatch(changePath, changePath, original, output, "", "");
  const lines = patch.hunks.flatMap((hunk) => hunk.lines);
  const added = lines.filter((line) => line.startsWith("+")).length;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  const diff = formatPatch(patch);
  const request = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool,
    path: changePath,
    args: Object.freeze({ ...args }),
    existed: before !== null,
    beforeSha256,
    afterSha256,
    diff,
    bytes: after.length,
    protected: protectedPath(target.relative),
    ...(guard.scope === "filesystem" ? { scope: "filesystem" as const } : {}),
  });
  // Capture host identity as well: caller changes to its next call cannot retarget this row.
  const identity = { sessionId: host.sessionId, callId: host.callId };
  const result =
    tool === "write"
      ? { path: changePath, bytes: after.length, created: before === null }
      : { path: changePath, replacements, added, removed };
  let consumed = false;
  return Object.freeze({
    request,
    async apply(applySignal: AbortSignal) {
      if (consumed) throw Error("Prepared change was already consumed.");
      consumed = true;
      return host.queue.run(async () => {
        const check = async () => {
          signal.throwIfAborted();
          applySignal.throwIfAborted();
          host.assertWritable?.();
          const current = await (await toolPathGuard(ctx)).resolve(args.path);
          if (current.key !== target.key || current.relative !== target.relative) throw conflict();
          const currentBytes = await contents(current);
          if ((currentBytes === null ? null : hash(currentBytes)) !== beforeSha256) throw conflict();
          return current;
        };
        await check();
        await mkdir(dirname(target.absolute), { recursive: true });
        await check();
        const id = Number(
          host.db
            .prepare(
              "INSERT INTO changes(session_id,tool_call_id,path,before_sha256,after_sha256,diff,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
            )
            .run(identity.sessionId, identity.callId, changePath, beforeSha256, afterSha256, diff, host.now())
            .lastInsertRowid,
        );
        const temporary = join(dirname(target.absolute), `.vera-change-${randomUUID()}.tmp`);
        let renamed = false;
        try {
          const mode =
            before !== null && process.platform !== "win32"
              ? (await stat(target.absolute)).mode & 0o777
              : undefined;
          const file = await open(temporary, "wx", 0o600);
          try {
            await file.writeFile(after);
            if (mode !== undefined) await file.chmod(mode);
            await file.sync();
          } finally {
            await file.close();
          }
          await check();
          await rename(temporary, target.absolute);
          renamed = true;
          const publish = host.db.transaction(() => {
            host.assertWritable?.();
            host.db.prepare("UPDATE changes SET status='applied' WHERE id=?").run(id);
            return host.recorded({
              type: "change.recorded",
              changeId: id,
              path: changePath,
              added,
              removed,
            });
          })();
          ctx.lastReads.set(target.key, {
            sha256: afterSha256,
            mtimeMs: (await stat(target.absolute)).mtimeMs,
          });
          publish?.();
          return result;
        } finally {
          if (!renamed)
            await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            });
        }
      });
    },
  });
}
export async function recoverChanges(
  root: string,
  db: Database.Database,
  signal: AbortSignal,
  host?: {
    assertWritable?(): void;
    recorded?(sessionId: string, event: ChangeEvent): (() => void) | undefined;
  },
): Promise<void> {
  const rows = db
    .prepare(
      "SELECT id,session_id,path,before_sha256,after_sha256,diff FROM changes WHERE status='pending' ORDER BY id",
    )
    .all() as {
    id: number;
    session_id: string;
    path: string;
    before_sha256: string | null;
    after_sha256: string;
    diff: string;
  }[];
  for (const row of rows) {
    signal.throwIfAborted();
    let current: string | null | undefined;
    try {
      // Bypass records canonical absolute paths. Recovery only checks hashes; it never rewrites targets.
      const bytes = await contents(
        await (await PathGuard.create(root, root, isAbsolute(row.path) ? "filesystem" : "workbench")).resolve(
          row.path,
        ),
      );
      current = bytes === null ? null : hash(bytes);
    } catch {
      current = undefined;
    }
    signal.throwIfAborted();
    host?.assertWritable?.();
    if (current === row.after_sha256) {
      const lines = parsePatch(row.diff).flatMap((patch) => patch.hunks.flatMap((hunk) => hunk.lines));
      const publish = db.transaction(() => {
        db.prepare("UPDATE changes SET status='applied' WHERE id=? AND status='pending'").run(row.id);
        return host?.recorded?.(row.session_id, {
          type: "change.recorded",
          changeId: row.id,
          path: row.path,
          added: lines.filter((line) => line.startsWith("+")).length,
          removed: lines.filter((line) => line.startsWith("-")).length,
        });
      })();
      publish?.();
    } else if (current === row.before_sha256)
      db.prepare("DELETE FROM changes WHERE id=? AND status='pending'").run(row.id);
    else db.prepare("UPDATE changes SET status='conflict' WHERE id=? AND status='pending'").run(row.id);
  }
}
