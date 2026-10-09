// Agent loop (04 §1): own loop on the LLM gateway — full control over approval pauses and UI events.
//   stream → text deltas (message.delta) → persist assistant → no tool calls: citations, message.done, turn ends
//   → tool calls: read-only ones in parallel, execution tools one at a time → tool results → next step
// At most 30 tool calls per turn. Abort via the turn's AbortController (POST /sessions/:id/stop).
import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type { StopReason } from "@benchpilot/shared";
import type { Db } from "../db/index.ts";
import { nextId } from "../db/repos/counters.ts";
import { appendMessage, finishToolCall, listMessages, startToolCall, type StoredMessage } from "../db/repos/sessions.ts";
import type { LlmGateway, ModelRef } from "../llm/gateway.ts";
import { executeTool, type ToolContext, type ToolRegistry } from "../tools/registry.ts";
import { validateCitations } from "./citations.ts";

export const MAX_TOOL_CALLS_PER_TURN = 30;

export interface TurnInput {
  db: Db;
  gateway: LlmGateway;
  registry: ToolRegistry;
  /** Tool context for this session/turn (signal, emit, approvals …). */
  tools: ToolContext;
  model: ModelRef;
  system: string;
}

const STOPPED = JSON.stringify({ error: "Not executed: the turn was stopped." });

function zeroUsage(): AssistantMessage["usage"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

const toolResult = (call: Pick<ToolCall, "id" | "name">, text: string, isError: boolean): ToolResultMessage =>
  ({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text }], isError, timestamp: Date.now() }) as ToolResultMessage;

/**
 * Persisted messages → a context every provider accepts: drops error markers, gives every tool call a result
 * (a stopped turn can leave calls unanswered) and puts an assistant reply between a trailing tool result and the
 * next user message.
 */
export function buildContext(stored: StoredMessage[]): Message[] {
  const msgs = stored.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as unknown as Message[];
  const out: Message[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!;
    const prev = out.at(-1);
    if (m.role === "user" && prev?.role === "toolResult") {
      const last = [...out].reverse().find((x): x is AssistantMessage => x.role === "assistant");
      out.push({
        role: "assistant",
        content: [{ type: "text", text: "(The previous turn was stopped before a reply.)" }],
        api: last?.api ?? "replay",
        provider: last?.provider ?? "replay",
        model: last?.model ?? "replay",
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: m.timestamp,
      });
    }
    out.push(m);
    if (m.role === "assistant") {
      const calls = m.content.filter((c): c is ToolCall => c.type === "toolCall");
      const answered = new Set<string>();
      for (let j = i + 1; j < msgs.length && msgs[j]!.role === "toolResult"; j++) answered.add((msgs[j] as ToolResultMessage).toolCallId);
      const missing = calls.filter((c) => !answered.has(c.id));
      if (missing.length) {
        // Results that exist come first (in order) from the stored list; add the missing ones after them.
        let j = i + 1;
        for (; j < msgs.length && msgs[j]!.role === "toolResult"; j++) out.push(msgs[j]!);
        for (const c of missing) out.push(toolResult(c, STOPPED, true));
        i = j - 1;
      }
    }
  }
  return out;
}

const isAbort = (err: unknown, signal: AbortSignal) => signal.aborted || (err as Error)?.name === "AbortError";

