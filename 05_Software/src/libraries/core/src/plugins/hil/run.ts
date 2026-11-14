import { performance } from "node:perf_hooks";
import { type PermissionMode, programPolicy, veraError } from "@vera/shared";
import { monotonicFactory } from "ulid";
import type { PreparedChange } from "../../tools/changes.js";
import type { ToolContext } from "../../tools/context.js";
import type { ProgramChangeRequest } from "../program-request.js";
import type { PreparedCall, ProgramContext, startCall } from "../program-tools.js";
import type { RunResult } from "../runner.js";
import { type CompiledHilPlan, compileHilPlan, HilPlanError, hilExpansion, hilRequest } from "./compile.js";
import { HilExecution } from "./executor.js";

const nextRunId = monotonicFactory();

/** What program-tools hands over for a `hil check|run` call (spec REQ-DATA-5f714098 §1). */
export interface HilCallInput {
  readonly ctx: ToolContext;
  readonly programs: ProgramContext;
  readonly args: {
    program: string;
    args?: string[] | undefined;
    cwd?: string | undefined;
    timeout?: number | undefined;
    background?: boolean | undefined;
  };
  /** The prepared `hil check|run` call itself. */
  readonly first: PreparedCall;
  readonly mode: PermissionMode;
  readonly consume: (request: ProgramChangeRequest) => void;
  readonly signal: AbortSignal;
  readonly refusal: (request: ProgramChangeRequest, mode: string) => Error;
  readonly foreground: (result: RunResult, risk: string) => Record<string, unknown>;
  readonly prepareCall: (
    ctx: ToolContext,
    programs: ProgramContext,
    args: { program: string; args?: string[] | undefined },
    signal: AbortSignal,
  ) => Promise<PreparedCall>;
  readonly startCall: typeof startCall;
  readonly timeoutCap: (call: PreparedCall) => number;
  readonly programError: (error: unknown, program?: string) => Error;
}

const usage =
  "Use hil check <plan> or hil run <plan>: one workbench-relative plan file, from the workbench root.";

/** `hil check` compiles and prints the expansion; `hil run` asks one approval for it and runs it in VERA. */
export async function prepareHilCall(input: HilCallInput): Promise<PreparedChange> {
  const { ctx, programs, args, first, mode, consume } = input;
  const argv = args.args ?? [];
  if (argv.length !== 2 || (args.cwd !== undefined && args.cwd !== ".")) throw Error(usage);
  if (args.timeout !== undefined)
    throw Error("A plan's budget limits its time; run_program's timeout is refused for hil run and check.");
  const planArg = argv[1] as string;
  const runId = nextRunId();
  const origin = performance.now();
  const preparedAt = new Date().toISOString();
  const compile = (own: PreparedCall, signal: AbortSignal): Promise<CompiledHilPlan> =>
    compileHilPlan({
      workbench: ctx.root,
      own,
      planArg,
      runId,
      prepare: (program, programArgs) =>
        input.prepareCall(ctx, programs, { program, args: programArgs }, signal),
      cap: input.timeoutCap,
      signal,
    });
  const again = async (signal: AbortSignal) => {
    const current = await input.prepareCall(ctx, programs, args, signal);
    return { current, compiled: await compile(current, signal) };
  };

  if (argv[0] === "check") {
    if (programPolicy(mode, first.prepared.risk, first.prepared.trial) === "refuse")
      throw input.refusal(first.prepared, mode);
    let used = false;
    return Object.freeze({
      request: first.prepared,
      async apply(applySignal: AbortSignal): Promise<Record<string, unknown>> {
        if (used) throw Error("This prepared program run was already used.");
        used = true;
        const current = await input.prepareCall(ctx, programs, args, applySignal);
        try {
          consume(current.prepared);
        } catch (error) {
          throw input.programError(error, args.program);
        }
        const started = performance.now();
        let output: Record<string, unknown>;
        let exitCode = 0;
        try {
          output = hilExpansion(await compile(current, applySignal));
        } catch (error) {
          if ((error as Error | undefined)?.name === "AbortError") throw error;
          exitCode = 2;
          const problems =
            error instanceof HilPlanError
              ? error.problems
              : [{ path: "", message: (error as Error).message }];
          output = { format: 1, kind: "hil-plan-check", valid: false, problems };
        }
        return {
          exitCode,
          durationMs: Math.round(performance.now() - started),
          risk: current.prepared.risk,
          output: JSON.stringify(output, null, 1),
          truncated: false,
        };
      },
    });
  }

  let compiled: CompiledHilPlan;
  try {
    compiled = await compile(first, input.signal);
  } catch (error) {
    if (error instanceof HilPlanError)
      throw Error(`The plan is refused before any approval: ${error.message}`);
    throw error;
  }
  const request = hilRequest(first.prepared, compiled);
  if (programPolicy(mode, request.risk, request.trial) === "refuse") throw input.refusal(request, mode);
  const askedT = Math.round((performance.now() - origin) * 1000) / 1000;
  const askedAt = new Date().toISOString();
  let used = false;
  return Object.freeze({
    request,
    async apply(applySignal: AbortSignal): Promise<Record<string, unknown>> {
      if (used) throw Error("This prepared program run was already used.");
      used = true;
      // The approval covers the plan as compiled then; anything changed since is CONFLICT and nothing runs.
      let current: Awaited<ReturnType<typeof again>>;
      try {
        current = await again(applySignal);
      } catch (error) {
        if (error instanceof HilPlanError) throw input.programError(veraError("CONFLICT"), args.program);
        throw error;
      }
      try {
        consume(hilRequest(current.current.prepared, current.compiled));
      } catch (error) {
        throw input.programError(error, args.program);
      }
      const background = args.background === true;
      const execution = new HilExecution(current.compiled, {
        workbench: ctx.root,
        sessionId: programs.sessionId,
        runner: programs.host.runner,
        start: (call, options) =>
          input.startCall(ctx, programs, call, {
            background: options.background,
            timeoutMs: options.timeoutMs,
            parent: options.parent,
            check: options.check,
          }),
        now: () => new Date(),
        monotonic: () => performance.now(),
        origin,
        preparedAt,
        askedAt,
        askedT,
      });
      try {
        execution.hold = await programs.host.runner.hold({
          sessionId: programs.sessionId,
          workbench: ctx.root,
          background,
          claims: current.compiled.claims,
          label: { plugin: current.current.plugin.manifest.id, program: args.program, args: argv },
          onStop: () => execution.stop("stopped"),
        });
      } catch (error) {
        throw input.programError(error, args.program);
      }
      if (!background) {
        applySignal.addEventListener("abort", () => execution.stop("stopped"), { once: true });
        // An abort while the hold was being created has already fired.
        if (applySignal.aborted) execution.stop("stopped");
      }
      void execution.run();
      const folder = `embedded-lab-results/${runId}`;
      const risk = current.compiled.risk;
      if (background) {
        programs.session.add(execution.hold);
        return {
          handle: execution.hold.id,
          risk,
          log: `.vera/runs/${execution.hold.id}.log`,
          result: folder,
        };
      }
      return { ...input.foreground(await execution.hold.done, risk), result: folder };
    },
  });
}
