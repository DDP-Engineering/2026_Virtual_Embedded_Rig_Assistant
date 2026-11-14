import { constants } from "node:fs";
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
  serialPortKey,
  veraError,
} from "@vera/shared";
import { monotonicFactory } from "ulid";
import type { Clock, ProcessExit, ProcessHost } from "../ports.js";
import { PathGuard } from "../workbench/path-guard.js";
import type { HeldLeases, LeaseClaim, ResourceLeases } from "./leases.js";
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
  /**
   * The id of an unfinished plan hold (`ProgramRunner.hold`) of the same session whose operation this run is: the
   * hold's reservations never refuse it, and its lease claims borrow the hold's lease files.
   */
  parent?: string;
  /**
   * Bench resources the run reserves and how it is supervised (spec REQ-DATA-f2cbfc23 §5-6): a stop request
   * `graceMs` before the tree kill, and the authorized cleanup run (full arguments of the same executable).
   */
  lease?:
    | {
        claims: readonly LeaseClaim[];
        graceMs: number;
        cleanup?: { args: readonly string[]; timeoutMs: number; shown?: readonly string[] } | undefined;
      }
    | undefined;
}
/** The physical state of a supervised run's resources when it ended. */
export type PhysicalState = "unchanged" | "confirmed" | "unknown";
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
  /** Supervised runs only: the resources' physical state and whether a separate cleanup ran. */
  physical?: PhysicalState;
  cleanup?: "none" | "separate" | "failed";
}
export interface RunRead {
  /** Output since the previous read, at most `tailChars` characters. */
  output: string;
  truncated: boolean;
  running: boolean;
  exitCode?: number | null;
  /** Supervised runs that ended: their physical state and cleanup. */
  physical?: PhysicalState;
  cleanup?: RunResult["cleanup"];
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
  /** The lease registry; runs that claim resources are DENIED without one. */
  leases?: ResourceLeases | undefined;
}
type RunnerSettings = Required<Omit<ProgramRunnerOptions, "id" | "leases">> &
  Pick<ProgramRunnerOptions, "leases">;

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
/** A serial port inside a sigrok-cli driver specification (`driver:conn=COM3:...`). */
const CONN = /(?:^|:)conn=([^:]+)/i;
const CONTROL_BYTES = 64 * 1024;
const thrown = (code: "BUSY" | "DENIED", params: Record<string, string | number>) => ({
  ...veraError(code),
  params,
});

/**
 * Serial ports an argument list names, alone, as the value of `--name=value` or as `conn=` of a sigrok-cli driver
 * specification; COM names upper-cased.
 */
export function serialPorts(args: readonly string[]): string[] {
  const ports = new Set<string>();
  for (const arg of args) {
    const equals = arg.indexOf("=");
    const values = arg.startsWith("-") && equals > 0 ? [arg, arg.slice(equals + 1)] : [arg];
    for (const value of [...values]) {
      const conn = CONN.exec(value)?.[1];
      if (conn) values.push(conn);
    }
    for (const value of values) {
      const com = COM_PORT.exec(value)?.[1];
      if (com) ports.add(com.toUpperCase());
      else if (DEVICE_PORT.test(value)) ports.add(value);
    }
  }
  return [...ports];
}

/** The `probe:<selector>` keys of the values of `--probe` (alone or `--probe=value`), selectors lower-cased. */
export function probeKeys(args: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const [index, arg] of args.entries()) {
    const value = arg === "--probe" ? args[index + 1] : arg.startsWith("--probe=") ? arg.slice(8) : undefined;
    if (value) keys.add(`probe:${value.toLowerCase()}`);
  }
  return [...keys];
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

/** What the runner's in-process reservation checks need of an unfinished run or plan hold. */
interface ActiveRun extends ProgramRun {
  readonly background: boolean;
  readonly sessionId: string;
  readonly workbench: string;
  readonly ports: readonly string[];
  readonly claimKeys: ReadonlySet<string>;
  readonly portKeys: ReadonlySet<string>;
}