/** Runs one turn to completion. Emits message/tool events through `tools.emit`; returns the stop reason. */
export async function runTurn(t: TurnInput): Promise<StopReason> {
  const { db, tools: ctx } = t;
  const sessionId = ctx.sessionId;
  const signal = ctx.signal;
  let calls = 0;

  const persist = (m: Message) => appendMessage(db, sessionId, m as unknown as StoredMessage);

  for (;;) {
    if (signal.aborted) return "aborted";
    const messageId = nextId(db, "M");
    let streamed = "";
    let final: AssistantMessage | null = null;
    let failure: { message: string; aborted: boolean; partial?: AssistantMessage } | null = null;

    try {
      for await (const e of t.gateway.stream({ system: t.system, messages: buildContext(listMessages(db, sessionId)), tools: t.registry.specs(ctx.testbench), model: t.model, signal, sessionId })) {
        if (e.type === "text") {
          streamed += e.delta;
          ctx.emit({ type: "message.delta", messageId, text: e.delta });
        } else if (e.type === "done") final = e.message;
        else failure = e;
      }
    } catch (err) {
      failure = { message: (err as Error).message, aborted: isAbort(err, signal) };
    }
    if (!final && !failure) failure = { message: "The model stream ended without a response.", aborted: signal.aborted };

    const closeText = (text: string) => {
      if (!text) return;
      ctx.emit({ type: "message.done", messageId, citations: validateCitations(db, text) });
    };

    if (failure) {
      // Keep what the user already saw (text only: a half-streamed tool call never ran).
      const partialText = streamed || failure.partial?.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("") || "";
      if (partialText && failure.partial) persist({ ...failure.partial, content: [{ type: "text", text: partialText }] });
      closeText(streamed);
      if (failure.aborted || signal.aborted) return "aborted";
      appendMessage(db, sessionId, { role: "error", message: failure.message, timestamp: Date.now() });
      ctx.emit({ type: "error", message: failure.message });
      return "error";
    }

    const msg = final!;
    const text = msg.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
    if (text && !streamed) ctx.emit({ type: "message.delta", messageId, text });
    const messageRow = persist(msg);
    closeText(text);

    const toolCalls = msg.content.filter((c): c is ToolCall => c.type === "toolCall");
    if (!toolCalls.length) return "end";

    // Over the per-turn cap: the extra calls are answered with an error and the turn ends after this batch.
    const allowed = toolCalls.slice(0, Math.max(0, MAX_TOOL_CALLS_PER_TURN - calls));
    const refused = toolCalls.slice(allowed.length);
    const results = new Map<string, ToolResultMessage>();

    const runOne = async (call: ToolCall) => {
      ctx.emit({ type: "tool.started", callId: call.id, name: call.name, args: call.arguments as Record<string, unknown> });
      startToolCall(db, { id: call.id, sessionId, messageId: messageRow, name: call.name, args: call.arguments });
      const started = performance.now();
      const outcome = await executeTool(t.registry, ctx, call.name, call.arguments);
      const durationMs = Math.round(performance.now() - started);
      finishToolCall(db, call.id, outcome.ok, outcome.result);
      ctx.emit({ type: "tool.done", callId: call.id, ok: outcome.ok, summary: outcome.summary, durationMs, preview: outcome.preview });
      results.set(call.id, toolResult(call, outcome.text, !outcome.ok));
    };

    let stoppedInTools = false;
    try {
      // Read-only calls run in parallel; an execution tool (approval / run) runs alone, in order.
      let batch: ToolCall[] = [];
      const flush = async () => {
        if (batch.length) await Promise.all(batch.map(runOne));
        batch = [];
      };
      for (const call of allowed) {
        const def = t.registry.get(call.name);
        if (def?.group === "execution") {
          await flush();
          if (signal.aborted) break;
          await runOne(call);
        } else batch.push(call);
        if (signal.aborted) break;
      }
      await flush();
    } catch (err) {
      if (!isAbort(err, signal)) throw err;
      stoppedInTools = true;
    }

    for (const call of toolCalls) {
      let r = results.get(call.id);
      if (!r && refused.includes(call)) r = toolResult(call, JSON.stringify({ error: `Tool-call limit reached (${MAX_TOOL_CALLS_PER_TURN} per turn).` }), true);
      if (!r) {
        finishToolCall(db, call.id, false, { error: "stopped" }); // no-op when the call never started
        r = toolResult(call, STOPPED, true);
      }
      persist(r);
    }
    calls += allowed.length;
    if (stoppedInTools || signal.aborted) return "aborted";
    if (refused.length || calls >= MAX_TOOL_CALLS_PER_TURN) return "tool_cap";
  }
}
