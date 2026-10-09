// Demo replay provider (04 §8): a scripted model. Tools still execute for real, so the UI shows real data.
// Fixture = apps/server/fixtures/replay/<scenario>.jsonl, one line per model step:
//   {"match": "(?i)performance", "prompt": "…", "text": "…", "toolCalls": [{"name": "load_skill", "args": {…}}]}
// `match` (first line only) selects the scenario from the user prompt; `prompt` (first line, optional) is what
// `bench chat --script` sends. Args and text may hold placeholders resolved from earlier tool results:
// {{plan_id}}, {{report_id}}, {{test_run:TC-PERF-003}}, {{fw}}.
// The step is derived from the transcript (assistant messages since the last user message), so replay is stateless.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import type { ConnectionResult, LlmEvent, LlmGateway, LlmStreamRequest } from "./gateway.ts";

export interface ReplayStep {
  match?: string;
  prompt?: string;
  text?: string;
  toolCalls?: { name: string; args: Record<string, unknown> }[];
  /**
   * Verdicts the scripted text assumes, e.g. {"TC-PERF-003": "pass"}. When the real run disagrees (demo prompts
   * asked out of order consume different datasets), replay answers with a factual summary of the run instead —
   * scripted text must never contradict an evaluator verdict.
   */
  expect?: Record<string, string>;
}

export interface ReplayScenario {
  name: string;
  match: RegExp | null;
  prompt: string | null;
  steps: ReplayStep[];
}

export const NO_SCRIPT = "No scripted response for this prompt (demo replay mode).";
export const REJECTED = "Understood, nothing will run. Tell me what to change, for example a different firmware or fewer tests.";

/** `(?i)` prefix (as in 04 §8) → JS `i` flag. */
export function parseMatch(src: string): RegExp {
  const m = /^\(\?([a-z]+)\)/.exec(src);
  return m ? new RegExp(src.slice(m[0].length), m[1]!.replace(/[^imsu]/g, "")) : new RegExp(src);
}

export function parseScenario(name: string, jsonl: string): ReplayScenario {
  const steps = jsonl
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith("//"))
    .map((l, i) => {
      try {
        return JSON.parse(l) as ReplayStep;
      } catch (err) {
        throw new Error(`${name}.jsonl line ${i + 1}: ${(err as Error).message}`);
      }
    });
  if (!steps.length) throw new Error(`${name}.jsonl has no steps`);
  return { name, match: steps[0]!.match ? parseMatch(steps[0]!.match) : null, prompt: steps[0]!.prompt ?? null, steps };
}

export function loadScenarios(dir: string): ReplayScenario[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => parseScenario(path.basename(f, ".jsonl"), readFileSync(path.join(dir, f), "utf8")));
}

// ---------------------------------------------------------------- placeholders

const textOf = (m: Message): string =>
  m.role === "toolResult" ? m.content.map((c) => (c.type === "text" ? c.text : "")).join("") : typeof m.content === "string" ? m.content : "";

function jsonOf(m: Message): Record<string, unknown> | null {
  try {
    const v = JSON.parse(textOf(m)) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Values the transcript already established, newest last: plan/report/test-run ids and firmware. */
export function transcriptBindings(messages: Message[]): Map<string, string> {
  const b = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "toolResult" || m.isError) continue;
    const r = jsonOf(m);
    if (!r) continue;
    if (m.toolName === "propose_test_plan") {
      if (typeof r.plan_id === "string") b.set("plan_id", r.plan_id);
      if (typeof r.fw === "string") b.set("fw", r.fw);
    }
    if (m.toolName === "run_test_plan" && typeof r.report_id === "string") {
      b.set("report_id", r.report_id);
      for (const x of (r.results as { test_run_id: string; test_id: string; verdict: string }[] | undefined) ?? []) {
        b.set(`test_run:${x.test_id}`, x.test_run_id);
        b.set(`verdict:${x.test_id}`, x.verdict);
      }
    }
  }
  return b;
}

/** Looks up a placeholder the transcript doesn't bind (e.g. prompt 2 in a fresh session): agent-provided. */
export type ReplayFallback = (key: string, ctx: { userText: string; bindings: Map<string, string> }) => string | undefined;

