import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import { type ProviderCatalog, veraError } from "@vera/shared";
import { type LlmEvent, type LlmGateway, type LlmRequest, splitModelReference } from "./gateway.js";

interface ReplayStep {
  match?: string;
  prompt?: string;
  text?: string;
  toolCalls?: { name: string; args: ToolCall["arguments"] }[];
}
interface Scenario {
  name: string;
  match: RegExp | null;
  steps: ReplayStep[];
}
const textOf = (message: Message): string =>
  message.role === "toolResult"
    ? message.content.map((c) => (c.type === "text" ? c.text : "")).join("")
    : message.role === "user"
      ? typeof message.content === "string"
        ? message.content
        : message.content.map((c) => (c.type === "text" ? c.text : "")).join("")
      : "";
function scenarios(dir: string): Scenario[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => {
      const steps: ReplayStep[] = readFileSync(join(dir, name), "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith("//"))
        .map((line) => JSON.parse(line));
      if (
        !steps.length ||
        steps.some(
          (step) =>
            !step ||
            typeof step !== "object" ||
            (step.text !== undefined && typeof step.text !== "string") ||
            (step.toolCalls !== undefined &&
              (!Array.isArray(step.toolCalls) ||
                step.toolCalls.some(
                  (c) =>
                    !c ||
                    typeof c.name !== "string" ||
                    !c.args ||
                    typeof c.args !== "object" ||
                    Array.isArray(c.args),
                ))),
        )
      )
        throw veraError("INVALID");
      const pattern = steps[0]?.match;
      let match: RegExp | null = null;
      if (pattern) {
        const flags = /^\(\?([imsu]+)\)/.exec(pattern);
        match = new RegExp(flags ? pattern.slice(flags[0].length) : pattern, flags?.[1]);
      }
      return { name: basename(name, ".jsonl"), match, steps };
    });
}
function bindings(messages: Message[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "toolResult" || message.isError) continue;
    try {
      const body: unknown = JSON.parse(textOf(message));
      if (body && typeof body === "object" && !Array.isArray(body)) {
        for (const [key, value] of Object.entries(body))
          if (typeof value === "string") result.set(key, value);
        if ("name" in body && typeof body.name === "string" && "ref" in body && typeof body.ref === "string")
          result.set(`artifact:${body.name}`, body.ref);
      }
    } catch {
      /* non-JSON tool output has no bindings */
    }
  }
  return result;
}
function fill<T>(value: T, values: Map<string, string>): T {
  const walk = (item: unknown): unknown =>
    typeof item === "string"
      ? item.replace(/\{\{([^{}]+)\}\}/g, (whole, key: string) => values.get(key) ?? whole)
      : Array.isArray(item)
        ? item.map(walk)
        : item && typeof item === "object"
          ? Object.fromEntries(Object.entries(item).map(([key, v]) => [key, walk(v)]))
          : item;
  return walk(value) as T;
}
export class ReplayGateway implements LlmGateway {
  constructor(
    private readonly options: {
      dir: string;
      now: () => number;
      delay?: (signal: AbortSignal) => Promise<void>;
    },
  ) {}
  selectedModel(provider: string): string {
    if (provider !== "replay") throw veraError("NOT_FOUND");
    return scenarios(this.options.dir)[0]?.name ?? "auto";
  }
  capabilities(reference: string, output?: number) {
    if (splitModelReference(reference).provider !== "replay") throw veraError("NOT_FOUND");
    if (output !== undefined && (!Number.isSafeInteger(output) || output <= 0)) throw veraError("INVALID");
    const maxOutputTokens = Math.min(output ?? 4096, 4096);
    return {
      contextWindow: 32768,
      maxOutputTokens,
      safetyMargin: 1639,
      inputBudget: 32768 - maxOutputTokens - 1639,
      supportsTools: true,
    };
  }
  async models(provider: string, signal?: AbortSignal): Promise<ProviderCatalog> {
    signal?.throwIfAborted();
    if (provider !== "replay") throw veraError("NOT_FOUND");
    return {
      reachability: "pass",
      models: scenarios(this.options.dir).map((s) => ({
        id: s.name,
        name: s.name,
        reference: `replay/${s.name}`,
        ...this.capabilities(`replay/${s.name}`),
      })),
    };
  }
  async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
    try {
      request.signal.throwIfAborted();
      this.capabilities(request.model, request.maxOutputTokens);
      let at = -1;
      for (let i = request.messages.length - 1; i >= 0; i--)
        if (request.messages[i]?.role === "user") {
          at = i;
          break;
        }
      const user = at >= 0 ? request.messages[at] : undefined;
      const text = user ? textOf(user) : "";
      const model = splitModelReference(request.model).model;
      const all = scenarios(this.options.dir);
      const scenario =
        all.find((s) => s.name === model) ??
        (model === "auto" ? all.find((s) => s.match?.test(text)) : undefined);
      if (!scenario) throw veraError("NOT_FOUND");
      const stepNo = request.messages.slice(at + 1).filter((m) => m.role === "assistant").length;
      const step = scenario.steps[stepNo];
      if (!step) throw veraError("NOT_FOUND");
      const selected = fill(step, bindings(request.messages));
      const response = selected.text ?? "";
      for (let i = 0; i < response.length; i += 40) {
        request.signal.throwIfAborted();
        yield { type: "text", delta: response.slice(i, i + 40) };
        await this.options.delay?.(request.signal);
      }
      request.signal.throwIfAborted();
      const message: AssistantMessage = {
        role: "assistant",
        api: "replay",
        provider: "replay",
        model: scenario.name,
        content: [
          ...(response ? [{ type: "text" as const, text: response }] : []),
          ...(selected.toolCalls ?? []).map((call, i) => ({
            type: "toolCall" as const,
            id: `replay_${user?.timestamp ?? 0}_${at}_${stepNo}_${i}`,
            name: call.name,
            arguments: call.args,
          })),
        ],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: selected.toolCalls?.length ? "toolUse" : "stop",
        timestamp: this.options.now(),
      };
      for (const [index, block] of message.content.entries()) {
        if (block.type !== "toolCall") continue;
        const args = JSON.stringify(block.arguments);
        for (let at = 0; at < args.length; at += 40) {
          request.signal.throwIfAborted();
          yield { type: "tool", index, delta: args.slice(at, at + 40) };
          await this.options.delay?.(request.signal);
        }
      }
      yield { type: "done", message };
    } catch (error) {
      yield {
        type: "error",
        error:
          error && typeof error === "object" && "code" in error && error.code === "INVALID"
            ? veraError("INVALID")
            : veraError("NOT_FOUND"),
        aborted: request.signal.aborted,
      };
    }
  }
}
