// LLM gateway pieces: replay fixtures and placeholders, pi-ai stream mapping (faux provider, no network),
// settings/credentials files (masked, outside the DB), transcript repair and replay recording.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import type { LlmSettings } from "@benchpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContext } from "../agent/loop.ts";
import { turnToSteps } from "../agent/record.ts";
import { REPLAY_DIR } from "../context.ts";
import { openDb, resetDb } from "../db/index.ts";
import type { StoredMessage } from "../db/repos/sessions.ts";
import { json, testServer, type TestServer } from "../test-support/server.ts";
import { settingsFiles } from "./credentials.ts";
import type { LlmEvent } from "./gateway.ts";
import { createCollections, piAiGateway, redact } from "./providers.ts";
import { fillPlaceholders, loadScenarios, OFF_SCRIPT, ReplayGateway, transcriptBindings } from "./replay.ts";

const PROMPTS: Record<string, string> = {
  "demo-1": "Run the performance tests for firmware 2.1.0.",
  "demo-2": "Analyze the root cause of the failures in RPT-0009.",
  "demo-3": "Compare firmware 2.1.0 with 2.0.4. What changed, and is 2.1.0 release-ready?",
  "demo-4": "Re-run the throughput test to confirm the environment issue.",
  "demo-5": "Is TC-DNS-005 a reliable test?",
};

describe("replay fixtures", () => {
  it("every 07 prompt selects its own fixture; tools in fixtures exist", () => {
    const replay = new ReplayGateway({ dir: REPLAY_DIR });
    for (const [name, prompt] of Object.entries(PROMPTS)) expect(replay.pick("replay", prompt)?.name).toBe(name);
    expect(replay.pick("replay", "hello")).toBeNull();
    const tools = new Set(["load_skill", "search_testbench_docs", "read_testbench_doc", "list_tests", "get_test_definition", "propose_test_plan", "run_test_plan", "list_reports", "get_report", "get_test_history", "search_logs", "get_log_context", "query_packets", "get_metrics", "get_timeline", "compare_runs", "compare_traffic_profiles", "save_report_analysis", "draft_ticket"]);
    for (const s of loadScenarios(REPLAY_DIR)) {
      expect(s.prompt, s.name).toBe(PROMPTS[s.name]);
      for (const st of s.steps) for (const c of st.toolCalls ?? []) expect(tools.has(c.name), `${s.name}: ${c.name}`).toBe(true);
    }
  });

  it("placeholders resolve from earlier tool results, newest last", () => {
    const tr = (toolName: string, body: unknown): Message =>
      ({ role: "toolResult", toolCallId: "x", toolName, content: [{ type: "text", text: JSON.stringify(body) }], isError: false, timestamp: 0 }) as Message;
    const msgs = [
      tr("propose_test_plan", { plan_id: "PLAN-0001", decision: "approve", fw: "2.1.0" }),
      tr("run_test_plan", { report_id: "RPT-0009", results: [{ test_run_id: "RUN-0041", test_id: "TC-PERF-003" }] }),
      tr("propose_test_plan", { plan_id: "PLAN-0002", decision: "approve", fw: "2.1.0" }),
    ];
    const b = transcriptBindings(msgs);
    expect(fillPlaceholders({ a: "{{plan_id}}", b: ["[[ev:{{test_run:TC-PERF-003}}/check/x]]", "{{report_id}}", "{{unknown}}"] }, (k) => b.get(k))).toEqual({
      a: "PLAN-0002",
      b: ["[[ev:RUN-0041/check/x]]", "RPT-0009", "{{unknown}}"],
    });
  });
});

