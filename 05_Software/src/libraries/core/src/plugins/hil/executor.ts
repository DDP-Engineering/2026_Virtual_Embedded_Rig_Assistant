import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
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
import { join } from "node:path";
import { createContext, Script } from "node:vm";
import { veraError } from "@vera/shared";
import { PathGuard } from "../../workbench/path-guard.js";
import type { PreparedCall } from "../program-tools.js";
import type { PhysicalState, ProgramRun, ProgramRunner, RunHold, RunResult } from "../runner.js";
import type { HilAttemptStatus, HilAwaitParams } from "./adapters.js";
import { type CompiledHilPlan, type HilOperation, planFilesUnchanged, runFolders } from "./compile.js";

/** HIL run states and statuses (spec REQ-DATA-5f714098 §6-7). */
export type HilState = "prepared" | "awaiting-approval" | "running" | "cleaning-up" | "done";
export type HilStatus = "pass" | "fail" | "blocked" | "error" | "incomplete";
export type HilStepStatus = HilAttemptStatus | "skipped" | "not-run" | "stopped" | "pending";
export const HIL_TOOL_VERSION = "1.0.0";
const STEP_LOG_BYTES = 4 * 1024 * 1024;
const EXPECT_MS = 100;
const REPORT_TIMEOUT_MS = 120_000;

export interface HilAttempt {
  repetition: number;
  attempt: number;
  status: HilAttemptStatus;
  exitCode: number | null;
  timedOut: boolean;
  stopped: boolean;
  run?: string;
  log?: string;
  startT: number;
  endT?: number;
  startedAt: string;
  endedAt?: string;
  physical?: PhysicalState;
  folder?: string;
  deviceTimes?: { started?: string; ended?: string };
  problem?: string;
}
export interface HilStepResult {
  id: string;
  phase: HilOperation["phase"];
  use: string;
  plugin?: string;
  program?: string;
  args?: readonly string[];
  risk: string;
  status: HilStepStatus;
  reason?: string;
  attempts: HilAttempt[];
}
export interface HilExecutionDeps {
  readonly workbench: string;
  readonly sessionId: string;
  readonly runner: ProgramRunner;
  /** Starts one prepared operation as a child run of the plan hold. */
  start(
    call: PreparedCall,
    options: { background: boolean; timeoutMs?: number; parent: string; check?: () => Promise<void> },
  ): Promise<ProgramRun>;
  now(): Date;
  /** Milliseconds on a monotonic clock. */
  monotonic(): number;
  /** Monotonic time and wall time of the compilation, and when the approval was asked. */
  readonly origin: number;
  readonly preparedAt: string;
  readonly askedAt: string;
  readonly askedT: number;
}

/** Tests `expect` against output with a time limit per test (regular expressions can backtrack). */
function expectMatcher(source: string): (text: string) => boolean {
  const pattern = new RegExp(source, "m");
  const script = new Script("pattern.test(input.text)");
  const input = { text: "" };
  const context = createContext({ pattern, input });
  return (text) => {
    input.text = text;
    try {
      return script.runInContext(context, { timeout: EXPECT_MS }) === true;
    } catch {
      return false;
    }
  };
}

/** SHA-256 and size of a file read as a stream (capture folders can hold large files). */
function hashStream(path: string): Promise<{ sha256: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    createReadStream(path)
      .on("data", (chunk) => {
        hash.update(chunk);
        bytes += chunk.length;
      })
      .on("error", reject)
      .on("end", () => resolve({ sha256: hash.digest("hex"), bytes }));
  });
}

interface Background {
  op: HilOperation;
  run: ProgramRun;
  attempt: HilAttempt;
  result: HilStepResult;
  ended: Promise<void>;
  stoppedByPlan: boolean;
}

