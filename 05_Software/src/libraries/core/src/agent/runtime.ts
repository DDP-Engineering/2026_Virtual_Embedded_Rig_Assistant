// Derived from BenchPilot's gateway loop: contiguous parallel reads, ordered writes and source-order results.
import type {
  AssistantMessage,
  ImageContent,
  Message,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { acceptsImages, MAX_MESSAGE_IMAGES, type ModelCapabilities, veraError } from "@vera/shared";
import { ContextCompactor, type SummarizeHistory } from "./compaction.js";
import type { UserImageMessage } from "./message-images.js";
import { toolSpecs } from "./tool.js";
import type {
  AgentRuntime,
  CompactionOutcome,
  RuntimeEvent,
  RuntimeHost,
  RuntimeInit,
  StopReason,
} from "./types.js";

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
function userMessage(message: { text: string; images?: string[]; timestamp: number }): UserImageMessage {
  return {
    role: "user",
    content: message.text,
    ...(message.images?.length && { images: [...message.images] }),
    timestamp: message.timestamp,
  };
}

export class ReferenceRuntime implements AgentRuntime {
  private init: RuntimeInit | undefined;
  private transcript: Message[] = [];
  private controller: AbortController | undefined;
  private compactor = new ContextCompactor();
  /** Consumption reported during the latest turn, continued by a background compaction. */
  private lastTotals = { inputTokens: 0, outputTokens: 0 };
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
  /** The host log is the only place a swallowed exception is kept; a failing logger cannot change the turn. */
  private report(where: string, error: unknown): void {
    try {
      this.host.log?.(`${where}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    } catch {
      /* Logging is best effort. */
    }
  }
  abort(): void {
    this.controller?.abort();
  }
  async send(text: string, images?: string[]): Promise<{ stopReason: StopReason }> {
    if (this.controller) throw veraError("BUSY");
    const init = this.init;
    if (!init) throw veraError("INVALID");
    const controller = new AbortController();
    this.controller = controller;
    const identity = init.requestIdentity;
    delete init.requestIdentity;
    const turnId = identity?.turnId ?? this.host.nextId();
    const messageId = identity?.messageId ?? this.host.nextId();
    const currentStart = this.transcript.length;
    const recovered = new Set(this.host.steering?.().map((message) => message.messageId));
    const prompt = userMessage({ text, ...(images && { images }), timestamp: this.host.now() });
    this.transcript.push(prompt);
    this.emit({
      type: "message.user",
      messageId,
      text,
      ...(prompt.images && { images: prompt.images }),
      timestamp: prompt.timestamp,
    });
    this.emit({ type: "turn.started", turnId });
    let stopReason: StopReason = "error";
    try {
      stopReason = await this.run(init, controller.signal, currentStart, recovered, messageId);
    } catch (error) {
      stopReason = controller.signal.aborted ? "aborted" : "error";
      if (stopReason === "error") {
        this.report("Agent turn failed", error);
        this.emit({ type: "error", code: "INTERNAL", messageKey: "errors.INTERNAL", retryable: false });
      }
    } finally {
      this.emit({ type: "turn.done", turnId, stopReason });
      this.controller = undefined;
    }
    return { stopReason };
  }
  /** One summary model call: no tools, the summary budget, usage reported as running. */
  private summarizer(
    init: RuntimeInit,
    signal: AbortSignal,
    totals: () => { inputTokens: number; outputTokens: number },
    addUsage: (message: AssistantMessage) => void,
  ): SummarizeHistory {
    return async (input, summaryView) => {
      const { messages: summaryMessages, fits: _, rawTokens: _raw, ...summaryBudget } = summaryView;
      this.emit({
        type: "usage.updated",
        ...totals(),
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
    };
  }
  /** Hand an adopted summary to the session owner for its durable record (REQ-DATA-d9ca38e5). */
  private recordCompaction(): boolean {
    const record = this.compactor.takeRecord();
    if (record) this.emit({ type: "context.compacted", ...record });
    return !!record;
  }
  /**
   * After a turn, compact the finished conversation in the background when it is above the trigger;
   * the next request waits for it (REQ-FUNC-99acfc19). Below the trigger it makes no model call.
   * `force` makes one summary pass regardless of the trigger (Compact now, REQ-FUNC-eeaf29bd).
   */
  async compact(transcript?: Message[], force = false): Promise<CompactionOutcome> {
    const init = this.init;
    if (!init || this.controller) return "none";
    const totals = { ...this.lastTotals };
    let outcome: CompactionOutcome = "none";
    await this.compactor.background(async (signal) => {
      // A provider failure before the summary leaves this outcome; `background` swallows the error itself.
      outcome = "failed";
      await this.host.gateway.prepareModel?.(init.model, signal);
      signal.throwIfAborted();
      const capabilities = this.host.gateway.capabilities(init.model);
      const messages = buildContext(transcript ?? this.transcript, this.host.now());
      let started = false;
      const view = await this.compactor.prepare(
        {
          system: init.systemPrompt,
          tools: toolSpecs(init.tools.filter((tool) => !tool.requiresImages || acceptsImages(capabilities))),
          messages,
        },
        capabilities,
        init.contextPolicy,
        (input, summaryView) => {
          started = true;
          return this.summarizer(
            init,
            signal,
            () => totals,
            (message) => {
              totals.inputTokens += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
              totals.outputTokens += message.usage.output;
            },
          )(input, summaryView);
        },
        messages.length,
        this.compactor.scale(init.model),
        true,
        force,
      );
      if (!started) {
        outcome = view.compactionStatus === "unavailable" ? "unavailable" : "none";
        return;
      }
      // A completed summary is recorded only when the compaction was not stopped.
      if (!signal.aborted) this.recordCompaction();
      else this.compactor.takeRecord();
      const { messages: _messages, fits: _fits, rawTokens: _raw, ...budget } = view;
      const status = signal.aborted ? "failed" : view.compactionStatus;
      outcome = status === "completed" || status === "unavailable" ? status : "failed";
      this.emit({ type: "usage.updated", ...totals, ...budget, compactionStatus: status });
    });
    return outcome;
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
    this.lastTotals = { inputTokens: 0, outputTokens: 0 };
    const addUsage = (message: AssistantMessage) => {
      inputTokens += message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
      outputTokens += message.usage.output;
      this.lastTotals = { inputTokens, outputTokens };
    };
    // Keep pixels for model continuations in this turn, outside replay and persistence.
    const resultImages = new Map<ToolResultMessage, ImageContent>();
    const withResultImages = (message: Message): Message => {
      if (message.role !== "toolResult") return message;
      const image = resultImages.get(message);
      return image ? { ...message, content: [...message.content, image] } : message;
    };
    const toolsFor = (capabilities: ModelCapabilities) =>
      init.tools.filter((tool) => !tool.requiresImages || acceptsImages(capabilities));
    const delivered = new Set<string>();
    const recoveredPositions = new Set<number>();
    const pending = () =>
      (this.host.steering?.() ?? []).filter((message) => !delivered.has(message.messageId));
    for (;;) {
      if (signal.aborted) return "aborted";
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
      const scale = this.compactor.scale(init.model);
      const compacted = await this.compactor.prepare(
        {
          system: init.systemPrompt,
          tools: toolSpecs(toolsFor(capabilities)),
          messages: buildContext(requestMessages.map(withResultImages), this.host.now(), currentStart),
        },
        capabilities,
        init.contextPolicy,
        this.summarizer(init, signal, () => ({ inputTokens, outputTokens }), addUsage),
        historicalEnd,
        scale,
      );
      this.recordCompaction();
      // Messages admitted during an awaited historical summary join the next normal
      // request too. Recheck M1 once, without another compaction attempt.
      const included = new Set(queued.map((message) => message.messageId));
      const arrivals = pending().filter((message) => !included.has(message.messageId));
      queued = [...queued, ...arrivals];
      // The summary is itself a model dispatch; resolve capabilities again for the normal call.
      const currentCapabilities = this.host.gateway.capabilities(init.model);
      const offered = toolsFor(currentCapabilities);
      const tools = toolSpecs(offered);
      const view = {
        ...init.contextPolicy.prepare(
          {
            system: init.systemPrompt,
            tools,
            messages: [...compacted.messages, ...arrivals.map(userMessage)],
          },
          currentCapabilities,
          true,
          undefined,
          scale,
        ),
        compactionStatus: compacted.compactionStatus,
        requestViewTokens: 0,
      };
      view.requestViewTokens = view.contextTokens;
      const { messages, fits, rawTokens, ...budget } = view;
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
        const reported = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
        const calibration = budget.estimated
          ? this.compactor.calibrate(init.model, reported, rawTokens)
          : undefined;
        this.emit({
          type: "usage.updated",
          inputTokens,
          outputTokens,
          promptIds,
          ...(calibration && { calibration: { ...calibration } }),
        });
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
            // Only a timeout's limit is kept with the stored event; provider text and endpoints stay out.
            const seconds = event.error.params?.reason === "timeout" ? event.error.params.seconds : undefined;
            this.emit({
              type: "error",
              code: limit ? "CONTEXT_LIMIT" : event.error.code,
              messageKey: limit ? "context.budget_exceeded" : event.error.messageKey,
              ...(typeof seconds === "number" ? { params: { seconds } } : {}),
              retryable: false,
            });
            return limit ? "limit" : "error";
          }
        }
      } catch (error) {
        retainPartial();
        reportUsage(final);
        if (signal.aborted) return "aborted";
        this.report("Model stream failed", error);
        this.emit({ type: "error", code: "PROVIDER", messageKey: "errors.PROVIDER", retryable: false });
        return "error";
      }
      if (signal.aborted) {
        retainPartial(final);
        reportUsage(final);
        return "aborted";
      }
      if (!final) {
        retainPartial();
        this.emit({ type: "error", code: "PROVIDER", messageKey: "errors.PROVIDER", retryable: false });
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
      let imagesInStep = 0;
      const runOne = async (call: ToolCall) => {
        if (signal.aborted) return;
        this.emit({ type: "tool.started", callId: call.id, name: call.name, args: call.arguments });
        const started = this.host.now();
        let output: string;
        let image: ImageContent | undefined;
        let failed = false;
        try {
          const tool = offered.find((t) => t.name === call.name);
          if (!tool) throw Error("Unknown tool");
          if (tool.requiresImages && imagesInStep >= MAX_MESSAGE_IMAGES)
            throw Error(
              `At most ${MAX_MESSAGE_IMAGES} images can be inspected in one step. Try the remaining files in a later step.`,
            );
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
          const result = await tool.execute(args, signal, call.id);
          output = typeof result === "string" ? result : result.text;
          if (typeof result !== "string") image = result.image;
          // A write or program that completed stays applied after a stop: the model must see its result.
          if (signal.aborted && tool.class !== "write" && tool.class !== "program") throw Error("Aborted.");
          if (tool.publish) output = tool.publish(args, output);
        } catch (error) {
          failed = true;
          output = signal.aborted ? "Aborted." : error instanceof Error ? error.message : "Tool failed.";
        }
        // The final cut follows the session's Tool result size, so a raised size reaches the model.
        const resultLimit = init.maxToolResultChars ?? 32000;
        if (output.length > resultLimit)
          output = `${output.slice(0, resultLimit - 40)}\n[truncated: tool result limit]`;
        const result = toolResult(call, output, failed, this.host.now());
        if (!failed && image) {
          imagesInStep++;
          if (resultImages.size === MAX_MESSAGE_IMAGES) {
            const oldest = resultImages.keys().next();
            if (!oldest.done) resultImages.delete(oldest.value);
          }
          resultImages.set(result, image);
        }
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
        const tool = offered.find((candidate) => candidate.name === call.name);
        // A raster decode can expand a bounded input substantially.
        if (tool?.class === "read" && !tool.requiresImages) batch.push(call);
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