describe("replay never contradicts a verdict", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await testServer();
  }, 60_000);
  afterAll(() => s?.close());

  it("prompt 4 asked first (fresh pools → the flap dataset) answers with the real FAIL, not the scripted pass", async () => {
    const session = s.ctx.agent.create("TB-01");
    let text = "";
    const unsub = s.ctx.hub.subscribe(session.id, (_q, e) => {
      if (e.type === "plan.proposed") setImmediate(() => s.ctx.agent.decidePlan(e.planId, { decision: "approve" }));
      if (e.type === "message.delta") text += e.text;
    });
    s.ctx.agent.postMessage(session.id, "Re-run the throughput test to confirm the environment issue.", { model: { provider: "replay", model: "replay" } });
    expect(await s.ctx.agent.waitIdle(session.id)).toBe("end");
    unsub();
    expect(text).toContain(OFF_SCRIPT);
    expect(text).toMatch(/\| TC-PERF-003 \| FAIL \| throughput: 845\.0 Mbps/);
    expect(text).not.toContain("**passed**");
  }, 60_000);
});

describe("pi-ai gateway mapping (faux provider in place of anthropic)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "bp-llm-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("streams text deltas, then the final pi-ai message with its tool calls", async () => {
    const deps = settingsFiles(dir);
    const cols = createCollections(deps);
    const faux = fauxProvider({ provider: "anthropic", models: [{ id: "claude-sonnet-5-5" }] });
    cols.api.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage([fauxText("Hello world"), fauxToolCall("list_tests", {})], { stopReason: "toolUse" })]);
    const gw = piAiGateway(deps, cols);
    const events: LlmEvent[] = [];
    for await (const e of gw.stream({ system: "s", messages: [{ role: "user", content: "hi", timestamp: 0 }], tools: [{ name: "list_tests", description: "d", parameters: { type: "object", properties: {} } }], model: { provider: "anthropic", model: "claude-sonnet-5-5" }, signal: new AbortController().signal }))
      events.push(e);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("Hello world");
    const done = events.at(-1)!;
    expect(done.type).toBe("done");
    expect(done.type === "done" && done.message.content.map((c) => c.type)).toEqual(["text", "toolCall"]);
  });

  it("maps provider failures to error events and refuses unconfigured ChatGPT", async () => {
    const deps = settingsFiles(dir);
    const cols = createCollections(deps);
    const faux = fauxProvider({ provider: "anthropic", models: [{ id: "claude-sonnet-5-5" }] });
    cols.api.setProvider(faux.provider); // no queued responses → the faux provider fails the request
    const gw = piAiGateway(deps, cols);
    const run = async (provider: "anthropic" | "chatgpt") => {
      const out: LlmEvent[] = [];
      for await (const e of gw.stream({ system: "s", messages: [{ role: "user", content: "hi", timestamp: 0 }], tools: [], model: { provider, model: provider === "chatgpt" ? "gpt-5.5" : "claude-sonnet-5-5" }, signal: new AbortController().signal }))
        out.push(e);
      return out.at(-1)!;
    };
    expect(await run("anthropic")).toMatchObject({ type: "error", aborted: false });
    expect(await run("chatgpt")).toMatchObject({ type: "error", message: expect.stringMatching(/Not signed in/) });
  });

  it("redacts secrets from provider error text", () => {
    expect(redact("401: invalid key sk-test-1234567890abcdef for org", ["sk-test-1234567890abcdef"])).toBe("401: invalid key •••• for org");
    expect(redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz", [])).toBe("Authorization: ••••");
  });
});

