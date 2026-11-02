import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  classifyCommand,
  type PluginRisk,
  type ProgramApproval,
  programArgumentRefusal,
  veraError,
} from "@vera/shared";
import { type GuardedPath, PathGuard, validateRelativePath } from "../workbench/path-guard.js";
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
  /** Leading arguments the resolver adds before the program's own (part of what the approval covers). */
  readonly executableArgs: readonly string[];
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
  /** The resolver's leading arguments, if any. */
  executableArgs?: readonly string[] | undefined;
  /** The agent's arguments only: never a launcher, download prefix or program prefix. */
  args: readonly string[];
  cwd?: string | undefined;
  sessionId: string;
  turnId: string;
  callId: string;
  signal?: AbortSignal | undefined;
  /** The platform whose path rules apply; `process.platform` by default. */
  platform?: NodeJS.Platform | undefined;
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
/** A stream type suffix Windows ignores: the default data stream of a file or the index of a folder. */
const STREAM_SUFFIX = /(?:::\$DATA|::\$INDEX_ALLOCATION|:\$I30:\$INDEX_ALLOCATION)$/i;
/**
 * The name Windows opens for one path segment: trailing dots and spaces go first, then one stream type
 * suffix, so `app.bin::$DATA.` opens `app.bin` while `app.bin.::$DATA` names `app.bin.`.
 */
function windowsSegment(part: string, literal = false): string {
  if (part === "." || part === "..") return part;
  // Inside `\\?\` Windows keeps trailing dots and spaces; only the stream type suffix still applies.
  const trimmed = literal ? part : part.replace(/[. ]+$/, "");
  const stream = STREAM_SUFFIX.exec(trimmed);
  return stream ? trimmed.slice(0, stream.index) : trimmed;
}
const inside = (root: string, path: string) => {
  const rest = relative(root, path);
  return rest !== ".." && !/^\.\.[\\/]/.test(rest) && !isAbsolute(rest);
};
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
/**
 * Whether a share host names this machine, judged without the network: localhost, loopback addresses
 * (`[::1]`, `0--1.ipv6-literal.net`), this machine's host name with or without a domain, and the
 * addresses of its network interfaces. Other names of this machine (DNS aliases) are not recognised.
 */
function localHost(host: string): boolean {
  let name = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (name.endsWith(".ipv6-literal.net")) name = name.slice(0, -17).replaceAll("-", ":").replace(/s.*$/, "");
  if (name === "localhost" || /^127\./.test(name) || /^(?:0*:)*:?0*1$/.test(name)) return true;
  if (name.split(".")[0] === hostname().toLowerCase().split(".")[0]) return true;
  return Object.values(networkInterfaces()).some((addresses) =>
    (addresses ?? []).some((address) => address.address.toLowerCase().replace(/%.*$/, "") === name),
  );
}
/**
 * The Windows reading of an argument: a drive-relative `X:rest` is relative to the working directory on
 * its drive and to the drive root elsewhere (programs start without `=X:` variables), and every segment
 * is reduced to the name Windows opens (`\\?\` names are taken literally). A segment still holding `:`
 * names a stream of its base. `\\?\X:` and `\\.\X:` name the same files as `X:`; a rooted `\x` is on
 * the working directory's drive. `unmapped` marks a path VERA cannot map into the workbench without
 * reading it: a share path on this machine or a path under a volume or device (`\\?\Volume{…}\…`).
 * `remote` marks a share path on another host, which is never read: opening it would connect there.
 */