/** One approved plan run: the plan hold, its child runs, the result folder and the report. */
export class HilExecution {
  hold!: RunHold;
  private readonly folder: string;
  private readonly absolute: string;
  private state: HilState = "prepared";
  private readonly states: { state: HilState; at: string; t: number }[] = [];
  private readonly problems: { code: string; message: string; step?: string }[] = [];
  private readonly steps: HilStepResult[];
  private readonly cleanup: HilStepResult[];
  /** Why the steps ended early: a Stop, the budget, or an internal error (never recorded as a Stop). */
  private stopReason: "stopped" | "budget" | "error" | undefined;
  private lastT = 0;
  private phase: "steps" | "cleanup" | "done" = "steps";
  private current: ProgramRun | undefined;
  private readonly background = new Map<string, Background>();
  private seq = 0;
  private events = Promise.resolve();
  private runningT = 0;
  private startedAt = "";
  private endedAt: string | undefined;
  private budgetTimer: ReturnType<typeof setTimeout> | undefined;
  private physical: PhysicalState = "unchanged";
  private status: HilStatus | undefined;
  private artifacts: { path: string; sha256: string; bytes: number }[] = [];
  private firmwareStarted = false;
  private captures = new Map<string, string>();

  constructor(
    readonly compiled: CompiledHilPlan,
    private readonly deps: HilExecutionDeps,
  ) {
    this.folder = `embedded-lab-results/${compiled.runId}`;
    this.absolute = join(deps.workbench, this.folder);
    const describe = (op: HilOperation): HilStepResult => ({
      id: op.id,
      phase: op.phase,
      use: op.use,
      ...(op.call
        ? {
            plugin: op.call.plugin.manifest.id,
            program: op.call.prepared.program,
            args: op.call.prepared.args,
          }
        : {}),
      risk: op.risk,
      status: "pending",
      ...("skip" in op.step && op.step.skip ? { reason: op.step.skip } : {}),
      attempts: [],
    });
    this.steps = compiled.steps.map(describe);
    this.cleanup = compiled.cleanup.map(describe);
    this.states.push({ state: "prepared", at: deps.preparedAt, t: 0 });
    this.states.push({ state: "awaiting-approval", at: deps.askedAt, t: deps.askedT });
    this.lastT = deps.askedT;
  }

  /** Milliseconds since compilation on the monotonic clock, strictly increasing between calls. */
  private t(): number {
    const now = Math.round((this.deps.monotonic() - this.deps.origin) * 1000) / 1000;
    this.lastT = Math.round(Math.max(now, this.lastT + 0.001) * 1000) / 1000;
    return this.lastT;
  }
  private say(text: string): void {
    // A Stop may arrive while the hold is still being created.
    this.hold?.write(`[HIL] ${text}\n`);
  }
  private event(event: string, fields: Record<string, unknown> = {}): void {
    const line = `${JSON.stringify({ seq: ++this.seq, t: this.t(), at: this.deps.now().toISOString(), event, ...fields })}\n`;
    const path = join(this.absolute, "events.jsonl");
    this.events = this.events.then(() => appendFile(path, line)).catch(() => {});
  }
  private enter(state: HilState): void {
    this.state = state;
    this.states.push({ state, at: this.deps.now().toISOString(), t: this.t() });
    this.event("state", { state });
  }

  /** Stop, session stop, app exit or the budget: ends the running steps; the cleanup steps still run. */
  stop(reason: "stopped" | "budget" | "error"): void {
    if (this.stopReason || this.phase !== "steps") return;
    this.stopReason = reason;
    this.event(reason === "budget" ? "budget" : "stop", reason === "error" ? { reason } : {});
    this.say(
      reason === "budget"
        ? "The budget ran out; stopping the running steps."
        : reason === "error"
          ? "An internal error ended the steps; stopping the running steps."
          : "Stop requested; stopping the running steps.",
    );
    if (reason === "budget")
      this.problems.push({
        code: "budget",
        message: `The budget of ${this.compiled.plan.budget.seconds} s ran out.`,
      });
    void this.current?.stop();
    for (const entry of this.background.values()) void entry.run.stop();
  }

