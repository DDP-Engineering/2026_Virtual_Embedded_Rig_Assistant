// Tool registry (04 §3): zod schemas + metadata. The model sees JSON Schema converted from zod; arguments are
// validated with the same zod schema (defaults applied) before a tool runs. Guards live in the tools, server-side.
import type { SessionEvent, Skill, TestbenchConfig, ToolGroup, ToolMeta } from "@benchpilot/shared";
import { TOOL_NAMES, type ToolName } from "@benchpilot/shared/content";
import { z } from "zod";
import type { Catalog } from "../catalog/load.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import type { Pools } from "../db/repos/pools.ts";
import type { ToolSpec } from "../llm/gateway.ts";

/** 04 §1: results above this are cut and carry `truncated: true`. */
export const RESULT_CAP = 12_000;
/** 01: `tool.done.preview` excerpt. */
export const PREVIEW_CAP = 2_000;
/** 04 §1: row tools take `limit` ≤ 200. */
export const MAX_ROWS = 200;

/** What a pending propose_test_plan waits for (POST /plans/:id/decision, validated and enriched). */
export interface PlanDecisionResult {
  decision: "approve" | "reject";
  items: { testId: string; rationale: string }[];
  fw: string;
  comment?: string;
  edited: boolean;
}

export interface ApprovalWaiter {
  wait(planId: string, sessionId: string, signal: AbortSignal): Promise<PlanDecisionResult>;
}

export interface ToolContext {
  db: Db;
  config: Config;
  catalog: Catalog;
  skills: Skill[];
  pools: Pools;
  testbench: TestbenchConfig;
  sessionId: string;
  signal: AbortSignal;
  /** Session SSE events a tool causes (skill.loaded, plan.*, run.*). */
  emit(event: SessionEvent): void;
  approvals: ApprovalWaiter;
  /** Skills loaded in this session so far (attribution of saved analyses). */
  loadedSkills(): string[];
}

/** A tool-level error the model should read and correct (bad filter, unknown id, guard refusal). */
export interface ToolError {
  error: string;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: ToolName;
  group: ToolGroup;
  description: string;
  /** UI label in the Tools tab (shorter than the model-facing description). */
  label: string;
  requiresApproval: boolean;
  schema: S;
  run(args: z.output<S>, ctx: ToolContext): Promise<unknown>;
  /** One-line summary for `tool.done.summary`, e.g. "3 results". */
  summarize?(result: never): string;
}

export const defineTool = <S extends z.ZodType>(def: ToolDef<S>): ToolDef => def as unknown as ToolDef;

export const isToolError = (v: unknown): v is ToolError =>
  Boolean(v && typeof v === "object" && typeof (v as ToolError).error === "string" && Object.keys(v as object).length <= 2);

// ---------------------------------------------------------------- output cap

function largestArray(v: unknown, path: (string | number)[] = []): { path: (string | number)[]; len: number } | null {
  let best: { path: (string | number)[]; len: number } | null = null;
  if (Array.isArray(v)) {
    best = { path, len: v.length };
    v.forEach((x, i) => {
      const c = largestArray(x, [...path, i]);
      if (c && c.len > best!.len) best = c;
    });
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      const c = largestArray(x, [...path, k]);
      if (c && (!best || c.len > best.len)) best = c;
    }
  }
  return best;
}

function setAt(root: unknown, path: (string | number)[], value: unknown): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) return root.map((x, i) => (i === head ? setAt(x, rest, value) : x));
  const obj = root as Record<string, unknown>;
  return { ...obj, [head!]: setAt(obj[head as string], rest, value) };
}

const getAt = (root: unknown, path: (string | number)[]): unknown =>
  path.reduce<unknown>((v, k) => (v as Record<string | number, unknown>)?.[k], root);

/**
 * JSON text of a result, at most `cap` chars. Over the cap, the largest array is halved until it fits and the
 * result gains `truncated: true` and `omitted` (rows dropped); text results are cut with a marker.
 */