class Run implements ActiveRun {
  readonly done: Promise<RunResult>;
  readonly background: boolean;
  readonly workbench: string;
  readonly ports: string[];
  /** Identity keys this run claims, and its serial ports and probes as keys. */
  readonly claimKeys: Set<string>;
  readonly portKeys: Set<string>;
  /** `probe:<selector>` keys of the debug probes the arguments name. */
  readonly probes: string[];
  held: HeldLeases | undefined;
  control: string | undefined;
  private physical: PhysicalState | undefined;
  private cleanup: RunResult["cleanup"];
  private cwd: string | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
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
    private readonly settings: RunnerSettings,
  ) {
    this.background = request.background === true;
    this.workbench = runner.key(request.workbench);
    this.ports = serialPorts(request.programArgs ?? request.args);
    this.claimKeys = new Set(request.lease?.claims.flatMap((claim) => claim.keys) ?? []);
    this.probes = probeKeys(request.programArgs ?? request.args);
    this.portKeys = new Set([...this.ports.map(serialPortKey), ...this.probes]);
    this.tail = new TailBuffer(settings.tailChars);
    this.unread = new TailBuffer(settings.tailChars);
    this.done = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  get log(): string {
    return `.vera/runs/${this.id}.log`;
  }

  get sessionId(): string {
    return this.request.sessionId;
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
    this.cwd = cwd;
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
      env: programEnvironment(host, this.settings.toolPaths, {
        ...this.request.env,
        ...this.supervisionEnv(),
      }),
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
      ...(this.result?.physical
        ? { physical: this.result.physical, cleanup: this.result.cleanup ?? "none" }
        : {}),
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
    const pid = this.pid;
    const { host, clock, killGraceMs } = this.settings;
    const treeKill = () => {
      if (!this.exited) void killProcessTree(host, pid, clock, killGraceMs).catch(() => {});
    };
    const { lease } = this.request;
    if (!lease || !this.control) {
      treeKill();
      return;
    }
    // A supervised program first gets a stop request and its grace period to clean up itself.
    void writeFile(join(this.control, "stop"), reason).catch(() => {});
    this.graceTimer = setTimeout(treeKill, lease.graceMs);
  }

  /** The variables of a supervised run: its control folder and the recorded unknown states of its resources. */
  private supervisionEnv(): Record<string, string> {
    if (!this.control) return {};
    const states = Object.entries(this.held?.states ?? {});
    return {
      VERA_RUN_CONTROL: this.control,
      ...(states.length > 0
        ? {
            VERA_RESOURCE_STATE: JSON.stringify(
              Object.fromEntries(
                states.map(([alias, { state, since, runId, reason }]) => [
                  alias,
                  { state, since, runId, reason },
                ]),
              ),
            ),
          }
        : {}),
    };
  }

  /**
   * After a supervised program ends: the authorized cleanup when an actuating run did not report a released,
   * confirmed or unchanged resource; then the physical state, the recorded markers and the released leases.
   */
  private async supervise(): Promise<void> {
    const { lease } = this.request;
    const held = this.held;
    if (!lease || !held) return;
    try {
      const report = this.control ? await readControlState(this.control) : undefined;
      const actuates = lease.claims.some((claim) => claim.actuates);
      const reported = report?.phase === "released" ? report.physical : undefined;
      if (this.pid === undefined || !actuates) {
        this.physical = this.pid !== undefined && reported === "confirmed" ? "confirmed" : "unchanged";
        this.cleanup = "none";
      } else if (reported === "confirmed" || reported === "unchanged") {
        this.physical = reported;
        this.cleanup = "none";
      } else {
        this.physical = (await this.runCleanup()) ? "confirmed" : "unknown";
        this.cleanup = this.physical === "confirmed" ? "separate" : "failed";
      }
      if (this.physical === "unknown") await held.markUnknown("cleanup-failed").catch(() => {});
      if (this.physical === "confirmed") await held.clear().catch(() => {});
      this.write(`\n[VERA] Physical state: ${this.physical}\n`);
    } finally {
      await held.release();
      await this.settings.leases?.removeControl(this.id);
    }
  }

  /** Runs the declared cleanup once under its timeout; true when it reported the resource released and confirmed. */
  private async runCleanup(): Promise<boolean> {
    const cleanup = this.request.lease?.cleanup;
    const leases = this.settings.leases;
    if (!cleanup || !leases || !this.cwd) return false;
    const { host, clock, killGraceMs } = this.settings;
    const id = `${this.id}-cleanup`;
    let control: string;
    try {
      control = await leases.controlFolder(id);
    } catch {
      return false;
    }
    try {
      this.write(`\n[VERA] Cleanup: ${(cleanup.shown ?? cleanup.args).join(" ")}\n`);
      const decoders = { stdout: new OutputDecoder(), stderr: new OutputDecoder() };
      const child = host.spawn(this.request.executable, cleanup.args, {
        cwd: this.cwd,
        env: programEnvironment(host, this.settings.toolPaths, {
          ...this.request.env,
          VERA_RUN_CONTROL: control,
          VERA_CLEANUP_OF: this.id,
        }),
        group: host.platform !== "win32",
        output: (stream, chunk) => this.append(decoders[stream].write(chunk)),
      });
      let ended = false;
      const timer = setTimeout(() => {
        if (!ended && child.pid !== undefined)
          void killProcessTree(host, child.pid, clock, killGraceMs).catch(() => {});
      }, cleanup.timeoutMs);
      const exit = await child.exit;
      ended = true;
      clearTimeout(timer);
      this.append(decoders.stdout.end());
      this.append(decoders.stderr.end());
      if (exit.error) this.write(`\n[VERA] The cleanup could not start: ${exit.error}\n`);
      const report = await readControlState(control);
      return report?.phase === "released" && report.physical === "confirmed";
    } finally {
      await leases.removeControl(id);
    }
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
    clearTimeout(this.graceTimer);
    this.request.signal?.removeEventListener("abort", this.abort);
    this.append(this.decoders.stdout.end());
    this.append(this.decoders.stderr.end());
    if (exit.error) this.write(`\n[VERA] The program could not start: ${exit.error}\n`);
    await this.supervise();
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
      ...(this.physical ? { physical: this.physical, cleanup: this.cleanup ?? "none" } : {}),
    };
  }
}