  /** Runs the plan to its end and finishes the hold; never throws. */
  async run(): Promise<void> {
    try {
      await this.createFolder();
    } catch (error) {
      this.say(`The result folder ${this.folder} cannot be created: ${(error as Error).message}`);
      await this.hold.finish({ exitCode: 3 });
      return;
    }
    try {
      this.startedAt = this.deps.now().toISOString();
      this.enter("running");
      this.runningT = this.deps.monotonic();
      this.event("lease", {
        claims: this.compiled.claims.map((claim) => ({ kind: claim.kind, name: claim.alias })),
      });
      await this.write();
      this.budgetTimer = setTimeout(() => this.stop("budget"), this.compiled.plan.budget.seconds * 1000);
      await this.runSteps();
      await this.endBackground();
    } catch (error) {
      this.problems.push({ code: "internal", message: (error as Error).message });
      this.stop("error");
      await this.endBackground().catch(() => {});
    } finally {
      clearTimeout(this.budgetTimer);
    }
    let exitCode = 3;
    try {
      this.phase = "cleanup";
      this.enter("cleaning-up");
      await this.write();
      await this.runCleanup();
      this.physical = this.physicalState();
    } catch (error) {
      // Whatever failed here, the cleanup is not confirmed.
      this.problems.push({ code: "internal", message: (error as Error).message });
      this.physical = "unknown";
    }
    try {
      this.event("physical", { physical: this.physical });
      if (this.physical === "unknown") await this.hold.held?.markUnknown("hil-cleanup").catch(() => {});
      if (this.physical === "confirmed") await this.hold.held?.clear().catch(() => {});
      this.status = this.verdict();
      this.phase = "done";
      this.endedAt = this.deps.now().toISOString();
      this.enter("done");
      await this.events;
      this.artifacts = await this.listArtifacts();
      await this.write();
      const report = await this.runReport();
      this.say(
        `Plan ${this.compiled.plan.id}: ${this.status}; physical state ${this.physical}. Result: ${this.folder}/result.json${report}`,
      );
      exitCode = this.status === "pass" ? 0 : this.status === "fail" ? 1 : this.status === "blocked" ? 2 : 3;
    } catch (error) {
      this.problems.push({ code: "internal", message: (error as Error).message });
      this.status = "error";
      this.say(`The plan ended with an internal error: ${(error as Error).message}`);
      await this.write().catch(() => {});
    } finally {
      // The hold always ends: its leases are released and a foreground call returns.
      await this.hold.finish({ exitCode, stopped: this.stopReason === "stopped", physical: this.physical });
    }
  }

  private async createFolder(): Promise<void> {
    const guard = await PathGuard.create(this.deps.workbench);
    const parent = await guard.resolve("embedded-lab-results");
    await mkdir(parent.absolute, { recursive: true });
    if (!(await lstat(parent.absolute)).isDirectory()) throw Error("embedded-lab-results is not a folder");
    await mkdir(this.absolute);
    await mkdir(join(this.absolute, "steps"));
    await writeFile(join(this.absolute, "plan.json"), this.compiled.planBytes, { flag: "wx" });
  }

  private remainingMs(): number {
    if (!this.runningT) return this.compiled.plan.budget.seconds * 1000;
    return Math.max(0, this.compiled.plan.budget.seconds * 1000 - (this.deps.monotonic() - this.runningT));
  }

  private async runSteps(): Promise<void> {
    let halted: "blocked" | "error" | undefined;
    for (const [index, op] of this.compiled.steps.entries()) {
      const result = this.steps[index] as HilStepResult;
      if (this.stopReason || halted) {
        result.status = "not-run";
        continue;
      }
      if ("skip" in op.step && op.step.skip) {
        result.status = "skipped";
        this.event("step-end", { step: op.id, status: "skipped", reason: op.step.skip });
        this.say(`${op.id}: skipped (${op.step.skip})`);
        continue;
      }
      if (op.use === "await") await this.runAwait(op, result);
      else if (op.background) await this.startBackground(op, result);
      else await this.runAttempts(op, result);
      if (result.status === "blocked") halted = "blocked";
      else if (result.status === "error") halted = "error";
      await this.write();
    }
  }