describe("settings and credentials (files under RUNTIME_DIR, keys write-only)", () => {
  let s: TestServer;
  beforeAll(async () => {
    s = await testServer();
  }, 60_000);
  afterAll(() => s?.close());

  it("stores a key, returns only a mask, and keeps settings across a DB reset", async () => {
    const key = "sk-ant-test-0000000000000000wxyz";
    const put = await s.app.request("/api/settings/llm", { ...json({ provider: { id: "anthropic", apiKey: key, model: "claude-opus-5-5" }, active: "anthropic" }), method: "PUT" });
    expect(put.status).toBe(200);
    const text = await (await s.app.request("/api/settings/llm")).text();
    expect(text).not.toContain(key);
    const st = JSON.parse(text) as LlmSettings;
    expect(st.active).toBe("anthropic");
    expect(st.providers.anthropic).toMatchObject({ configured: true, keyMasked: "••••wxyz", model: "claude-opus-5-5" });
    expect(st.models.anthropic).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(readFileSync(path.join(s.cfg.runtimeDir, "credentials.json"), "utf8")).toContain(key);
    expect(readFileSync(path.join(s.cfg.runtimeDir, "settings.json"), "utf8")).not.toContain(key);
    resetDb(s.ctx.db);
    expect(((await (await s.app.request("/api/settings/llm")).json()) as LlmSettings).active).toBe("anthropic");
  });

  it("refuses to activate an unconfigured provider and unknown models", async () => {
    expect((await s.app.request("/api/settings/llm", { ...json({ active: "custom" }), method: "PUT" })).status).toBe(400);
    expect((await s.app.request("/api/settings/llm", { ...json({ provider: { id: "openai", model: "gpt-nope" } }), method: "PUT" })).status).toBe(400);
    expect((await s.app.request("/api/settings/llm", { ...json({ provider: { id: "custom", baseUrl: "http://localhost:11434/v1", model: "llama3" }, active: "custom" }), method: "PUT" })).status).toBe(200);
    const replay = await s.app.request("/api/settings/llm/test", json({ provider: "replay" }));
    expect(await replay.json()).toMatchObject({ ok: true });
    expect(await (await s.app.request("/api/auth/chatgpt/status")).json()).toEqual({ connected: false });
  });
});

describe("transcript repair and recording", () => {
  const asst = (content: unknown[]): StoredMessage => ({ role: "assistant", content, api: "x", provider: "x", model: "m", usage: {}, stopReason: "toolUse", timestamp: 0 });
  it("answers unanswered tool calls, drops error markers, and bridges a stopped turn", () => {
    const stored: StoredMessage[] = [
      { role: "user", content: "a", timestamp: 0 },
      asst([{ type: "toolCall", id: "c1", name: "list_tests", arguments: {} }, { type: "toolCall", id: "c2", name: "list_tests", arguments: {} }]),
      { role: "toolResult", toolCallId: "c1", toolName: "list_tests", content: [{ type: "text", text: "[]" }], isError: false, timestamp: 0 },
      { role: "error", message: "boom", timestamp: 0 },
      { role: "user", content: "b", timestamp: 0 },
    ];
    const ctx = buildContext(stored);
    expect(ctx.map((m) => m.role)).toEqual(["user", "assistant", "toolResult", "toolResult", "assistant", "user"]);
    expect(ctx[3]).toMatchObject({ toolCallId: "c2", isError: true });
  });

  it("records a turn as replay steps with placeholders for ids from earlier results", () => {
    const msgs = buildContext([
      { role: "user", content: "Run the performance tests now", timestamp: 0 },
      asst([{ type: "toolCall", id: "c1", name: "propose_test_plan", arguments: { fw: "2.1.0" } }]),
      { role: "toolResult", toolCallId: "c1", toolName: "propose_test_plan", content: [{ type: "text", text: '{"plan_id":"PLAN-0007","decision":"approve"}' }], isError: false, timestamp: 0 },
      asst([{ type: "text", text: "Running PLAN-0007." }, { type: "toolCall", id: "c2", name: "run_test_plan", arguments: { plan_id: "PLAN-0007" } }]),
    ]);
    const steps = turnToSteps(msgs);
    expect(steps[0]).toMatchObject({ match: "(?i)Run\\s+the\\s+performance\\s+tests", prompt: "Run the performance tests now" });
    expect(steps[1]).toEqual({ text: "Running {{plan_id}}.", toolCalls: [{ name: "run_test_plan", args: { plan_id: "{{plan_id}}" } }] });
  });
});

describe("DB reset keeps nothing LLM-related in tables", () => {
  it("no settings or credential table exists", () => {
    const db = openDb(":memory:");
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    expect(tables.filter((t) => /setting|credential|secret|key/i.test(t))).toEqual([]);
    db.close();
  });
});