/** A run without a process of its own that reserves resources for child runs (a HIL plan). */
export interface HoldRequest {
  sessionId: string;
  /** Absolute workbench root. */
  workbench: string;
  background?: boolean;
  /** Taken in the lease folder for the hold's whole life; child runs borrow them. */
  claims: readonly LeaseClaim[];
  label?: { plugin: string; program: string; args: readonly string[] };
  /** Called once when the hold is asked to stop (program_stop, Runs tab, session stop, app exit). */
  onStop(): void;
}
export interface RunHold extends ProgramRun {
  /** The leases the hold took; undefined without claims. */
  readonly held: HeldLeases | undefined;
  /** Appends text to the hold's log and output. */
  write(text: string): void;
  /** Ends the hold: writes its record, releases its leases and settles `done`. */
  finish(end: {
    exitCode: number | null;
    stopped?: boolean;
    timedOut?: boolean;
    physical?: PhysicalState;
  }): Promise<RunResult>;
}

class Hold implements ActiveRun, RunHold {
  readonly done: Promise<RunResult>;
  readonly background: boolean;
  readonly workbench: string;
  readonly ports: readonly string[] = [];
  readonly claimKeys: ReadonlySet<string>;
  readonly portKeys: ReadonlySet<string>;
  held: HeldLeases | undefined;
  private settle!: (result: RunResult) => void;
  private result: RunResult | undefined;
  private stopping = false;
  private started = 0;
  private startedAt: string | undefined;
  private file: FileHandle | undefined;
  private folder: string | undefined;
  private writing = Promise.resolve();
  private readonly tail: TailBuffer;
  private unread: TailBuffer;

  constructor(
    readonly id: string,
    readonly request: HoldRequest,
    private readonly runner: ProgramRunner,
    private readonly settings: RunnerSettings,
  ) {
    this.background = request.background === true;
    this.workbench = runner.key(request.workbench);
    this.claimKeys = new Set(request.claims.flatMap((claim) => claim.keys));
    this.portKeys = this.claimKeys;
    this.tail = new TailBuffer(settings.tailChars);
    this.unread = new TailBuffer(settings.tailChars);
    this.done = new Promise((resolve) => {
      this.settle = resolve;
    });
  }