  /** The outcome of a finished attempt: stop, timeout, start failure, exit code, then `expect`. */
  private judge(op: HilOperation, result: RunResult, attempt: HilAttempt): HilAttemptStatus {
    if (result.error) {
      attempt.problem = "start";
      return "error";
    }
    if (result.stopped) return "incomplete";
    if (result.timedOut) {
      attempt.problem = "step-timeout";
      return "error";
    }
    let status = op.adapter.outcome(result.exitCode);
    const expect = op.step.expect;
    if (status === "pass" && expect !== undefined) {
      let matched: boolean;
      try {
        matched = expectMatcher(expect)(result.output);
      } catch {
        // Compilation refuses an invalid pattern; this only guards the executor.
        attempt.problem = "expect";
        return "error";
      }
      if (!matched) {
        attempt.problem = "expect";
        status = "fail";
      }
    }
    return status;
  }

  /**
   * Setup steps are preconditions: a failed one blocks the plan (a stop stays incomplete). In a test step a refusal
   * before any effect (an absent instrument) is an error of that step: `blocked` means a failed precondition.
   */
  private stepStatus(op: HilOperation, status: HilAttemptStatus): HilStepStatus {
    if (op.phase === "setup")
      return status === "fail" || status === "error" || status === "blocked" ? "blocked" : status;
    return status === "blocked" ? "error" : status;
  }

  private async prepareAttempt(op: HilOperation): Promise<string[]> {
    if (op.use === "lab-validate.compare") await this.writeRequest(op);
    return op.adapter.folders ? runFolders(this.deps.workbench, op.folder) : [];
  }

