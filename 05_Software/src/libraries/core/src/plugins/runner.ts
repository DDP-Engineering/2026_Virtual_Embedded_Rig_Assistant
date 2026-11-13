import { constants, realpathSync } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  type ProgramRunInfo,
  type ProgramRunLog,
  type ProgramRunRecord,
  programRunIdSchema,
  programRunRecordSchema,
  veraError,
} from "@vera/shared";
import { monotonicFactory } from "ulid";
import type { Clock, ProcessExit, ProcessHost } from "../ports.js";
import { PathGuard } from "../workbench/path-guard.js";
import { hostVariable, killProcessTree } from "./process-tree.js";
import { OutputDecoder, TailBuffer } from "./run-output.js";

export interface RunRequest {
  sessionId: string;
  /** Absolute workbench root. */
  workbench: string;
  /** Resolved executable path; the runner never looks a program up by name. */
  executable: string;
  args: readonly string[];
  /** Original program tokens for serial-port locking when args contains a launcher command string. */
  programArgs?: readonly string[];
  /** Workbench-relative working directory; the workbench root when absent. */
  cwd?: string;
  /** The program's own variables, already resolved. */
  env?: Readonly<Record<string, string>>;
  /** Kill the process tree after this many milliseconds; no limit when absent. */
  timeoutMs?: number;
  background?: boolean;
  signal?: AbortSignal;
  /**
   * Awaited after the log opens and immediately before the process starts; a throw abandons the run
   * without starting a process (callers re-check what an approval covered here).
   */
  beforeSpawn?: () => Promise<void>;
  /** What the Runs list shows: the plugin, the program and the agent's arguments (never the executable). */
  label?: { plugin: string; program: string; args: readonly string[] };
}
export interface RunResult {
  runId: string;
  exitCode: number | null;
  signal: string | null;
  /** System error code when the executable could not start. */
  error?: string;
  durationMs: number;
  /** The last `tailChars` characters of interleaved stdout and stderr. */
  output: string;
  truncated: boolean;
  /** Workbench-relative path of the full output. */
  log: string;
  timedOut: boolean;
  stopped: boolean;
}
export interface RunRead {
  /** Output since the previous read, at most `tailChars` characters. */
  output: string;
  truncated: boolean;
  running: boolean;
  exitCode?: number | null;
}
export interface ProgramRun {
  /** Run id and background handle; also the log file name. */
  readonly id: string;
  readonly done: Promise<RunResult>;
  read(): RunRead;
  stop(): Promise<RunResult>;
}
export interface ProgramRunnerOptions {
  host: ProcessHost;
  clock: Pick<Clock, "sleep">;
  /** Managed tool directories, placed before the system PATH. */
  toolPaths?: readonly string[];
  tailChars?: number;
  maxBackground?: number;
  logsKept?: number;
  killGraceMs?: number;
  /** Run id factory; ULIDs by default, so log names sort by age. */
  id?: () => string;
  /** Start time of run records; the system time by default. */
  now?: () => Date;
  /**
   * The device a Linux serial path names after its links (`/dev/serial/by-id/...` -> `/dev/ttyACM0`); a throw keeps
   * the path as written. The file system's realpath by default.
   */
  devicePath?: (path: string) => string;
}