  get sessionId(): string {
    return this.request.sessionId;
  }

  get log(): string {
    return `.vera/runs/${this.id}.log`;
  }

  /** The alias of the claim that holds a key, for BUSY messages. */
  nameOf(key: string): string {
    return this.request.claims.find((claim) => claim.keys.includes(key))?.alias ?? key;
  }

  async begin(): Promise<void> {
    const guard = await PathGuard.create(this.request.workbench);
    const runs = join(guard.root, ".vera", "runs");
    await mkdir(runs, { recursive: true });
    const info = await lstat(runs);
    if (!info.isDirectory() || info.isSymbolicLink()) throw thrown("DENIED", { path: ".vera/runs" });
    this.folder = runs;
    this.file = await open(join(runs, `${this.id}.log`), "w");
    await this.runner.prune(runs);
    this.started = performance.now();
    await this.record();
  }

  abandon(): void {
    void this.file?.close().catch(() => {});
    this.settle(this.snapshot(null));
  }

  write(text: string): void {
    if (!text || this.result) return;
    this.tail.push(text);
    this.unread.push(text);
    const file = this.file;
    if (!file) return;
    this.writing = this.writing
      .then(() => file.write(text))
      .then(
        () => {},
        () => {},
      );
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
      ...(this.result?.physical
        ? { physical: this.result.physical, cleanup: this.result.cleanup ?? "none" }
        : {}),
    };
  }

  stop(): Promise<RunResult> {
    if (!this.stopping && !this.result) {
      this.stopping = true;
      try {
        this.request.onStop();
      } catch {
        // The owner ends the hold itself; a failing stop callback never keeps other runs from stopping.
      }
    }
    return this.done;
  }

  async finish(end: Parameters<RunHold["finish"]>[0]): Promise<RunResult> {
    if (this.result) return this.result;
    await this.writing;
    await this.file?.close().catch(() => {});
    this.result = this.snapshot(end.exitCode, end);
    await this.record(this.result);
    await this.held?.release();
    this.runner.release(this.id);
    this.settle(this.result);
    return this.result;
  }

  private snapshot(exitCode: number | null, end?: Parameters<RunHold["finish"]>[0]): RunResult {
    const output = this.tail.text();
    return {
      runId: this.id,
      exitCode,
      signal: null,
      durationMs: this.started ? Math.round(performance.now() - this.started) : 0,
      output,
      truncated: this.tail.total > output.length,
      log: this.log,
      timedOut: end?.timedOut === true,
      stopped: end?.stopped === true,
      ...(end?.physical ? { physical: end.physical, cleanup: "none" as const } : {}),
    };
  }

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
            durationMs: result.durationMs,
          }
        : {}),
    };
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
}

