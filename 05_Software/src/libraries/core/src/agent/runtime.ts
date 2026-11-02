// Derived from BenchPilot's gateway loop: contiguous parallel reads, ordered writes and source-order results.
import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { veraError } from "@vera/shared";
import { ContextCompactor } from "./compaction.js";
import { toolSpecs } from "./tool.js";
import type { AgentRuntime, RuntimeEvent, RuntimeHost, RuntimeInit, StopReason } from "./types.js";

export function zeroUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
export function toolResult(
  call: ToolCall,
  text: string,
  isError: boolean,
  timestamp: number,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: call.id,
    toolName: call.name,
    content: [{ type: "text", text }],
    isError,
    timestamp,
  };
}
/** Interrupted calls are repaired only in the request view; persisted messages remain verbatim. */
export function buildContext(stored: Message[], _now: number, currentStart = stored.length): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < stored.length; i++) {
    const m = stored[i];
    if (!m) continue;
    if (i < currentStart && m.role === "user" && out.at(-1)?.role === "toolResult") {
      const last = out.findLast((x): x is AssistantMessage => x.role === "assistant");
      out.push({
        role: "assistant",
        content: [{ type: "text", text: "(Previous turn interrupted before reply.)" }],
        api: last?.api ?? "replay",
        provider: last?.provider ?? "replay",
        model: last?.model ?? "replay",
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: m.timestamp,
      });
    }
    out.push(structuredClone(m));
    if (m.role !== "assistant") continue;
    const calls = m.content.filter((c): c is ToolCall => c.type === "toolCall");
    const answered = new Set<string>();
    while (stored[i + 1]?.role === "toolResult") {
      const result = stored[++i] as ToolResultMessage;
      answered.add(result.toolCallId);
      out.push(structuredClone(result));
    }
    for (const call of calls)
      if (!answered.has(call.id))
        // Stable derived repairs keep unchanged history reusable by the compaction cache.
        out.push(toolResult(call, "Interrupted: call outcome unresolved.", true, m.timestamp));
  }
  return out;
}
export class ReferenceRuntime implements AgentRuntime {
  private init: RuntimeInit | undefined;
  private transcript: Message[] = [];
  private controller: AbortController | undefined;
  private compactor = new ContextCompactor();
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  constructor(private readonly host: RuntimeHost) {}
  start(init: RuntimeInit): void {
    if (this.controller) throw veraError("BUSY");
    toolSpecs(init.tools); // Fail unsupported schemas before accepting state.
    if (
      init.maxToolCallsPerTurn !== undefined &&
      (!Number.isSafeInteger(init.maxToolCallsPerTurn) || init.maxToolCallsPerTurn <= 0)
    )
      throw veraError("INVALID");
    this.init = { ...init, tools: [...init.tools] };
    this.compactor = init.contextCompactor ?? new ContextCompactor();
    this.transcript = structuredClone(init.messages);
  }
  messages(): Message[] {
    return structuredClone(this.transcript);
  }
  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(event));
      } catch {
        /* An observer cannot strand a running turn. */
      }
    }
  }
  abort(): void {
    this.controller?.abort();
  }
  async send(text: string): Promise<{ stopReason: StopReason }> {
    if (this.controller) throw veraError("BUSY");
    const init = this.init;
    if (!init) throw veraError("INVALID");
    const controller = new AbortController();
    this.controller = controller;
    const turnId = this.host.nextId();
    const messageId = this.host.nextId();
    const currentStart = this.transcript.length;
    const recovered = new Set(this.host.steering?.().map((message) => message.messageId));
    this.transcript.push({ role: "user", content: text, timestamp: this.host.now() });
    this.emit({ type: "message.user", messageId, text });
    this.emit({ type: "turn.started", turnId });
    let stopReason: StopReason = "error";
    try {
      stopReason = await this.run(init, controller.signal, currentStart, recovered, messageId);
    } catch (error) {
      stopReason = controller.signal.aborted ? "aborted" : "error";
      if (stopReason === "error")
        this.emit({ type: "error", code: "INTERNAL", messageKey: "error.internal", retryable: false });
      void error;
    } finally {
      this.emit({ type: "turn.done", turnId, stopReason });
      this.controller = undefined;
    }
    return { stopReason };
  }
  private async run(
    init: RuntimeInit,
    signal: AbortSignal,
    currentStart: number,
    recovered: Set<string>,
    initialPromptId: string,
  ): Promise<StopReason> {
    let callsUsed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let promptIds = [initialPromptId];
    let firstRequest = true;
    const addUsage = (message: AssistantMessage) => {
      inputTokens += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
      outputTokens += message.usage.output;
    };
    const delivered = new Set<string>();
    const recoveredPositions = new Set<number>();
    const pending = () =>
      (this.host.steering?.() ?? []).filter((message) => !delivered.has(message.messageId));
    const userMessage = (message: { text: string; timestamp: number }): Message => ({
      role: "user",
      content: message.text,
      timestamp: message.timestamp,
    });
    for (;;) {
      if (signal.aborted) return "aborted";
      const tools = toolSpecs(init.tools);
      await this.host.gateway.prepareModel?.(init.model, signal);
      signal.throwIfAborted();
      const capabilities = this.host.gateway.capabilities(init.model);
      let queued = pending();
      // Recovered queue precedes the new instruction in the provider view. The full
      // durable transcript retains its original event/message arrival records.
      const prior = queued.filter((message) => recovered.has(message.messageId));
      const requestMessages = [
        ...this.transcript.slice(0, currentStart),
        ...this.transcript.filter((_, index) => recoveredPositions.has(index)),
        ...prior.map(userMessage),
        ...this.transcript.filter((_, index) => index >= currentStart && !recoveredPositions.has(index)),
        ...queued.filter((message) => !recovered.has(message.messageId)).map(userMessage),
      ];
      const historicalEnd = buildContext(this.transcript.slice(0, currentStart), this.host.now()).length;
      const compacted = await this.compactor.prepare(
        {
          system: init.systemPrompt,
          tools,
          messages: buildContext(requestMessages, this.host.now(), currentStart),
        },
        capabilities,
        init.contextPolicy,
        async (input, summaryView) => {
          const { messages: summaryMessages, fits: _, ...summaryBudget } = summaryView;
          this.emit({
            type: "usage.updated",
            inputTokens,
            outputTokens,
            ...summaryBudget,
            compactionStatus: "running",
            requestViewTokens: summaryView.contextTokens,
          });
          signal.throwIfAborted();
          let summary: AssistantMessage | undefined;
          try {
            for await (const event of this.host.gateway.stream({
              model: init.model,
              system: input.system,
              tools: input.tools,
              messages: summaryMessages,
              signal,
              maxOutputTokens: summaryView.reservedOutputTokens,
            })) {
              if (event.type === "error") {
                summary = event.partial ?? summary;
                return undefined;
              }
              if (event.type === "done") summary = event.message;
            }
            return summary;
          } finally {
            if (summary) addUsage(summary);
          }
        },
        historicalEnd,
      );
      // Messages admitted during an awaited historical summary join the next normal
      // request too. Recheck M1 once, without another compaction attempt.
      const included = new Set(queued.map((message) => message.messageId));
      const arrivals = pending().filter((message) => !included.has(message.messageId));
      queued = [...queued, ...arrivals];
      // The summary is itself a model dispatch; resolve capabilities again for the normal call.
      const view = {
        ...init.contextPolicy.prepare(
          {
            system: init.systemPrompt,
            tools,
            messages: [...compacted.messages, ...arrivals.map(userMessage)],
          },
          this.host.gateway.capabilities(init.model),
        ),
        compactionStatus: compacted.compactionStatus,
        requestViewTokens: 0,
      };
      view.requestViewTokens = view.contextTokens;
      const { messages, fits, ...budget } = view;
      if (signal.aborted || !fits)
        this.emit({ type: "usage.updated", inputTokens, outputTokens, ...budget, promptIds });
      if (signal.aborted) return "aborted";
      if (!fits) {
        this.emit({
          type: "error",
          code: "CONTEXT_LIMIT",
          messageKey: "context.budget_exceeded",
          retryable: false,
        });
        return "limit";
      }
      if (queued.length) {
        for (const [index, message] of queued.entries())
          if (recovered.has(message.messageId)) recoveredPositions.add(this.transcript.length + index);
        this.transcript.push(...queued.map(userMessage));
        for (const message of queued) delivered.add(message.messageId);
        // One durable transition persists the entire admitted batch and its markers.
        this.emit({ type: "message.delivered", messageIds: queued.map((message) => message.messageId) });
        promptIds = [
          ...(firstRequest ? [initialPromptId] : []),
          ...queued.map((message) => message.messageId),
        ];
      }
      firstRequest = false;
      this.emit({ type: "usage.updated", inputTokens, outputTokens, ...budget, promptIds });
      const messageId = this.host.nextId();
      let final: AssistantMessage | undefined;
      let usageRecorded = false;
      const reportUsage = (message: AssistantMessage | undefined) => {
        if (!message || usageRecorded) return;
        usageRecorded = true;
        addUsage(message);
        this.emit({ type: "usage.updated", inputTokens, outputTokens, promptIds });
      };
      let streamed = "";
      const retainPartial = (partial?: AssistantMessage) => {
        if (!streamed) return;
        const message: AssistantMessage = {
          ...(partial
            ? structuredClone(partial)
            : {
                role: "assistant",
                api: "runtime-partial",
                provider: init.model.split("/")[0] ?? "unknown",
                model: init.model,
                usage: zeroUsage(),
                timestamp: this.host.now(),
                stopReason: signal.aborted ? "aborted" : "error",
              }),
          content: [{ type: "text", text: streamed }],
        };
        this.transcript.push(message);
        this.emit({ type: "message.done", messageId, text: streamed, message });
      };
      try {
        for await (const event of this.host.gateway.stream({
          model: init.model,
          system: init.systemPrompt,
          tools,
          messages,
          signal,
          maxOutputTokens: view.reservedOutputTokens,
        })) {
          if (event.type === "text") {
            streamed += event.delta;
            this.emit({ type: "message.delta", messageId, text: event.delta });
          } else if (event.type === "tool")
            this.emit({ type: "tool.delta", messageId, index: event.index, text: event.delta });
          else if (event.type === "done") final = event.message;
          else {
            retainPartial(event.partial);
            reportUsage(event.partial ?? final);
            if (signal.aborted || event.aborted) return "aborted";
            const limit =
              event.error.code === "CONTEXT_LIMIT" ||
              (event.error.code === "PROVIDER" && event.error.params?.reason === "context");
            this.emit({
              type: "error",
              code: limit ? "CONTEXT_LIMIT" : event.error.code,
              messageKey: limit ? "context.budget_exceeded" : event.error.messageKey,
              retryable: false,
            });
            return limit ? "limit" : "error";
          }
        }
      } catch {
        retainPartial();
        reportUsage(final);
        if (signal.aborted) return "aborted";
        this.emit({ type: "error", code: "PROVIDER", messageKey: "error.provider", retryable: false });
        return "error";
      }
      if (signal.aborted) {
        retainPartial(final);
        reportUsage(final);
        return "aborted";
      }
      if (!final) {
        retainPartial();
        this.emit({ type: "error", code: "PROVIDER", messageKey: "error.provider", retryable: false });
        return "error";
      }
      this.transcript.push(structuredClone(final));
      const text = final.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      if (text && !streamed) this.emit({ type: "message.delta", messageId, text });
      this.emit({ type: "message.done", messageId, text, message: final });
      reportUsage(final);
      const calls = final.content.filter((c): c is ToolCall => c.type === "toolCall");
      if (final.stopReason === "length" || final.stopReason === "error" || final.stopReason === "aborted") {
        for (const call of calls)
          this.transcript.push(
            toolResult(call, "Not executed: incomplete model response.", true, this.host.now()),
          );
        return final.stopReason === "length" ? "limit" : final.stopReason;
      }
      if (!calls.length) {
        if (pending().length) continue;
        return "end";
      }
      const results = new Map<string, ToolResultMessage>();
      const runOne = async (call: ToolCall) => {
        if (signal.aborted) return;
        this.emit({ type: "tool.started", callId: call.id, name: call.name, args: call.arguments });
        const started = this.host.now();
        let output: string;
        let failed = false;
        try {
          const tool = init.tools.find((t) => t.name === call.name);
          if (!tool) throw Error("Unknown tool");
          const args = tool.params.parse(call.arguments);
          // Program commands ask the gate per command line, like file changes.
          if (tool.class === "write" || tool.class === "program") {
            const prepared = structuredClone({ ...call, arguments: args as ToolCall["arguments"] });
            this.emit({ type: "approval.requested", call: prepared });
            const decision = await this.host.approve(prepared, signal);
            this.emit({
              type: "approval.decided",
              callId: call.id,
              decision: signal.aborted ? "aborted" : decision,
            });
            if (decision !== "approved")
              throw Error(decision === "denied" ? "The user denied this change." : "Aborted.");
          }
          signal.throwIfAborted();
          output = await tool.execute(args, signal);
          if (signal.aborted) throw Error("Aborted.");
        } catch (error) {
          failed = true;
          output = signal.aborted ? "Aborted." : error instanceof Error ? error.message : "Tool failed.";
        }
        if (output.length > 32000) output = `${output.slice(0, 31960)}\n[truncated: tool result limit]`;
        const result = toolResult(call, output, failed, this.host.now());
        results.set(call.id, result);
        this.emit({
          type: "tool.done",
          callId: call.id,
          ok: !failed,
          summary: output,
          durationMs: Math.max(0, this.host.now() - started),
          message: result,
          ...(signal.aborted ? { aborted: true } : {}),
        });
      };
      let batch: ToolCall[] = [];
      const flush = async () => {
        await Promise.all(batch.map(runOne));
        batch = [];
      };
      for (const call of calls) {
        if (callsUsed >= (init.maxToolCallsPerTurn ?? 50) || signal.aborted) break;
        callsUsed++;
        if (init.tools.find((t) => t.name === call.name)?.class === "read") batch.push(call);
        else {
          await flush();
          if (!signal.aborted) await runOne(call);
        }
      }
      await flush();
      for (const call of calls)
        this.transcript.push(
          results.get(call.id) ??
            toolResult(
              call,
              signal.aborted ? "Aborted: not executed." : "Tool-call limit reached.",
              true,
              this.host.now(),
            ),
        );
      if (signal.aborted) return "aborted";
      if (callsUsed >= (init.maxToolCallsPerTurn ?? 50)) return "limit";
    }
  }
}