function windowsPath(
  value: string,
  cwd: string,
): { path: string; stream?: string; unmapped?: true; remote?: true; device?: true } {
  let path = value.replaceAll("\\", "/");
  // Windows passes `\\?\` and the NT `\??\` prefix on without normalising; `//?/` is normalised like `\\.\`.
  const literal = value.startsWith("\\\\?\\") || value.startsWith("\\??\\");
  const device = /^\/\/[?.]\/(.*)$/s.exec(path) ?? /^\/\?\?\/(.*)$/s.exec(path);
  if (device) {
    const rest = device[1] ?? "";
    if (/^unc\//i.test(rest)) path = `//${rest.slice(4)}`;
    else if (/^[A-Za-z]:(?:\/|$)/.test(rest)) path = rest;
    // A bare device such as `\\.\COM10` is no file; a path below a volume or device cannot be mapped.
    else return rest.includes("/") ? { path, unmapped: true } : { path, device: true };
  }
  if (path.startsWith("//"))
    return localHost(path.slice(2).split("/")[0] ?? "") ? { path, unmapped: true } : { path, remote: true };
  if (path.startsWith("/") && cwd[1] === ":") path = `${cwd.slice(0, 2)}${path}`;
  const drive = /^([A-Za-z]):(?!\/)(.*)$/s.exec(path);
  if (drive) {
    const [, letter = "", rest = ""] = drive;
    path =
      letter.toLowerCase() === cwd.slice(0, 1).toLowerCase() && cwd[1] === ":"
        ? join(cwd, rest).replaceAll("\\", "/")
        : `${letter}:/${rest}`;
  }
  const parts = path.split("/");
  // `X:` is not a name Windows trims.
  const head = /^[A-Za-z]:$/.test(parts[0] ?? "") ? 1 : 0;
  for (let i = head; i < parts.length; i++) {
    const part = windowsSegment(parts[i] as string, literal);
    const colon = part.indexOf(":");
    if (colon >= 0) return { path, stream: [...parts.slice(0, i), part.slice(0, colon)].join("/") };
    parts[i] = part;
  }
  return { path: parts.join("/") };
}
/** An argument naming an existing regular workbench file, relative to cwd or absolute inside it. */
async function namedFile(
  guard: PathGuard,
  cwd: string,
  value: string,
  index: number,
  platform: NodeJS.Platform,
  signal: AbortSignal | undefined,
) {
  if (!value) return undefined;
  let target: GuardedPath;
  let path = value;
  if (platform === "win32") {
    const read = windowsPath(value, cwd);
    // Decided without touching the file system: no share, volume or device path is ever opened here.
    if (read.unmapped) throw denied({ reason: "unbound", index });
    if (read.remote || read.device) return undefined;
    if (read.stream !== undefined) {
      const base = resolve(cwd, read.stream);
      // A stream holds other bytes than the file the approval could hash.
      if (read.stream && inside(guard.root, base) && (await exists(base)))
        throw denied({ reason: "stream", index });
      return undefined;
    }
    path = read.path;
  }
  try {
    if (isAbsolute(path)) path = await realpath(path);
    else path = resolve(cwd, path);
    if (!inside(guard.root, path)) return undefined;
    path = relative(guard.root, path) || ".";
    target = await guard.resolve(path);
    if (!(await lstat(target.absolute)).isFile()) return undefined;
  } catch {
    // Missing, ignored or outside paths are ordinary arguments, not files.
    signal?.throwIfAborted();
    if (await reservedFile(guard.root, path)) throw denied({ reason: "unbound", index });
    return undefined;
  }
  // A file the guard accepted must be hashed: a read error fails the request instead of unbinding it.
  return { path: target.relative, sha256: await sha256(target.absolute, signal) };
}
/**
 * A real workbench file whose name the guard reserves (a device name, a trailing dot or space) cannot be
 * bound: Linux allows such names, and on Windows the `\\?\` namespace creates them.
 */
async function reservedFile(root: string, path: string): Promise<boolean> {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  if (!inside(root, absolute)) return false;
  try {
    validateRelativePath(relative(root, absolute));
    return false;
  } catch {
    try {
      return (await lstat(absolute)).isFile();
    } catch {
      return false;
    }
  }
}
/** Hashes the files of an approved request again; CONFLICT when any differs or cannot be read. */
export async function verifyProgramFiles(request: ProgramChangeRequest, signal?: AbortSignal): Promise<void> {
  const guard = await PathGuard.create(request.workbench);
  for (const file of request.files) {
    let digest: string | undefined;
    try {
      digest = await sha256((await guard.resolve(file.path)).absolute, signal);
    } catch {
      signal?.throwIfAborted();
    }
    if (digest !== file.sha256) throw veraError("CONFLICT");
  }
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
  const directory = await guard.resolve(input.cwd ?? ".");
  const cwd = directory.relative;
  const platform = input.platform ?? process.platform;
  const files: ProgramFile[] = [];
  for (const [arg, text] of input.args.entries()) {
    const value = /^--[^=]+=(.*)$/s.exec(text)?.[1] ?? text;
    const file = await namedFile(guard, directory.absolute, value, arg, platform, input.signal);
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
    executableArgs: Object.freeze([...(input.executableArgs ?? [])]),
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