/** The program's last report in its control folder (`state.json`); undefined when missing or malformed. */
async function readControlState(folder: string): Promise<{ phase: string; physical: string } | undefined> {
  try {
    const path = join(folder, "state.json");
    const info = await lstat(path);
    if (!info.isFile() || info.size > CONTROL_BYTES) return undefined;
    const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    if (value.format !== 1 || typeof value.phase !== "string" || typeof value.physical !== "string")
      return undefined;
    return { phase: value.phase, physical: value.physical };
  } catch {
    return undefined;
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
 * runs per session and a serial-port guard against ports held by background runs.
 */
export class ProgramRunner {
  private readonly active = new Map<string, ActiveRun>();
  private readonly settings: RunnerSettings;
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
      leases: options.leases,
    };
    this.nextId = options.id ?? monotonicFactory();
  }

  /**
   * Starts a run. Refuses with BUSY `{limit}` a background run beyond the session's limit, with BUSY
   * `{handle, port}` a run naming a serial port that a running background run names, and with DENIED a
   * working directory outside the workbench; none of these starts a process.
   */
  async start(request: RunRequest): Promise<ProgramRun> {
    const run = new Run(this.nextId(), request, this, this.settings);
    let runs = [...this.active.values()];
    if (request.parent !== undefined) {
      const parent = this.active.get(request.parent);
      if (
        !(parent instanceof Hold) ||
        parent.sessionId !== request.sessionId ||
        parent.workbench !== run.workbench
      )
        throw thrown("DENIED", { reason: "parent" });
      // A plan's operation may use what the plan reserved; its siblings still exclude it.
      runs = runs.filter((other) => other !== parent);
    }
    this.checkBackground(run.background, request.sessionId, runs);
    for (const port of run.ports) {
      const key = serialPortKey(port);
      const holder = runs.find(
        (other) => (other.background && other.ports.includes(port)) || other.claimKeys.has(key),
      );
      if (holder) throw thrown("BUSY", { handle: holder.id, port });
    }
    // A probe a plan reserved (or a background run uses) is BUSY like a serial port.
    for (const key of run.probes) {
      const holder = runs.find(
        (other) => other.claimKeys.has(key) || (other.background && other.portKeys.has(key)),
      );
      if (holder) throw thrown("BUSY", { handle: holder.id, resource: key.slice("probe:".length) });
    }
    const { lease } = request;
    const leases = this.settings.leases;
    if (lease) {
      for (const claim of lease.claims) {
        const holder = runs.find((other) =>
          claim.keys.some((key) => other.claimKeys.has(key) || other.portKeys.has(key)),
        );
        if (holder) throw thrown("BUSY", { handle: holder.id, resource: claim.alias });
      }
      if (!leases) throw thrown("DENIED", { reason: "leases" });
    }
    this.active.set(run.id, run);
    try {
      if (lease && leases) {
        run.held = await leases.acquire(lease.claims, {
          sessionId: request.sessionId,
          runId: run.id,
          parent: request.parent,
        });
        run.control = await leases.controlFolder(run.id);
      }
      await run.begin();
    } catch (error) {
      this.active.delete(run.id);
      await run.held?.release();
      if (run.control) await leases?.removeControl(run.id);
      run.abandon();
      throw error;
    }
    return run;
  }

  async run(request: RunRequest): Promise<RunResult> {
    return (await this.start(request)).done;
  }

  private checkBackground(background: boolean, sessionId: string, runs: readonly ActiveRun[]): void {
    if (
      background &&
      runs.filter((other) => other.background && other.sessionId === sessionId).length >=
        this.settings.maxBackground
    )
      throw thrown("BUSY", { limit: this.settings.maxBackground });
  }

  /**
   * Registers a run without a process of its own (a HIL plan): it reserves `claims` in the lease folder and its keys
   * in this process, so other runs and sessions get BUSY while its child runs (`RunRequest.parent`) use them. It has
   * a log and a run record like any run; `finish` ends it and releases the leases. Refusals as for `start`.
   */
  async hold(request: HoldRequest): Promise<RunHold> {
    const hold = new Hold(this.nextId(), request, this, this.settings);
    const runs = [...this.active.values()];
    this.checkBackground(hold.background, request.sessionId, runs);
    for (const key of hold.claimKeys) {
      const holder = runs.find(
        (other) =>
          other.claimKeys.has(key) ||
          other.portKeys.has(key) ||
          // Any unfinished run on a port the plan will use, foreground ones of other sessions included.
          other.ports.some((port) => serialPortKey(port) === key),
      );
      if (holder) throw thrown("BUSY", { handle: holder.id, resource: hold.nameOf(key) });
    }
    const leases = this.settings.leases;
    if (request.claims.length > 0 && !leases) throw thrown("DENIED", { reason: "leases" });
    this.active.set(hold.id, hold);
    try {
      if (leases && request.claims.length > 0)
        hold.held = await leases.acquire(request.claims, { sessionId: request.sessionId, runId: hold.id });
      await hold.begin();
    } catch (error) {
      this.active.delete(hold.id);
      await hold.held?.release();
      hold.abandon();
      throw error;
    }
    return hold;
  }

  /** A run that has not finished yet. */
  get(handle: string): ProgramRun | undefined {
    return this.active.get(handle);
  }

  stopSession(sessionId: string): Promise<void> {
    return this.stopWhere((run) => run.sessionId === sessionId);
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

  private async stopWhere(match: (run: ActiveRun) => boolean): Promise<void> {
    await Promise.all([...this.active.values()].filter(match).map((run) => run.stop()));
  }
}
