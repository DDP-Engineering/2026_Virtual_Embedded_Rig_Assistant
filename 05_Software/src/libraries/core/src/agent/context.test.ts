import { existsSync } from "node:fs";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, it } from "vitest";
import type * as Context from "./context.js";

let policy: typeof Context;
beforeAll(async () => {
  expect(existsSync(new URL("./context.ts", import.meta.url)), "M1 context policy exists").toBe(true);
  policy = await import("./context.js");
});
const caps = {
  contextWindow: 6000,
  maxOutputTokens: 1000,
  safetyMargin: 1024,
  inputBudget: 3976,
  supportsTools: true,
};
const input = (messages: Message[] = []) => ({
  system: "system",
  tools: [{ name: "read", description: "read", parameters: { type: "object" } }],
  messages,
});
const assistant = (ids: string[]): Message => ({
  role: "assistant",
  content: ids.map((id) => ({ type: "toolCall", id, name: "read", arguments: { path: id } })),
  api: "replay",
  provider: "replay",
  model: "x",
  usage: {
    input: 17,
    output: 3,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 20,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "toolUse",
  timestamp: 1,
});
const result = (id: string, length: number, isError = false): ToolResultMessage => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "read",
  content: [{ type: "text", text: JSON.stringify({ body: "x".repeat(length), ref: `${id}#L1-L2` }) }],
  isError,
  timestamp: 1,
});
describe("context budget", () => {
  it("counts system, tool schemas, framing, calls and results", () => {
    const counter = policy.conservativeCounter;
    const baseline = counter(input());
    expect(baseline.estimated).toBe(true);
    expect(counter({ ...input(), system: "s".repeat(100) }).tokens).toBeGreaterThan(baseline.tokens);
    expect(counter({ ...input(), tools: [] }).tokens).toBeLessThan(baseline.tokens);
    expect(counter(input([assistant(["a"]), result("a", 100)])).tokens).toBeGreaterThan(
      baseline.tokens + 100,
    );
    expect(counter(input([{ role: "user", content: "é", timestamp: 0 }])).tokens).toBeGreaterThan(
      counter(input([{ role: "user", content: "a", timestamp: 0 }])).tokens,
    );
  });
  it("reserves effective output and safety, using an injected whole-request counter", () => {
    const p = new policy.ContextPolicy(() => ({ tokens: 25, estimated: false }));
    expect(p.prepare(input(), caps)).toMatchObject({
      fits: true,
      contextTokens: 25,
      inputBudgetTokens: 3976,
      reservedOutputTokens: 1000,
      safetyMarginTokens: 1024,
      estimated: false,
    });
    expect(p.prepare(input(), { ...caps, contextWindow: 40000, maxOutputTokens: 3000 })).toMatchObject({
      inputBudgetTokens: 35000,
      safetyMarginTokens: 2000,
    });
  });
  it("reduces completed results oldest-first, preserving refs, outcomes and pairs without mutations", () => {
    const messages: Message[] = [
      { role: "user", content: "keep", timestamp: 0 },
      assistant(["a", "b", "c"]),
      result("a", 3000, true),
      result("b", 3000),
      result("c", 3000),
    ];
    const saved = JSON.stringify(messages);
    const p = new policy.ContextPolicy((request) => ({
      tokens: JSON.stringify(request).length,
      estimated: false,
    }));
    const reduced = p.prepare(input(messages), caps);
    expect(reduced.fits).toBe(true);
    expect(reduced.contextTokens).toBeLessThanOrEqual(3976);
    expect(JSON.stringify(messages)).toBe(saved);
    const results = reduced.messages.filter((m): m is ToolResultMessage => m.role === "toolResult");
    expect(results.map((r) => r.toolCallId)).toEqual(["a", "b", "c"]);
    expect(results[0]?.isError).toBe(true);
    expect(JSON.stringify(results[0])).toContain("[context truncated]");
    expect(JSON.stringify(results)).toContain("a#L1-L2");
    expect(JSON.stringify(results)).toContain("b#L1-L2");
    expect(JSON.stringify(reduced.messages[1])).toBe(JSON.stringify(messages[1]));
  });
  it("keeps mandatory system/current user/unresolved calls and declines irreducible input", () => {
    const p = new policy.ContextPolicy();
    const request = {
      ...input([assistant(["pending"]), { role: "user" as const, content: "x".repeat(6000), timestamp: 0 }]),
      system: "rules",
    };
    const reduced = p.prepare(request, caps);
    expect(reduced.fits).toBe(false);
    expect(reduced.messages).toEqual(request.messages);
    expect(p.prepare({ ...input(), system: "x".repeat(6000) }, caps).fits).toBe(false);
    expect(
      p.prepare({ ...input(), tools: [{ name: "r", description: "x".repeat(6000), parameters: {} }] }, caps)
        .fits,
    ).toBe(false);
  });
});
