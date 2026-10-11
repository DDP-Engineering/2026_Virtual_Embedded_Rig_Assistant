/** Experiment only: no production export. Exercises upstream Agent rather than reproducing its loop. */

import type { AgentEvent, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import {
  getCurrentSystemPrompt,
  getCurrentTools,
  withoutInitialSystemMessage,
} from "@earendil-works/pi-ai/utils/transcript";
import { veraError } from "@vera/shared";
import { Type } from "typebox";
import { buildContext, zeroUsage } from "./runtime.js";
import { toolSpecs } from "./tool.js";
import type { AgentRuntime, RuntimeEvent, RuntimeHost, RuntimeInit, StopReason } from "./types.js";

export class PiSpikeRuntime implements AgentRuntime {
  private agent: Agent | undefined;
  private init: RuntimeInit | undefined;
  private running = false;
  private stop: StopReason = "end";
  private messageId = "";
  private inputTokens = 0;
  private outputTokens = 0;
  private readonly listeners = new Set<(e: RuntimeEvent) => void>();
  constructor(private readonly host: RuntimeHost) {}
  onEvent(listener: (e: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(event: RuntimeEvent) {
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(event));
      } catch {
        /* Match observer isolation. */
      }
    }
  }
  start(init: RuntimeInit): void {
    if (this.running) throw veraError("BUSY");
    this.init = init;
    const specs = toolSpecs(init.tools);
    const tools: AgentTool[] = init.tools.map((tool, index) => ({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: Type.Unsafe(specs[index]?.parameters ?? {}),
      executionMode: tool.class === "read" ? "parallel" : "sequential",
      execute: async (_id, args, signal) => ({
        content: [
          {
            type: "text",
            text: await tool.execute(tool.params.parse(args), signal ?? new AbortController().signal),
          },
        ],
        details: undefined,
      }),
    }));
    this.agent = new Agent({
      initialState: {
        systemPrompt: init.systemPrompt,
        model: {
          id: init.model,
          name: init.model,
          api: "replay",
          provider: "replay",
          baseUrl: "",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32768,
          maxTokens: 1000,
        },
        tools,
        messages: structuredClone(init.messages),
      },
      toolExecution: "parallel",
      beforeToolCall: async (context, signal) => {
        const tool = init.tools.find((t) => t.name === context.toolCall.name);
        if (!tool) return { block: true, reason: "Unknown tool" };
        const parsed = tool.params.safeParse(context.args);
        if (!parsed.success) return { block: true, reason: "Invalid tool arguments" };
        if (tool.class !== "write") return undefined;
        const call: ToolCall = structuredClone({
          ...context.toolCall,
          arguments: parsed.data as ToolCall["arguments"],
        });
        this.emit({ type: "approval.requested", call });
        const decision = await this.host.approve(call, signal ?? new AbortController().signal);
        this.emit({ type: "approval.decided", callId: call.id, decision });
        return decision === "approved"
          ? undefined
          : { block: true, reason: decision === "denied" ? "The user denied this change." : "Aborted." };
      },
      streamFn: this.stream,
    });
    this.agent.subscribe((event) => this.event(event));
  }
  messages(): Message[] {
    return structuredClone(withoutInitialSystemMessage((this.agent?.state.messages ?? []) as Message[]));
  }
  abort(): void {
    this.agent?.abort();
    if (this.running) this.stop = "aborted";
  }
  async send(text: string): Promise<{ stopReason: StopReason }> {
    if (this.running) throw veraError("BUSY");
    if (!this.agent || !this.init) throw veraError("INVALID");
    this.running = true;
    this.stop = "end";
    this.inputTokens = 0;
    this.outputTokens = 0;
    const turnId = this.host.nextId();
    this.emit({ type: "message.user", messageId: this.host.nextId(), text });
    this.emit({ type: "turn.started", turnId });
    try {
      await this.agent.prompt({ role: "user", content: text, timestamp: this.host.now() });
    } finally {
      this.emit({ type: "turn.done", turnId, stopReason: this.stop });
      this.running = false;
    }
    return { stopReason: this.stop };
  }
  private readonly stream: StreamFn = (_model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const partial: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "replay",
      provider: "replay",
      model: this.init?.model ?? "scenario",
      usage: zeroUsage(),
      stopReason: "stop",
      timestamp: this.host.now(),
    };
    const fail = (stopReason: "error" | "aborted", message: string) => {
      const error: AssistantMessage = { ...partial, stopReason, errorMessage: message };
      stream.push({ type: "error", reason: stopReason, error });
    };
    void (async () => {
      try {
        const init = this.init;
        if (!init) throw Error("Runtime not started");
        const signal = options?.signal ?? new AbortController().signal;
        const system = getCurrentSystemPrompt(context.messages);
        const tools = getCurrentTools(context.messages).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters as Record<string, unknown>,
        }));
        const view = init.contextPolicy.prepare(
          {
            system,
            tools,
            messages: buildContext(withoutInitialSystemMessage(context.messages), this.host.now()),
          },
          this.host.gateway.capabilities(init.model),
        );
        const { messages, fits, ...budget } = view;
        this.emit({
          type: "usage.updated",
          inputTokens: this.inputTokens,
          outputTokens: this.outputTokens,
          ...budget,
        });
        if (!fits) {
          this.stop = "limit";
          this.emit({
            type: "error",
            code: "CONTEXT_LIMIT",
            messageKey: "context.budget_exceeded",
            retryable: false,
          });
          fail("error", "context.budget_exceeded");
          return;
        }
        stream.push({ type: "start", partial });
        let startedText = false;
        for await (const e of this.host.gateway.stream({
          model: init.model,
          system,
          tools,
          messages,
          signal,
          maxOutputTokens: view.reservedOutputTokens,
        })) {
          if (e.type === "text") {
            if (!startedText) {
              partial.content.push({ type: "text", text: "" });
              stream.push({ type: "text_start", contentIndex: 0, partial });
              startedText = true;
            }
            const block = partial.content[0];
            if (block?.type === "text") block.text += e.delta;
            stream.push({ type: "text_delta", contentIndex: 0, delta: e.delta, partial });
          } else if (e.type === "tool")
            stream.push({ type: "toolcall_delta", contentIndex: e.index, delta: e.delta, partial });
          else if (e.type === "done") {
            stream.push({
              type: "done",
              reason: e.message.stopReason === "toolUse" ? "toolUse" : "stop",
              message: e.message,
            });
            return;
          } else {
            const limit = e.error.code === "CONTEXT_LIMIT" || e.error.params?.reason === "context";
            this.stop = e.aborted ? "aborted" : limit ? "limit" : "error";
            if (!e.aborted)
              this.emit({
                type: "error",
                code: limit ? "CONTEXT_LIMIT" : e.error.code,
                messageKey: limit ? "context.budget_exceeded" : e.error.messageKey,
                retryable: false,
              });
            fail(e.aborted ? "aborted" : "error", e.error.messageKey);
            return;
          }
        }
        this.stop = signal.aborted ? "aborted" : "error";
        fail(signal.aborted ? "aborted" : "error", "Incomplete stream");
      } catch {
        this.stop = "error";
        fail("error", "Adapter failure");
      }
    })();
    return stream;
  };
  private event(event: AgentEvent): void {
    if (event.type === "message_start" && event.message.role === "assistant")
      this.messageId = this.host.nextId();
    if (event.type === "message_update") {
      const e = event.assistantMessageEvent;
      if (e.type === "text_delta")
        this.emit({ type: "message.delta", messageId: this.messageId, text: e.delta });
      if (e.type === "toolcall_delta")
        this.emit({ type: "tool.delta", messageId: this.messageId, index: e.contentIndex, text: e.delta });
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const m = event.message as AssistantMessage;
      this.emit({
        type: "message.done",
        messageId: this.messageId,
        text: m.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join(""),
        message: m,
      });
      this.inputTokens += m.usage.input;
      this.outputTokens += m.usage.output;
      this.emit({ type: "usage.updated", inputTokens: this.inputTokens, outputTokens: this.outputTokens });
    }
    if (event.type === "tool_execution_start")
      this.emit({ type: "tool.started", callId: event.toolCallId, name: event.toolName, args: event.args });
    if (event.type === "tool_execution_end")
      this.emit({
        type: "tool.done",
        callId: event.toolCallId,
        ok: !event.isError,
        summary: JSON.stringify(event.result.content),
        durationMs: event.durationMs ?? 0,
      });
  }
}