/** Variables copied from the host environment (plugins architecture §3.2), plus every LC_* variable. */
const INHERITED = ["SystemRoot", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR", "LANG", "LANGUAGE"];
const RUN_FILE = /^([0-9A-HJKMNP-TV-Z]{26})\.(?:log|json)$/;
const RUN_RECORD = /^[0-9A-HJKMNP-TV-Z]{26}\.json$/;
/** Runs the Runs list returns, newest first. */
const LISTED = 50;
const RECORD_BYTES = 512 * 1024;
/** Default tail of a run log read for the Runs tab. */
export const RUN_LOG_BYTES = 1024 * 1024;
/** Opening a log never follows a link (where the system supports it) and never blocks on a FIFO. */
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
const COM_PORT = /^(?:\\\\\.\\)?(com\d+)$/i;
const DEVICE_PORT = /^\/dev\/(?:tty\S*|serial\/by-id\/.+)$/;
const thrown = (code: "BUSY" | "DENIED", params: Record<string, string | number>) => ({
  ...veraError(code),
  params,
});

/**
 * Serial ports an argument list names, alone or as the value of `--name=value`; COM names upper-cased, device
 * paths as `devicePath` resolves them (as written when it throws or names no device path).
 */
export function serialPorts(args: readonly string[], devicePath?: (path: string) => string): string[] {
  const ports = new Set<string>();
  for (const arg of args) {
    const equals = arg.indexOf("=");
    for (const value of arg.startsWith("-") && equals > 0 ? [arg, arg.slice(equals + 1)] : [arg]) {
      const com = COM_PORT.exec(value)?.[1];
      if (com) ports.add(com.toUpperCase());
      else if (DEVICE_PORT.test(value)) ports.add(resolveDevice(value, devicePath));
    }
  }
  return [...ports];
}
function resolveDevice(path: string, devicePath: ((path: string) => string) | undefined): string {
  if (!devicePath) return path;
  try {
    const resolved = devicePath(path);
    return resolved.startsWith("/dev/") ? resolved : path;
  } catch {
    return path;
  }
}

/** The minimal environment of a run: allowlisted host variables, the program's own, then the fixed two. */
export function programEnvironment(
  host: ProcessHost,
  toolPaths: readonly string[],
  own: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const windows = host.platform === "win32";
  const same = (left: string, right: string) =>
    windows ? left.toUpperCase() === right.toUpperCase() : left === right;
  const env: Record<string, string> = {};
  const set = (name: string, value: string) => {
    for (const key of Object.keys(env)) if (same(key, name)) delete env[key];
    env[name] = value;
  };
  const path = [...toolPaths, hostVariable(host, "PATH")].filter(Boolean).join(windows ? ";" : ":");
  if (path) set("PATH", path);
  for (const [name, value] of Object.entries(host.env)) {
    if (value === undefined) continue;
    const inherited = INHERITED.find((candidate) => same(candidate, name));
    if (inherited) set(inherited, value);
    else if (windows && same(name, "PATHEXT")) set("PATHEXT", value);
    else if ((windows ? name.toUpperCase() : name).startsWith("LC_")) set(name, value);
  }
  for (const [name, value] of Object.entries(own)) set(name, value);
  set("PYTHONUTF8", "1");
  set("NO_COLOR", "1");
  return env;
}

class Run implements ProgramRun {
  readonly done: Promise<RunResult>;
  readonly background: boolean;
  readonly workbench: string;
  readonly ports: string[];
  private settle!: (result: RunResult) => void;
  private result: RunResult | undefined;
  private reason: "timedOut" | "stopped" | undefined;
  private pid: number | undefined;
  /** Set once the host reports the exit, so a late timeout never signals a reused pid. */
  private exited = false;
  private started = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private file: FileHandle | undefined;
  private folder: string | undefined;
  private startedAt: string | undefined;
  private writing = Promise.resolve();
  private readonly decoders = { stdout: new OutputDecoder(), stderr: new OutputDecoder() };
  private readonly tail: TailBuffer;
  private unread: TailBuffer;
  private readonly abort = () => this.kill("stopped");

  constructor(
    readonly id: string,
    readonly request: RunRequest,
    private readonly runner: ProgramRunner,
    private readonly settings: Required<Omit<ProgramRunnerOptions, "id">>,
  ) {
    this.background = request.background === true;
    this.workbench = runner.key(request.workbench);
    this.ports = serialPorts(
      request.programArgs ?? request.args,
      settings.host.platform === "win32" ? undefined : settings.devicePath,
    );
    this.tail = new TailBuffer(settings.tailChars);
    this.unread = new TailBuffer(settings.tailChars);
    this.done = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  get log(): string {
    return `.vera/runs/${this.id}.log`;
  }

  /** Guards the working directory, opens the log, prunes old logs and starts the program. */
  async begin(): Promise<void> {
    const { host } = this.settings;
    const guard = await PathGuard.create(this.request.workbench);
    let cwd: string;
    try {
      cwd = (await guard.resolve(this.request.cwd ?? ".")).absolute;
      if (!(await stat(cwd)).isDirectory()) throw Error("Not a directory.");
    } catch {
      throw thrown("DENIED", { cwd: this.request.cwd ?? "." });
    }
    const runs = join(guard.root, ".vera", "runs");
    await mkdir(runs, { recursive: true });
    const info = await lstat(runs);
    if (!info.isDirectory() || info.isSymbolicLink()) throw thrown("DENIED", { path: ".vera/runs" });
    this.folder = runs;
    this.file = await open(join(runs, `${this.id}.log`), "w");
    await this.runner.prune(runs);
    this.request.signal?.addEventListener("abort", this.abort, { once: true });
    if (this.request.signal?.aborted) this.reason = "stopped";
    if (this.reason) {
      await this.finish({ code: null, signal: null });
      return;
    }
    try {
      await this.request.beforeSpawn?.();
    } catch (error) {
      this.write("[VERA] The program did not start: a check before starting it failed.\n");
      await this.writing;
      throw error;
    }
    await this.record();
    // The last stop check stays right before the spawn: a stop during any await above ends the run here.
    if (this.request.signal?.aborted) this.reason = "stopped";
    if (this.reason) {
      await this.finish({ code: null, signal: null });
      return;
    }
    this.started = performance.now();
    const child = host.spawn(this.request.executable, this.request.args, {
      cwd,
      env: programEnvironment(host, this.settings.toolPaths, this.request.env),
      group: host.platform !== "win32",
      output: (stream, chunk) => this.append(this.decoders[stream].write(chunk)),
    });
    this.pid = child.pid;
    if (this.request.timeoutMs !== undefined)
      this.timer = setTimeout(() => this.kill("timedOut"), this.request.timeoutMs);
    void child.exit.then((exit) => this.finish(exit));
  }

  /** Settles a run that never started because `begin` failed. */
  abandon(): void {
    this.request.signal?.removeEventListener("abort", this.abort);
    void this.file?.close().catch(() => {});
    this.settle(this.snapshot({ code: null, signal: null }));
  }

  read(): RunRead {
    const output = this.unread.text();
    const truncated = this.unread.total > output.length;
    this.unread = new TailBuffer(this.settings.tailChars);
    return {
      output,
      truncated,
      running: !this.result,
      ...(this.result ? { exitCode: this.result.exitCode } : {}),
    };
  }

  stop(): Promise<RunResult> {
    this.kill("stopped");
    return this.done;
  }

  private kill(reason: "timedOut" | "stopped"): void {
    if (this.exited || this.reason) return;
    this.reason = reason;
    if (this.pid === undefined) return;
    const { host, clock, killGraceMs } = this.settings;
    void killProcessTree(host, this.pid, clock, killGraceMs).catch(() => {});
  }

  private append(text: string): void {
    if (!text) return;
    this.tail.push(text);
    this.unread.push(text);
    this.write(text);
  }

  private write(text: string): void {
    const file = this.file;
    if (!file) return;
    this.writing = this.writing
      .then(() => file.write(text))
      .then(
        () => {},
        () => {},
      );
  }

  private async finish(exit: ProcessExit): Promise<void> {
    this.exited = true;
    clearTimeout(this.timer);
    this.request.signal?.removeEventListener("abort", this.abort);
    this.append(this.decoders.stdout.end());
    this.append(this.decoders.stderr.end());
    if (exit.error) this.write(`\n[VERA] The program could not start: ${exit.error}\n`);
    await this.writing;
    await this.file?.close().catch(() => {});
    this.result = this.snapshot(exit);
    await this.record(this.result);
    this.runner.release(this.id);
    this.settle(this.result);
  }

  /** Writes `<id>.json` beside the log; best effort, like the log, so it never fails the run. */
  private async record(result?: RunResult): Promise<void> {
    if (!this.folder) return;
    this.startedAt ??= this.settings.now().toISOString();
    const { label } = this.request;
    const record: ProgramRunRecord = {
      format: 1,
      id: this.id,
      sessionId: this.request.sessionId,
      ...(label ? { plugin: label.plugin, program: label.program } : {}),
      args: [...(label?.args ?? [])],
      background: this.background,
      startedAt: this.startedAt,
      ...(result
        ? {
            end: result.stopped ? "stopped" : result.timedOut ? "timedOut" : "exited",
            exitCode: result.exitCode,
            ...(result.error === undefined ? {} : { error: result.error.slice(0, 256) }),
            durationMs: result.durationMs,
          }
        : {}),
    };
    // Replaced through a temporary file so a concurrent list never reads half a record.
    const path = join(this.folder, `${this.id}.json`);
    const temporary = `${path}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(record));
      await rename(temporary, path);
    } catch {
      await rm(temporary, { force: true }).catch(() => {});
      await writeFile(path, JSON.stringify(record)).catch(() => {});
    }
  }

  private snapshot(exit: ProcessExit): RunResult {
    const output = this.tail.text();
    return {
      runId: this.id,
      exitCode: exit.code,
      signal: exit.signal,
      ...(exit.error === undefined ? {} : { error: exit.error }),
      durationMs: this.started ? Math.round(performance.now() - this.started) : 0,
      output,
      truncated: this.tail.total > output.length,
      log: this.log,
      timedOut: this.reason === "timedOut",
      stopped: this.reason === "stopped",
    };
  }
}

/** `.vera/runs` of a workbench when it is a real directory. */
async function runsFolder(workbench: string): Promise<string | undefined> {
  const folder = join(resolve(workbench), ".vera", "runs");
  try {
    const info = await lstat(folder);
    return info.isDirectory() && !info.isSymbolicLink() ? folder : undefined;
  } catch {
    return undefined;
  }
}
/** A run record named after its id; undefined when missing, linked, oversized or malformed. */
async function readRecord(path: string, id: string): Promise<ProgramRunRecord | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > RECORD_BYTES) return undefined;
    const parsed = programRunRecordSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success && parsed.data.id === id ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs resolved executables for plugins (plugins architecture §3.2) through the host's ProcessHost:
 * guarded working directory, minimal environment, decoded output with a capped tail and a full log in
 * `.vera/runs/`, timeouts and Stop that kill the whole process tree, at most `maxBackground` background
 * runs per session and a serial-port guard against ports held by unfinished runs.
 */
export class ProgramRunner {
  private readonly active = new Map<string, Run>();
  private readonly settings: Required<Omit<ProgramRunnerOptions, "id">>;
  private readonly nextId: () => string;

  constructor(options: ProgramRunnerOptions) {
    this.settings = {
      host: options.host,
      clock: options.clock,
      toolPaths: options.toolPaths ?? [],
      tailChars: options.tailChars ?? 12_000,
      maxBackground: options.maxBackground ?? 4,
      logsKept: options.logsKept ?? 200,
      killGraceMs: options.killGraceMs ?? 3000,
      now: options.now ?? (() => new Date()),
      devicePath: options.devicePath ?? ((path) => realpathSync(path)),
    };
    this.nextId = options.id ?? monotonicFactory();
  }

  /**
   * Starts a run. Refuses with BUSY `{limit}` a background run beyond the session's limit, with BUSY
   * `{handle, port}` a run naming a serial port that another unfinished run names (foreground or background),
   * and with DENIED a working directory outside the workbench; none of these starts a process.
   */
  async start(request: RunRequest): Promise<ProgramRun> {
    const run = new Run(this.nextId(), request, this, this.settings);
    const runs = [...this.active.values()];
    if (
      run.background &&
      runs.filter((other) => other.background && other.request.sessionId === request.sessionId).length >=
        this.settings.maxBackground
    )
      throw thrown("BUSY", { limit: this.settings.maxBackground });
    for (const port of run.ports) {
      const holder = runs.find((other) => other.ports.includes(port));
      if (holder) throw thrown("BUSY", { handle: holder.id, port });
    }
    this.active.set(run.id, run);
    try {
      await run.begin();
    } catch (error) {
      this.active.delete(run.id);
      run.abandon();
      throw error;
    }
    return run;
  }

  async run(request: RunRequest): Promise<RunResult> {
    return (await this.start(request)).done;
  }

  /** A run that has not finished yet. */
  get(handle: string): ProgramRun | undefined {
    return this.active.get(handle);
  }

  stopSession(sessionId: string): Promise<void> {
    return this.stopWhere((run) => run.request.sessionId === sessionId);
  }

  stopWorkbench(workbench: string): Promise<void> {
    const key = this.key(workbench);
    return this.stopWhere((run) => run.workbench === key);
  }

  stopAll(): Promise<void> {
    return this.stopWhere(() => true);
  }

  /** @internal Comparable form of a workbench root. */
  key(workbench: string): string {
    const absolute = resolve(workbench);
    return this.settings.host.platform === "win32" ? absolute.toLowerCase() : absolute;
  }

  /**
   * @internal Deletes the logs and records of the oldest runs beyond `logsKept`, never those of an
   * unfinished run. Best effort: a file another program holds or that cannot be removed never blocks a run.
   */
  async prune(folder: string): Promise<void> {
    const names = await readdir(folder);
    const ids = [...new Set(names.flatMap((name) => RUN_FILE.exec(name)?.[1] ?? []))].sort();
    for (const id of ids.slice(0, Math.max(0, ids.length - this.settings.logsKept)))
      if (!this.active.has(id))
        for (const name of [`${id}.log`, `${id}.json`])
          if (names.includes(name)) await rm(join(folder, name), { force: true }).catch(() => {});
  }

  /**
   * The runs of a workbench from its run records, newest first and at most 50: `running` while this runner
   * holds the run unfinished, else how it ended, else `interrupted`. Malformed records are skipped.
   */
  async list(workbench: string): Promise<ProgramRunInfo[]> {
    const folder = await runsFolder(workbench);
    if (!folder) return [];
    const ids = (await readdir(folder))
      .filter((name) => RUN_RECORD.test(name))
      .map((name) => name.slice(0, -5))
      .sort()
      .reverse();
    const runs: ProgramRunInfo[] = [];
    for (const id of ids) {
      if (runs.length >= LISTED) break;
      const record = await readRecord(join(folder, `${id}.json`), id);
      if (!record) continue;
      const { format: _format, ...rest } = record;
      runs.push({
        ...rest,
        state: this.running(workbench, id) ? "running" : (record.end ?? "interrupted"),
        log: `.vera/runs/${id}.log`,
      });
    }
    return runs;
  }

  /** The last `maxBytes` of a run's log as UTF-8 text; NOT_FOUND for a run id without a log. */
  async log(workbench: string, id: string, maxBytes = RUN_LOG_BYTES): Promise<ProgramRunLog> {
    const folder = programRunIdSchema.safeParse(id).success ? await runsFolder(workbench) : undefined;
    if (!folder) throw veraError("NOT_FOUND");
    const path = join(folder, `${id}.log`);
    let file: FileHandle;
    try {
      // Windows has no O_NOFOLLOW: a link in place of a log is refused before opening it.
      if (!(await lstat(path)).isFile()) throw veraError("NOT_FOUND");
      file = await open(path, READ_FLAGS);
    } catch {
      throw veraError("NOT_FOUND");
    }
    try {
      const info = await file.stat();
      if (!info.isFile()) throw veraError("NOT_FOUND");
      const length = Math.min(info.size, maxBytes);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, info.size - length);
      let bytes = buffer.subarray(0, bytesRead);
      // A cut tail starts after its first line break, never inside a line (a character or a secret).
      if (info.size > length) bytes = bytes.subarray(bytes.indexOf(10) + 1);
      return {
        id,
        text: new TextDecoder().decode(bytes),
        truncated: info.size > length,
        running: this.running(workbench, id),
      };
    } finally {
      await file.close().catch(() => {});
    }
  }

  /** Stops an unfinished run of the workbench and waits for it to end; NOT_FOUND otherwise. */
  async stopRun(workbench: string, id: string): Promise<void> {
    const run = this.active.get(id);
    if (!run || !this.running(workbench, id)) throw veraError("NOT_FOUND");
    await run.stop();
  }

  private running(workbench: string, id: string): boolean {
    return this.active.get(id)?.workbench === this.key(workbench);
  }

  /** @internal */
  release(id: string): void {
    this.active.delete(id);
  }

  private async stopWhere(match: (run: Run) => boolean): Promise<void> {
    await Promise.all([...this.active.values()].filter(match).map((run) => run.stop()));
  }
}