  /** Starts an operation; a refusal (changed files, BUSY) becomes the attempt's error. */
  private async launch(
    op: HilOperation,
    attempt: HilAttempt,
    background: boolean,
    timeoutMs: number,
  ): Promise<ProgramRun | undefined> {
    try {
      return await this.deps.start(op.call as PreparedCall, {
        background,
        timeoutMs,
        parent: this.hold.id,
        // Steps also need the plan and the firmware unchanged; a cleanup step needs only its own files, so a
        // rebuilt firmware never keeps the bench from being made safe.
        ...(op.group === "cleanup"
          ? {}
          : {
              check: async () => {
                if (!(await planFilesUnchanged(this.deps.workbench, this.compiled)))
                  throw veraError("CONFLICT");
              },
            }),
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      attempt.status = "error";
      attempt.problem = code === "CONFLICT" ? "changed" : code === "BUSY" ? "busy" : "start";
      attempt.endT = this.t();
      attempt.endedAt = this.deps.now().toISOString();
      if (code === "CONFLICT") {
        this.problems.push({
          code: "changed",
          step: op.id,
          message: `A file the approval covers changed before ${op.id} started; it did not start.`,
        });
        this.event("changed", { step: op.id });
      } else
        this.problems.push({
          code: attempt.problem,
          step: op.id,
          message: error instanceof Error ? error.message : JSON.stringify(error),
        });
      return undefined;
    }
  }

  private newAttempt(repetition: number, attempt: number): HilAttempt {
    return {
      repetition,
      attempt,
      status: "error",
      exitCode: null,
      timedOut: false,
      stopped: false,
      startT: this.t(),
      startedAt: this.deps.now().toISOString(),
    };
  }

  private async finishAttempt(op: HilOperation, attempt: HilAttempt, result: RunResult, before: string[]) {
    attempt.status = this.judge(op, result, attempt);
    attempt.exitCode = result.exitCode;
    attempt.timedOut = result.timedOut;
    attempt.stopped = result.stopped;
    attempt.run = result.runId;
    attempt.endT = this.t();
    attempt.endedAt = this.deps.now().toISOString();
    if (result.physical) attempt.physical = result.physical;
    // A process that ran (an exit code, or killed by a signal) may have started the firmware, also when cut short.
    if (
      (result.exitCode !== null || result.signal !== null) &&
      (op.adapter.flashes || op.adapter.resets(op.params))
    )
      this.firmwareStarted = true;
    const log = await this.copyLog(op, attempt, result);
    if (log) attempt.log = log;
    if (op.adapter.folders) {
      const created = (await runFolders(this.deps.workbench, op.folder)).filter(
        (name) => !before.includes(name),
      );
      const name = created[created.length - 1];
      if (name) {
        attempt.folder = `${op.folder}/${name}`;
        const times = await this.deviceTimes(attempt.folder);
        if (times) attempt.deviceTimes = times;
        if (op.use === "scpi.capture" && attempt.status === "pass") this.captures.set(op.id, attempt.folder);
      }
    }
    this.event("step-end", {
      step: op.id,
      repetition: attempt.repetition,
      attempt: attempt.attempt,
      status: attempt.status,
      exitCode: attempt.exitCode,
      run: attempt.run,
      ...(attempt.problem ? { problem: attempt.problem } : {}),
    });
    this.say(
      `${op.id} ${attempt.repetition}.${attempt.attempt}: ${attempt.status}${attempt.problem ? ` (${attempt.problem})` : ""}, exit ${attempt.exitCode}`,
    );
  }

  private async runAttempts(op: HilOperation, result: HilStepResult): Promise<void> {
    let status: HilAttemptStatus = "pass";
    for (let repetition = 1; repetition <= op.repeat; repetition++) {
      for (let number = 1; number <= 1 + op.retries; number++) {
        const attempt = this.newAttempt(repetition, number);
        result.attempts.push(attempt);
        const remaining = this.remainingMs();
        if (this.stopReason || remaining <= 0) {
          attempt.status = "incomplete";
          attempt.problem = this.stopReason ?? "budget";
          status = "incomplete";
          break;
        }
        if (number > 1) this.event("retry", { step: op.id, repetition, attempt: number });
        const before = await this.prepareAttempt(op);
        this.event("step-start", { step: op.id, repetition, attempt: number, handoff: this.handoff(op) });
        const run = await this.launch(op, attempt, false, Math.min(op.timeout * 1000, remaining));
        if (!run) {
          // A refused start (changed file, BUSY) is an error in any phase, never a failed precondition.
          result.status = "error";
          return;
        }
        this.current = run;
        if (this.stopReason) void run.stop();
        const done = await run.done;
        this.current = undefined;
        await this.finishAttempt(op, attempt, done, before);
        status = attempt.status;
        if (status === "pass" || this.stopReason) break;
      }
      if (status !== "pass") break;
    }
    result.status = this.stepStatus(op, status);
  }

  /** A serial port or probe a different program than the previous step used: an explicit handoff in the log. */
  private lastUser = new Map<string, string>();
  private handoff(op: HilOperation): string[] | undefined {
    const program = op.call?.prepared.program ?? "";
    const moved: string[] = [];
    for (const key of op.keys.filter((key) => key.startsWith("serial:") || key.startsWith("probe:"))) {
      const last = this.lastUser.get(key);
      if (last !== undefined && last !== program) moved.push(`${key} ${last} -> ${program}`);
      this.lastUser.set(key, program);
    }
    if (moved.length === 0) return undefined;
    this.event("handoff", { step: op.id, moved });
    return moved;
  }

  private async startBackground(op: HilOperation, result: HilStepResult): Promise<void> {
    const attempt = this.newAttempt(1, 1);
    result.attempts.push(attempt);
    const before = await this.prepareAttempt(op);
    this.event("step-start", { step: op.id, background: true, handoff: this.handoff(op) });
    const run = await this.launch(op, attempt, true, Math.min(op.timeout * 1000, this.remainingMs()));
    if (!run) {
      result.status = "error";
      return;
    }
    result.status = "pending";
    const entry: Background = {
      op,
      run,
      attempt,
      result,
      stoppedByPlan: false,
      ended: run.done.then(async (done) => {
        await this.finishAttempt(op, attempt, done, before);
        result.status =
          entry.stoppedByPlan && attempt.status === "incomplete"
            ? "stopped"
            : this.stepStatus(op, attempt.status);
      }),
    };
    this.background.set(op.id, entry);
    this.say(`${op.id}: started in the background`);
  }

  private async runAwait(op: HilOperation, result: HilStepResult): Promise<void> {
    const target = (op.params as HilAwaitParams).step;
    const entry = this.background.get(target);
    const attempt = this.newAttempt(1, 1);
    result.attempts.push(attempt);
    if (!entry) {
      // The background step never started (its start failed): nothing to wait for.
      const started = this.steps.find((step) => step.id === target);
      attempt.status = "error";
      attempt.problem = "not-started";
      result.status = this.stepStatus(op, started?.status === "blocked" ? "blocked" : "error");
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      entry.ended.then(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(true), Math.min(op.timeout * 1000, this.remainingMs()));
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) {
      this.event("background-stop", { step: target, reason: "await-timeout" });
      await entry.run.stop();
      await entry.ended;
      attempt.problem = "await-timeout";
    }
    this.background.delete(target);
    attempt.status = timedOut ? "incomplete" : entry.attempt.status;
    if (timedOut) entry.result.status = this.stepStatus(entry.op, "incomplete");
    attempt.exitCode = entry.attempt.exitCode;
    attempt.endT = this.t();
    attempt.endedAt = this.deps.now().toISOString();
    result.status = this.stepStatus(op, attempt.status);
    this.event("step-end", { step: op.id, status: attempt.status, awaited: target });
    this.say(`${op.id} (await ${target}): ${attempt.status}`);
  }

  /** Background steps still running after the steps: stopped by the plan (their own grace and cleanup). */
  private async endBackground(): Promise<void> {
    for (const entry of this.background.values()) {
      entry.stoppedByPlan = true;
      this.event("background-stop", { step: entry.op.id, reason: "end-of-steps" });
      await entry.run.stop();
      await entry.ended;
    }
    this.background.clear();
  }

  private async runCleanup(): Promise<void> {
    for (const [index, op] of this.compiled.cleanup.entries()) {
      const result = this.cleanup[index] as HilStepResult;
      const attempt = this.newAttempt(1, 1);
      result.attempts.push(attempt);
      try {
        const before = await this.prepareAttempt(op);
        this.event("step-start", { step: op.id, cleanup: true, handoff: this.handoff(op) });
        const run = await this.launch(op, attempt, false, op.timeout * 1000);
        if (run) await this.finishAttempt(op, attempt, await run.done, before);
      } catch (error) {
        // One failed cleanup step never keeps the next ones from running.
        attempt.status = "error";
        attempt.problem = "internal";
        this.problems.push({ code: "internal", step: op.id, message: (error as Error).message });
      }
      result.status = attempt.status;
      await this.write().catch(() => {});
    }
  }

  private physicalState(): PhysicalState {
    const attempts = [...this.steps, ...this.cleanup].flatMap((step) => step.attempts);
    const cleanupPassed = this.cleanup.length > 0 && this.cleanup.every((step) => step.status === "pass");
    if (
      attempts.some((attempt) => attempt.physical === "unknown") ||
      this.cleanup.some((step) => step.status !== "pass") ||
      (this.compiled.plan.setup.firmwareEffect === "irreversible" && this.firmwareStarted && !cleanupPassed)
    )
      return "unknown";
    return cleanupPassed ? "confirmed" : "unchanged";
  }

  private verdict(): HilStatus {
    const statuses = this.steps.map((step) => step.status);
    if (statuses.includes("blocked")) return "blocked";
    if (statuses.includes("error") || this.problems.some((problem) => problem.code === "internal"))
      return "error";
    if (statuses.includes("fail")) return "fail";
    const tests = this.steps.filter((step) => step.phase === "test" && step.status !== "stopped");
    if (this.stopReason || tests.length === 0 || tests.some((step) => step.status !== "pass"))
      return "incomplete";
    if (this.steps.some((step) => step.status !== "pass" && step.status !== "stopped")) return "incomplete";
    return "pass";
  }

  private async writeRequest(op: HilOperation): Promise<void> {
    const request = structuredClone((op.params as { request: Record<string, unknown> }).request);
    const sources = request.sources as Record<string, Record<string, unknown>>;
    for (const [id, source] of Object.entries(sources)) {
      const step = op.sources?.[id];
      if (step !== undefined) {
        const folder = this.captures.get(step);
        delete source.step;
        // A capture that never passed leaves the source unresolvable: lab-validate refuses it (exit 2).
        source.path = folder ?? `${this.folder}/steps/${step}/missing-capture`;
      } else if (op.sourceHashes?.[id]) source.sha256 = op.sourceHashes[id];
    }
    await writeFile(join(this.deps.workbench, `${op.folder}.request.json`), JSON.stringify(request, null, 1));
  }

  private async copyLog(
    op: HilOperation,
    attempt: HilAttempt,
    result: RunResult,
  ): Promise<string | undefined> {
    const name = `steps/${op.id}-${attempt.repetition}-${attempt.attempt}.log`;
    try {
      const source = await open(join(this.deps.workbench, result.log), "r");
      try {
        const size = (await source.stat()).size;
        const length = Math.min(size, STEP_LOG_BYTES);
        const buffer = Buffer.alloc(length);
        await source.read(buffer, 0, length, size - length);
        await writeFile(join(this.absolute, name), buffer, { flag: "wx" });
      } finally {
        await source.close();
      }
      return `${this.folder}/${name}`;
    } catch {
      return undefined;
    }
  }

  private async deviceTimes(folder: string): Promise<{ started?: string; ended?: string } | undefined> {
    try {
      const path = join(this.deps.workbench, folder, "result.json");
      if ((await stat(path)).size > 4 * 1024 * 1024) return undefined;
      const value = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      const pick = (key: string) => (typeof value[key] === "string" ? { [key]: value[key] as string } : {});
      const times = { ...pick("started"), ...pick("ended") };
      return Object.keys(times).length > 0 ? times : undefined;
    } catch {
      return undefined;
    }
  }

  private async listArtifacts(): Promise<{ path: string; sha256: string; bytes: number }[]> {
    const found: { path: string; sha256: string; bytes: number }[] = [];
    const walk = async (relative: string) => {
      for (const entry of await readdir(join(this.absolute, relative), { withFileTypes: true })) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && path !== "result.json" && found.length < 2000) {
          found.push({ path: `${this.folder}/${path}`, ...(await hashStream(join(this.absolute, path))) });
        }
      }
    };
    await walk("").catch(() => {});
    return found;
  }