export function capResult(result: unknown, cap = RESULT_CAP): { text: string; truncated: boolean } {
  if (typeof result === "string") {
    if (result.length <= cap) return { text: result, truncated: false };
    const marker = `\n…[truncated: ${result.length - cap + 40} more chars]`;
    return { text: result.slice(0, cap - marker.length) + marker, truncated: true };
  }
  let value = result;
  let text = JSON.stringify(value);
  if (text.length <= cap) return { text, truncated: false };
  let omitted = 0;
  for (let guard = 0; guard < 40 && text.length > cap; guard++) {
    const arr = largestArray(value);
    if (!arr || arr.len <= 1) break;
    const keep = Math.floor(arr.len / 2);
    omitted += arr.len - keep;
    value = setAt(value, arr.path, (getAt(value, arr.path) as unknown[]).slice(0, keep));
    const wrapped = value && typeof value === "object" && !Array.isArray(value) ? { ...value, truncated: true, omitted } : { rows: value, truncated: true, omitted };
    text = JSON.stringify(wrapped);
  }
  if (text.length > cap) {
    const marker = `…[truncated]`;
    text = JSON.stringify({ truncated: true, text: text.slice(0, cap - 60) + marker });
  }
  return { text, truncated: true };
}

// ---------------------------------------------------------------- specs and execution

/** zod → JSON Schema (input side, so defaulted fields are optional for the model). */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return rest;
}

export class ToolRegistry {
  private readonly byName = new Map<string, ToolDef>();

  constructor(tools: ToolDef[]) {
    for (const t of tools) {
      if (!(TOOL_NAMES as readonly string[]).includes(t.name)) throw new Error(`tool ${t.name} is not in TOOL_NAMES`);
      this.byName.set(t.name, t);
    }
    const missing = TOOL_NAMES.filter((n) => !this.byName.has(n));
    if (missing.length) throw new Error(`tools not implemented: ${missing.join(", ")}`);
  }

  get(name: string): ToolDef | undefined {
    return this.byName.get(name);
  }

  all(): ToolDef[] {
    return TOOL_NAMES.map((n) => this.byName.get(n)!);
  }

  /** GET /tools */
  meta(): ToolMeta[] {
    return this.all().map((t) => ({ name: t.name, group: t.group, description: t.label, requiresApproval: t.requiresApproval }));
  }

  /** Tools the model may call on a testbench: its enabled tools, plus load_skill when ≥ 1 skill is enabled (04 §3). */
  enabledFor(tb: TestbenchConfig): ToolDef[] {
    return this.all().filter((t) => (t.name === "load_skill" ? tb.enabled_skills.length > 0 : tb.enabled_tools.includes(t.name)));
  }

  specs(tb: TestbenchConfig): ToolSpec[] {
    return this.enabledFor(tb).map((t) => ({ name: t.name, description: t.description, parameters: jsonSchemaOf(t.schema) }));
  }
}

export interface ToolOutcome {
  ok: boolean;
  /** Text sent back to the model (≤ RESULT_CAP). */
  text: string;
  /** Parsed result as stored in tool_calls.result_json. */
  result: unknown;
  summary: string;
  preview: string;
  truncated: boolean;
}

const zodIssues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

/** Validates and runs one call. Never throws for tool-level problems; abort errors propagate. */
export async function executeTool(reg: ToolRegistry, ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  const tool = reg.get(name);
  const enabled = tool && reg.enabledFor(ctx.testbench).includes(tool);
  let result: unknown;
  if (!tool || !enabled) result = { error: `Tool ${name} is not available on testbench ${ctx.testbench.id}.` };
  else {
    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) result = { error: `Invalid arguments for ${name}: ${zodIssues(parsed.error)}` };
    else {
      try {
        result = await tool.run(parsed.data, ctx);
      } catch (err) {
        if (ctx.signal.aborted) throw err;
        result = { error: (err as Error).message };
      }
    }
  }
  const ok = !isToolError(result);
  const { text, truncated } = capResult(result);
  let summary: string;
  try {
    summary = !ok ? `error: ${(result as ToolError).error}`.slice(0, 120) : (tool?.summarize?.(result as never) ?? "done");
  } catch {
    summary = "done";
  }
  return { ok, text, result, summary: truncated ? `${summary} (truncated)` : summary, preview: text.slice(0, PREVIEW_CAP), truncated };
}

// ---------------------------------------------------------------- shared arg helpers

export const limitArg = (def: number) => z.number().int().min(1).max(MAX_ROWS).default(def);
export const runIdArg = z.string().regex(/^RUN-\d{4}$/, "a test run id like RUN-0042");
export const reportIdArg = z.string().regex(/^RPT-\d{4}$/, "a report id like RPT-0009");
/** Time arguments: epoch seconds, ISO-8601, `HH:MM[:SS]` (UTC, on the run's data-clock day) or `t+<seconds>`. */
export const timeArg = z.union([z.number(), z.string().max(40)]);
