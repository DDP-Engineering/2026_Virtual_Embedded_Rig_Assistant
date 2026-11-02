import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import {
  classifyCommand,
  type PluginRisk,
  type ProgramApproval,
  programArgumentRefusal,
  veraError,
} from "@vera/shared";
import { type GuardedPath, PathGuard } from "../workbench/path-guard.js";
import type { LoadedPlugin } from "./store.js";

export interface ProgramFile {
  readonly arg: number;
  readonly path: string;
  readonly sha256: string;
}
/** The run_program approval request (architecture §4); its requestSha256 binds the approval. */
export interface ProgramChangeRequest {
  readonly tool: "run_program";
  readonly workbench: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly pluginId: string;
  readonly pluginSha256: string;
  readonly trial: boolean;
  readonly program: string;
  readonly executable: string;
  readonly programVersion: string | null;
  readonly args: readonly string[];
  /** Workbench-relative working directory, `.` for the root. */
  readonly cwd: string;
  readonly risk: PluginRisk;
  /** The word an irreversible command's approval needs typed; null for other risks. */
  readonly confirm: string | null;
  readonly notes: readonly string[];
  /** Arguments naming existing workbench files, with the bytes the approval covers. */
  readonly files: readonly ProgramFile[];
}
export interface ProgramRequestInput {
  workbench: string;
  plugin: LoadedPlugin;
  program: string;
  /** The resolved executable path; resolving it is the caller's job. */
  executable: string;
  /** The agent's arguments only: never a launcher, download prefix or program prefix. */
  args: readonly string[];
  cwd?: string | undefined;
  sessionId: string;
  turnId: string;
  callId: string;
  signal?: AbortSignal | undefined;
}
const denied = (params: Record<string, string | number>) => ({ ...veraError("DENIED"), params });
const declares = (plugin: LoadedPlugin, program: string) => Object.hasOwn(plugin.manifest.programs, program);

/** The one enabled plugin declaring `program`; DENIED `undeclared` or `ambiguous` otherwise. */
export function findProgram(enabled: readonly LoadedPlugin[], program: string): LoadedPlugin {
  const found = enabled.filter((plugin) => declares(plugin, program));
  if (found.length > 1) throw denied({ reason: "ambiguous" });
  const [plugin] = found;
  if (!plugin) throw denied({ reason: "undeclared" });
  return plugin;
}
function sha256(path: string, signal: AbortSignal | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path, signal ? { signal } : {})
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
/**
 * Windows opens `app.bin` for `app.bin.`, `app.bin ` and `app.bin::$DATA`; the guard refuses those
 * spellings, so they are reduced to the file they open before it resolves them.
 */
const windowsAlias = (path: string) =>
  path
    .replace(/::\$DATA$/i, "")
    .split(/[\\/]/)
    .map((part) => (part === "." || part === ".." ? part : part.replace(/[. ]+$/, "")))
    .join("/");
/** An argument naming an existing regular workbench file, relative to cwd or absolute inside it. */
async function namedFile(guard: PathGuard, cwd: string, value: string, signal: AbortSignal | undefined) {
  if (!value) return undefined;
  let target: GuardedPath;
  try {
    let path = process.platform === "win32" ? windowsAlias(value) : value;
    if (isAbsolute(path)) {
      path = relative(guard.root, await realpath(path));
      if (!path || path === ".." || path.startsWith("..\\") || path.startsWith("../") || isAbsolute(path))
        return undefined;
    } else if (cwd !== ".") path = `${cwd}/${path}`;
    target = await guard.resolve(path);
    if (!(await lstat(target.absolute)).isFile()) return undefined;
  } catch {
    // Missing, ignored or outside paths are ordinary arguments, not files.
    signal?.throwIfAborted();
    return undefined;
  }
  // A file the guard accepted must be hashed: a read error fails the request instead of unbinding it.
  return { path: target.relative, sha256: await sha256(target.absolute, signal) };
}
/**
 * Classifies a command of `plugin` and binds it to the workbench files its arguments name. Refusals
 * (DENIED with `params.reason`) come before any rule or file is read.
 */
export async function prepareProgramRequest(input: ProgramRequestInput): Promise<ProgramChangeRequest> {
  input.signal?.throwIfAborted();
  const refusal = programArgumentRefusal(input.args);
  if (refusal) throw denied(refusal);
  if (!declares(input.plugin, input.program)) throw denied({ reason: "undeclared" });
  const { manifest, record } = input.plugin;
  const classification = classifyCommand(manifest.rules, input.program, input.args);
  const guard = await PathGuard.create(input.workbench);
  const cwd = (await guard.resolve(input.cwd ?? ".")).relative;
  const files: ProgramFile[] = [];
  for (const [arg, text] of input.args.entries()) {
    const value = /^--[^=]+=(.*)$/s.exec(text)?.[1] ?? text;
    const file = await namedFile(guard, cwd, value, input.signal);
    if (file) files.push(Object.freeze({ arg, ...file }));
  }
  input.signal?.throwIfAborted();
  return Object.freeze({
    tool: "run_program" as const,
    workbench: input.workbench,
    sessionId: input.sessionId,
    turnId: input.turnId,
    callId: input.callId,
    pluginId: manifest.id,
    pluginSha256: record.sha256,
    trial: record.tier === "trial",
    program: input.program,
    executable: input.executable,
    programVersion: Object.hasOwn(record.programs, input.program)
      ? (record.programs[input.program] ?? null)
      : null,
    args: Object.freeze([...input.args]),
    cwd,
    risk: classification.risk,
    confirm: classification.confirm,
    notes: Object.freeze(classification.notes),
    files: Object.freeze(files),
  });
}
/** The card and prompt payload of a run_program approval event. */
export function programApproval(request: ProgramChangeRequest): ProgramApproval {
  return {
    pluginId: request.pluginId,
    trial: request.trial,
    program: request.program,
    programVersion: request.programVersion,
    executable: request.executable,
    args: [...request.args],
    cwd: request.cwd,
    risk: request.risk,
    confirm: request.confirm,
    notes: [...request.notes],
    files: request.files.map((file) => ({ ...file })),
  };
}