  private async runReport(): Promise<string> {
    try {
      const run = await this.deps.start(this.compiled.report, {
        background: false,
        timeoutMs: REPORT_TIMEOUT_MS,
        parent: this.hold.id,
      });
      const done = await run.done;
      return done.exitCode === 0
        ? `; report: ${this.folder}/report.html`
        : `; the report failed (exit ${done.exitCode})`;
    } catch (error) {
      return `; the report did not start: ${error instanceof Error ? error.message : "refused"}`;
    }
  }

  /** The result document (spec REQ-DATA-5f714098 §7), replaced atomically. */
  private async write(): Promise<void> {
    const { plan } = this.compiled;
    const document = {
      format: 1,
      kind: "hil-test-result",
      tool: { name: "vera-hil", version: HIL_TOOL_VERSION },
      runId: this.compiled.runId,
      plan: {
        id: plan.id,
        title: plan.title,
        path: this.compiled.planPath,
        sha256: this.compiled.planSha256,
      },
      setup: plan.setup,
      firmware: this.compiled.firmware,
      risk: this.compiled.risk,
      state: this.state,
      status: this.status ?? "running",
      states: this.states,
      started: this.startedAt,
      ...(this.endedAt ? { ended: this.endedAt } : {}),
      budget: {
        seconds: plan.budget.seconds,
        usedMs: this.runningT ? Math.round(this.deps.monotonic() - this.runningT) : 0,
      },
      physical: this.phase === "done" ? this.physical : null,
      resources: this.compiled.claims.map((claim) => ({
        kind: claim.kind,
        name: claim.alias,
        keys: claim.keys,
      })),
      steps: this.steps,
      cleanup: this.cleanup,
      problems: this.problems,
      artifacts: this.artifacts,
      correlation:
        "Times t are milliseconds on VERA's monotonic clock since compilation; an event inside a step is known only within that attempt's [startT, endT] window. Instrument and target clocks are not synchronized with the host clock; deviceTimes are copied from the step's own result.",
    };
    const path = join(this.absolute, "result.json");
    const temporary = `${path}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 1)}\n`);
      await rename(temporary, path);
    } catch {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}
