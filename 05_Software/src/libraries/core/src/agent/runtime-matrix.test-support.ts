import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { LlmGateway, LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";
import { ContextPolicy, conservativeCounter } from "./context.js";
import type { AgentRuntime, RuntimeEvent, RuntimeHost, ToolDef } from "./types.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
class Gate {
  pending:
    | { callId: string; sha: string; decide: (decision: "approved" | "denied" | "aborted") => void }
    | undefined;
  ready = defer();
  wait: RuntimeHost["approve"] = async (call, signal) =>
    new Promise((resolve) => {
      const sha = createHash("sha256").update(JSON.stringify(call)).digest("hex");
      const finish = (decision: "approved" | "denied" | "aborted") => {
        signal.removeEventListener("abort", abort);
        this.pending = undefined;
        resolve(decision);
      };
      const abort = () => finish("aborted");
      this.pending = { callId: call.id, sha, decide: finish };
      signal.addEventListener("abort", abort, { once: true });
      this.ready.resolve();
      if (signal.aborted) abort();
    });
  decide(id: string, sha: string, value: "approved" | "denied") {
    if (this.pending?.callId !== id || this.pending.sha !== sha) return false;
    this.pending.decide(value);
    return true;
  }
}
export function runtimeMatrix(
  label: string,
  factory: (host: RuntimeHost) => AgentRuntime,
  mixedParallel = true,
) {
  describe(label, () => {
    async function fixture(
      steps: unknown[],
      options: {
        messages?: Message[];
        small?: boolean;
        approve?: boolean;
        read?: ToolDef["execute"];
        write?: ToolDef["execute"];
        policy?: ContextPolicy;
      } = {},
    ) {
      const dir = await mkdtemp(join(tmpdir(), "vera-agent-"));
      dirs.push(dir);
      await writeFile(join(dir, "scenario.jsonl"), steps.map((s) => JSON.stringify(s)).join("\n"));
      const replay = new ReplayGateway({ dir, now: () => 123 });
      const requests: Omit<LlmRequest, "signal">[] = [];
      let window = options.small ? 6000 : 32768;
      let id = 0;
      const gateway: LlmGateway = {
        selectedModel: replay.selectedModel.bind(replay),
        models: replay.models.bind(replay),
        capabilities: (_model, output) => ({
          contextWindow: window,
          maxOutputTokens: output ?? 1000,
          safetyMargin: Math.max(1024, Math.ceil(window * 0.05)),
          inputBudget: window - (output ?? 1000) - Math.max(1024, Math.ceil(window * 0.05)),
          supportsTools: true,
        }),
        stream: (request) => {
          requests.push(
            structuredClone({ ...request, signal: undefined }) as unknown as Omit<LlmRequest, "signal">,
          );
          return replay.stream(request);
        },
      };
      const gate = new Gate();
      const runtime = factory({
        gateway,
        now: () => 123,
        nextId: () => `id${++id}`,
        approve: options.approve ? gate.wait : async () => "approved",
      });
      const events: RuntimeEvent[] = [];
      runtime.onEvent((e) => events.push(e));
      const schema = z.strictObject({ path: z.string(), content: z.string().optional() });
      const tools: ToolDef[] = [
        {
          name: "read",
          class: "read",
          description: "read dummy",
          params: schema,
          execute: options.read ?? (async () => "read done"),
        },
        {
          name: "write",
          class: "write",
          description: "write dummy",
          params: schema,
          execute: options.write ?? (async () => "write done"),
        },
      ];
      const init = {
        systemPrompt: "rules",
        model: "replay/scenario",
        tools,
        messages: options.messages ?? [],
        contextPolicy: options.policy ?? new ContextPolicy(),
      };
      runtime.start(init);
      return {
        runtime,
        events,
        requests,
        gate,
        init,
        setWindow: (n: number) => {
          window = n;
        },
      };
    }
    it("streams text/tool calls and validates zod JSON Schema boundary", async () => {
      const f = await fixture([
        { text: "chunk ".repeat(30), toolCalls: [{ name: "read", args: { path: "a" } }] },
        { text: "answer" },
      ]);
      expect(await f.runtime.send("start")).toEqual({ stopReason: "end" });
      expect(f.events.filter((e) => e.type === "message.delta").length).toBeGreaterThan(2);
      expect(f.events.some((e) => e.type === "tool.delta")).toBe(true);
      expect(f.requests[0]?.tools[0]?.parameters).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["path"],
      });
      expect(f.runtime.messages().filter((m) => m.role === "toolResult")).toHaveLength(1);
      const unsubscribe = f.runtime.onEvent(() => {
        throw Error("observer failure");
      });
      unsubscribe();
    });
    it("parallel read-only batch and mixed ordered writes (measures candidate ordering gap)", async () => {
      const calls = [
        { name: "read", args: { path: "a" } },
        { name: "read", args: { path: "b" } },
        { name: "write", args: { path: "c" } },
        { name: "write", args: { path: "d" } },
      ];
      async function exercise(mixed: boolean, parallel: boolean) {
        let active = 0,
          peak = 0;
        const order: string[] = [];
        const barrier = () => ({ started: defer(), release: defer(), completed: defer() });
        const barriers = { a: barrier(), b: barrier(), c: barrier(), d: barrier() };
        const execute: ToolDef["execute"] = async (args) => {
          const path = (args as { path: keyof typeof barriers }).path;
          const barrier = barriers[path];
          if (!barrier) throw Error("Unknown test path");
          active++;
          peak = Math.max(peak, active);
          order.push(`start:${path}`);
          barrier.started.resolve();
          await barrier.release.promise;
          active--;
          order.push(`done:${path}`);
          barrier.completed.resolve();
          return path;
        };
        const f = await fixture([{ toolCalls: mixed ? calls : calls.slice(0, 2) }, { text: "done" }], {
          read: execute,
          write: execute,
        });
        const turn = f.runtime.send("barriers");
        await barriers.a.started.promise;
        if (parallel) {
          await barriers.b.started.promise;
          expect(active).toBe(2);
          barriers.b.release.resolve();
          await barriers.b.completed.promise;
          expect(active).toBe(1);
          expect(order).not.toContain("start:c");
          barriers.a.release.resolve();
        } else {
          // pi serializes the entire mixed batch when a sequential write is present.
          expect(active).toBe(1);
          barriers.a.release.resolve();
          await barriers.b.started.promise;
          barriers.b.release.resolve();
        }
        if (mixed) {
          await barriers.c.started.promise;
          expect(active).toBe(1);
          expect(order).not.toContain("start:d");
          barriers.c.release.resolve();
          await barriers.d.started.promise;
          expect(order.indexOf("done:c")).toBeLessThan(order.indexOf("start:d"));
          expect(active).toBe(1);
          barriers.d.release.resolve();
        }
        expect((await turn).stopReason).toBe("end");
        expect(peak).toBe(parallel ? 2 : 1);
        expect(order).toEqual([
          "start:a",
          ...(parallel ? ["start:b", "done:b", "done:a"] : ["done:a", "start:b", "done:b"]),
          ...(mixed ? ["start:c", "done:c", "start:d", "done:d"] : []),
        ]);
        const results = f.runtime.messages().filter((m): m is ToolResultMessage => m.role === "toolResult");
        const assistant = f.runtime.messages().find((m) => m.role === "assistant");
        expect(results.every((r) => !r.isError)).toBe(true);
        expect(results.map((r) => r.toolCallId)).toEqual(
          assistant?.role === "assistant"
            ? assistant.content.filter((c) => c.type === "toolCall").map((c) => c.id)
            : [],
        );
        expect(results.map((r) => r.content)).toEqual(
          (mixed ? ["a", "b", "c", "d"] : ["a", "b"]).map((text) => [{ type: "text", text }]),
        );
      }
      await exercise(true, mixedParallel);
      await exercise(false, true);
    });
    for (const decision of ["approved", "denied"] as const)
      it(`approval waits then ${decision}`, async () => {
        let writes = 0;
        const f = await fixture(
          [{ toolCalls: [{ name: "write", args: { path: "a", content: "change" } }] }, { text: "done" }],
          {
            approve: true,
            write: async () => {
              writes++;
              return "changed";
            },
          },
        );
        const turn = f.runtime.send("write");
        await f.gate.ready.promise;
        expect(writes).toBe(0);
        expect(f.events.some((e) => e.type === "turn.done")).toBe(false);
        await expect(f.runtime.send("busy")).rejects.toMatchObject({ code: "BUSY" });
        const pending = f.gate.pending;
        if (!pending) throw Error("Approval missing");
        expect(f.gate.decide(pending.callId, "wrong", decision)).toBe(false);
        expect(f.gate.decide(pending.callId, pending.sha, decision)).toBe(true);
        expect(f.gate.decide(pending.callId, pending.sha, decision)).toBe(false);
        expect((await turn).stopReason).toBe("end");
        expect(writes).toBe(decision === "approved" ? 1 : 0);
        expect(f.events).toContainEqual(expect.objectContaining({ type: "approval.decided", decision }));
        expect(f.runtime.messages().find((m) => m.role === "toolResult")).toMatchObject({
          isError: decision === "denied",
        });
      });
    it("abort pending approval, close pairs and keep runtime usable", async () => {
      let writes = 0;
      const f = await fixture(
        [
          {
            toolCalls: [
              { name: "write", args: { path: "a" } },
              { name: "write", args: { path: "b" } },
            ],
          },
          { text: "done" },
        ],
        {
          approve: true,
          write: async () => {
            writes++;
            return "changed";
          },
        },
      );
      const turn = f.runtime.send("write");
      await f.gate.ready.promise;
      f.runtime.abort();
      expect((await turn).stopReason).toBe("aborted");
      expect(writes).toBe(0);
      expect(f.gate.pending).toBeUndefined();
      expect(f.events).toContainEqual(
        expect.objectContaining({ type: "approval.decided", decision: "aborted" }),
      );
      expect(f.events.at(-1)).toMatchObject({ type: "turn.done", stopReason: "aborted" });
      // Reference closes every call; pi's native sequential abort leaves later calls unanswered.
      expect(f.runtime.messages().filter((m) => m.role === "toolResult")).toHaveLength(mixedParallel ? 2 : 1);
      f.runtime.start({ ...f.init, tools: [], messages: f.runtime.messages(), model: "replay/scenario" });
      expect((await f.runtime.send("continue")).stopReason).toBe("end");
    });
    it("resumes JSON-persisted messages verbatim", async () => {
      const a = await fixture([{ text: "saved answer" }]);
      await a.runtime.send("first");
      const saved = JSON.stringify(a.runtime.messages());
      const b = await fixture([{ text: "new answer" }], { messages: JSON.parse(saved) });
      await b.runtime.send("second");
      expect(JSON.stringify(b.requests[0]?.messages).includes("saved answer")).toBe(true);
      expect(JSON.stringify(b.runtime.messages().slice(0, JSON.parse(saved).length))).toBe(saved);
      const snapshot = b.runtime.messages();
      snapshot.length = 0;
      expect(b.runtime.messages().length).toBeGreaterThan(0);
    });
    it("throwing and invalid tools become error results before next request", async () => {
      let executions = 0;
      const f = await fixture(
        [
          {
            toolCalls: [
              { name: "read", args: { path: "a" } },
              { name: "read", args: { path: "b", extra: true } },
            ],
          },
          { text: "handled" },
        ],
        {
          read: async () => {
            executions++;
            throw Error("dummy failure");
          },
        },
      );
      expect((await f.runtime.send("throw")).stopReason).toBe("end");
      expect(executions).toBe(1);
      expect(
        f.runtime
          .messages()
          .filter((m) => m.role === "toolResult")
          .every((m) => m.isError),
      ).toBe(true);
      expect(f.requests).toHaveLength(2);
    });
    it("bounds every request in a long first turn, preserves full current results and usage", async () => {
      const f = await fixture(
        [
          { toolCalls: ["a", "b", "c"].map((path) => ({ name: "read", args: { path } })) },
          { toolCalls: [{ name: "read", args: { path: "d" } }] },
          { text: "done" },
        ],
        {
          small: true,
          read: async (args) =>
            JSON.stringify({ ref: `${(args as { path: string }).path}#L1-L2`, body: "x".repeat(5000) }),
        },
      );
      expect((await f.runtime.send("long")).stopReason).toBe("end");
      expect(f.requests).toHaveLength(3);
      for (const r of f.requests) {
        expect(r.maxOutputTokens).toBe(1000);
        if (r.maxOutputTokens === undefined) throw Error("Missing output reserve");
        expect(conservativeCounter(r).tokens).toBeLessThanOrEqual(6000 - r.maxOutputTokens - 1024);
      }
      // The same raw-request oracle rejects an unreduced dispatch regression.
      const captured = f.requests[1];
      if (!captured) throw Error("Missing second request");
      const oversized = { ...captured, messages: f.runtime.messages() };
      expect(conservativeCounter(oversized).tokens).toBeGreaterThan(3976);
      expect(JSON.stringify(f.requests[1]?.messages)).toContain("[context truncated]");
      expect(JSON.stringify(f.runtime.messages())).toContain("x".repeat(5000));
      for (const request of f.requests.slice(1)) {
        const ids = request.messages.flatMap((m) =>
          m.role === "assistant" ? m.content.filter((c) => c.type === "toolCall").map((c) => c.id) : [],
        );
        expect(request.messages.filter((m) => m.role === "toolResult").map((m) => m.toolCallId)).toEqual(ids);
      }
      expect(f.events.filter((e) => e.type === "usage.updated")).toContainEqual(
        expect.objectContaining({
          contextWindow: 6000,
          reservedOutputTokens: 1000,
          safetyMarginTokens: 1024,
          estimated: true,
        }),
      );
    });
    it("irreducible input dispatches no model call, emits recoverable limit", async () => {
      const f = await fixture([{ text: "done" }], { small: true });
      expect((await f.runtime.send("x".repeat(6000))).stopReason).toBe("limit");
      expect(f.requests).toHaveLength(0);
      expect(f.events).toContainEqual(
        expect.objectContaining({
          type: "error",
          code: "CONTEXT_LIMIT",
          messageKey: "context.budget_exceeded",
        }),
      );
      // History is intentionally retained; host may change the model to recover.
      f.setWindow(32768);
      expect((await f.runtime.send("small")).stopReason).toBe("end");
      expect(f.requests).toHaveLength(1);
    });
    it("resolves fresh smaller capabilities between model calls", async () => {
      let f: Awaited<ReturnType<typeof fixture>>;
      f = await fixture([{ toolCalls: [{ name: "read", args: { path: "a" } }] }, { text: "done" }], {
        read: async () => {
          f.setWindow(6000);
          return "x".repeat(5000);
        },
      });
      expect((await f.runtime.send("switch")).stopReason).toBe("end");
      const budgets = f.events.filter((e) => e.type === "usage.updated" && e.contextWindow);
      expect(budgets.map((e) => (e.type === "usage.updated" ? e.contextWindow : 0))).toEqual([32768, 6000]);
    });
  });
}