export function fillPlaceholders<T>(value: T, lookup: (key: string) => string | undefined): T {
  const fill = (s: string) => s.replace(/\{\{([a-z_]+(?::[A-Z0-9-]+)?)\}\}/g, (whole, key: string) => lookup(key) ?? whole);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return fill(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

export const OFF_SCRIPT = "These results differ from the scripted demo (demo replay mode), so I stop here. Ask me to analyse the report.";

/** Factual summary of the turn's last run_test_plan result (verdicts and failing checks, with check refs). */
export function runSummary(turn: Message[]): string {
  const last = [...turn].reverse().find((m) => m.role === "toolResult" && m.toolName === "run_test_plan" && !m.isError);
  const r = last ? jsonOf(last) : null;
  if (!r) return OFF_SCRIPT;
  const results = (r.results as { test_run_id: string; test_id: string; verdict: string; failing_checks: { id: string; measured: string; expected: string }[] }[]) ?? [];
  const passed = results.filter((x) => x.verdict === "pass").length;
  const rows = results.map(
    (x) =>
      `| ${x.test_id} | ${x.verdict.toUpperCase()} | ${x.failing_checks.map((c) => `${c.id}: ${c.measured} (expected ${c.expected}) [[ev:${x.test_run_id}/check/${c.id}]]`).join("; ") || "—"} |`,
  );
  return [`Run finished (${String(r.report_id)}): **${passed} passed, ${results.length - passed} failed.**`, "", "| Test | Verdict | Failing checks |", "|---|---|---|", ...rows, "", OFF_SCRIPT].join("\n");
}

// ---------------------------------------------------------------- provider

export interface ReplayOptions {
  dir: string;
  /** Delay between ~40-char chunks (04 §8: 50 ms). 0 in tests. */
  chunkDelayMs?: number;
  fallback?: ReplayFallback;
}

const CHUNK = 40;

function lastUserIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === "user") return i;
  return -1;
}

function message(model: string, text: string, toolCalls: ToolCall[]): AssistantMessage {
  return {
    role: "assistant",
    content: [...(text ? [{ type: "text" as const, text }] : []), ...toolCalls],
    api: "replay",
    provider: "replay",
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: toolCalls.length ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

export class ReplayGateway implements LlmGateway {
  constructor(private readonly opts: ReplayOptions) {}

  scenarios(): ReplayScenario[] {
    return loadScenarios(this.opts.dir);
  }

  /** `model` = scenario name forces that fixture (CLI --script); `replay` / `auto` matches on the prompt. */
  pick(model: string, userText: string): ReplayScenario | null {
    const all = this.scenarios();
    const forced = all.find((s) => s.name === model);
    if (forced) return forced;
    return all.find((s) => s.match?.test(userText)) ?? null;
  }

  async *stream(req: LlmStreamRequest): AsyncIterable<LlmEvent> {
    const at = lastUserIndex(req.messages);
    const user = at >= 0 ? req.messages[at]! : null;
    const userText = user ? textOf(user) : "";
    const since = req.messages.slice(at + 1);
    const stepNo = since.filter((m) => m.role === "assistant").length;
    const scenario = this.pick(req.model.model, userText);
    const bindings = transcriptBindings(req.messages);

    let text: string;
    let calls: ToolCall[] = [];
    const lastResult = [...since].reverse().find((m) => m.role === "toolResult");
    if (!scenario) text = stepNo === 0 ? NO_SCRIPT : "";
    else if (lastResult?.role === "toolResult" && lastResult.toolName === "propose_test_plan" && jsonOf(lastResult)?.decision === "reject") {
      const comment = jsonOf(lastResult)?.comment;
      text = typeof comment === "string" && comment ? `${REJECTED} Noted: “${comment}”.` : REJECTED;
    } else {
      const step = scenario.steps[stepNo];
      const mismatch = step?.expect && Object.entries(step.expect).some(([test, verdict]) => bindings.get(`verdict:${test}`) !== verdict);
      if (mismatch) text = runSummary(since);
      else {
        const lookup = (key: string) => bindings.get(key) ?? this.opts.fallback?.(key, { userText, bindings });
        const filled = step ? fillPlaceholders(step, lookup) : { text: "" };
        text = filled.text ?? "";
        calls = (filled.toolCalls ?? []).map((c) => ({ type: "toolCall" as const, id: `rp_${randomUUID().slice(0, 12)}`, name: c.name, arguments: c.args as ToolCall["arguments"] }));
      }
    }

    const delay = this.opts.chunkDelayMs ?? 50;
    for (let i = 0; i < text.length; i += CHUNK) {
      if (req.signal.aborted) {
        yield { type: "error", message: "aborted", aborted: true, partial: { ...message(req.model.model, text.slice(0, i), []), stopReason: "aborted" } };
        return;
      }
      yield { type: "text", delta: text.slice(i, i + CHUNK) };
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    if (req.signal.aborted) {
      yield { type: "error", message: "aborted", aborted: true, partial: { ...message(req.model.model, text, []), stopReason: "aborted" } };
      return;
    }
    yield { type: "done", message: message(scenario?.name ?? req.model.model, text, calls) };
  }

  async testConnection(): Promise<ConnectionResult> {
    try {
      const n = this.scenarios().length;
      return { ok: n > 0, detail: n > 0 ? `Demo replay ready · ${n} scripted scenarios` : "No replay fixtures found.", latencyMs: 0 };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}
