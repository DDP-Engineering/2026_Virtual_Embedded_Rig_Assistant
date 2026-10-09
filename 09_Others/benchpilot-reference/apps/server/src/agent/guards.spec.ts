// 04 §3 guards (mandatory P3 cases): run_test_plan needs a plan that exists, belongs to this session, is approved,
// and runs once — enforced by the server, not the prompt. Plus the decision endpoint and the per-turn tool cap.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PlanItem, SessionEvent } from "@benchpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { peekNextId } from "../db/repos/counters.ts";
import { createPlan, decidePlan, getPlan } from "../db/repos/plans.ts";
import { getTestbenchConfig } from "../db/repos/testbenches.ts";
import { PlanNotRunnableError, runPlan } from "../runner/run-plan.ts";
import { executeTool, type ToolContext } from "../tools/registry.ts";
import { json, testServer, type TestServer } from "../test-support/server.ts";
import { MAX_TOOL_CALLS_PER_TURN } from "./loop.ts";

let s: TestServer;
let replayDir: string;

const step = (o: unknown) => JSON.stringify(o);
beforeAll(async () => {
  replayDir = mkdtempSync(path.join(os.tmpdir(), "bp-replay-"));
  // A "model" that tries to run whatever plan id it is given, without proposing or waiting for approval.
  writeFileSync(
    path.join(replayDir, "sneaky.jsonl"),
    [step({ match: "(?i)^sneak (PLAN-\\d{4})", toolCalls: [{ name: "run_test_plan", args: { plan_id: "{{plan_id}}" } }] }), step({ text: "done" })].join("\n"),
  );
  writeFileSync(
    path.join(replayDir, "greedy.jsonl"),
    [
      step({ match: "(?i)^greedy", toolCalls: Array.from({ length: 20 }, () => ({ name: "list_tests", args: {} })) }),
      step({ toolCalls: Array.from({ length: 20 }, () => ({ name: "list_tests", args: {} })) }),
      step({ text: "should not be reached" }),
    ].join("\n"),
  );
  s = await testServer({ replayDir });
}, 60_000);
afterAll(async () => {
  await s?.close();
  rmSync(replayDir, { recursive: true, force: true });
});

const items = (...ids: string[]): PlanItem[] =>
  ids.map((id) => {
    const t = s.ctx.catalog.get(id)!;
    return { testId: id, rationale: "r", name: t.name, version: t.version, duration: t.duration };
  });
const plan = (sessionId: string | null, ...ids: string[]) =>
  createPlan(s.ctx.db, { sessionId, testbenchId: "TB-01", title: "t", device: "RTR-AX3000", fw: "2.1.0", items: items(...ids), rationale: "r" });

function toolCtx(sessionId: string): ToolContext {
  return {
    db: s.ctx.db,
    config: s.cfg,
    catalog: s.ctx.catalog,
    skills: s.ctx.skills,
    pools: s.ctx.pools(),
    testbench: getTestbenchConfig(s.ctx.db, "TB-01")!,
    sessionId,
    signal: new AbortController().signal,
    emit: () => {},
    approvals: s.ctx.approvals,
    loadedSkills: () => [],
  };
}
const run = (sessionId: string, planId: string) => executeTool(s.ctx.registry, toolCtx(sessionId), "run_test_plan", { plan_id: planId });

describe("run_test_plan approval guard", () => {
  it("refuses a pending plan, a rejected plan and an unknown plan — nothing runs", async () => {
    const before = peekNextId(s.ctx.db, "RPT");
    const pending = plan("S-0001", "TC-DNS-005");
    const rejected = plan("S-0001", "TC-DNS-005");
    decidePlan(s.ctx.db, rejected.id, { decision: "reject", comment: "no" });
    for (const [id, msg] of [
      [pending.id, /waiting for the user's decision/],
      [rejected.id, /was rejected/],
      ["PLAN-9999", /not found/],
    ] as const) {
      const o = await run("S-0001", id);
      expect(o.ok).toBe(false);
      expect(JSON.parse(o.text).error).toMatch(msg);
    }
    expect(getPlan(s.ctx.db, pending.id)?.status).toBe("pending");
    expect(peekNextId(s.ctx.db, "RPT")).toBe(before);
  });

  it("refuses an approved plan of another session (tool and runner both check)", async () => {
    const other = plan("S-0002", "TC-DNS-005");
    decidePlan(s.ctx.db, other.id, { decision: "approve" });
    const o = await run("S-0001", other.id);
    expect(o.ok).toBe(false);
    expect(JSON.parse(o.text).error).toMatch(/belongs to another session/);
    const cli = plan(null, "TC-DNS-005");
    decidePlan(s.ctx.db, cli.id, { decision: "approve" });
    expect((await run("S-0001", cli.id)).ok).toBe(false);
    // Defence in depth: the runner itself refuses a foreign session too.
    await expect(
      runPlan(
        { db: s.ctx.db, catalog: s.ctx.catalog, pools: s.ctx.pools(), dataDir: s.cfg.dataDir, runtimeDir: s.cfg.runtimeDir, tsharkPath: s.cfg.tsharkPath, demoSpeed: 0, emitter: { emit() {} } },
        other.id,
        { sessionId: "S-0001" },
      ),
    ).rejects.toThrow(PlanNotRunnableError);
    expect(getPlan(s.ctx.db, other.id)?.status).toBe("approved");
  });

  it("runs an approved plan of its own session exactly once, also under a concurrent double call", async () => {
    const p = plan("S-0001", "TC-DNS-005");
    decidePlan(s.ctx.db, p.id, { decision: "approve" });
    const [a, b] = await Promise.all([run("S-0001", p.id), run("S-0001", p.id)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const ok = a.ok ? a : b;
    expect(JSON.parse(ok.text)).toMatchObject({ plan_id: p.id, results: [{ test_id: "TC-DNS-005" }] });
    expect(JSON.parse((a.ok ? b : a).text).error).toMatch(/already running or done|already run/);
    expect(getPlan(s.ctx.db, p.id)?.status).toBe("done");
    const again = await run("S-0001", p.id);
    expect(JSON.parse(again.text).error).toMatch(/already run.*new approved plan/);
  }, 60_000);

  it("through the agent loop: a model calling run_test_plan on an unapproved plan gets an error result", async () => {
    s.ctx.settings.update((x) => ({ ...x, active: "replay" }));
    const session = s.ctx.agent.create("TB-01");
    const p = plan(session.id, "TC-PERF-003");
    const events: SessionEvent[] = [];
    const unsub = s.ctx.hub.subscribe(session.id, (_q, e) => events.push(e));
    s.ctx.agent.postMessage(session.id, `sneak ${p.id}`, { model: { provider: "replay", model: "sneaky" } });
    await s.ctx.agent.waitIdle(session.id);
    unsub();
    const done = events.find((e): e is Extract<SessionEvent, { type: "tool.done" }> => e.type === "tool.done")!;
    expect(done.ok).toBe(false);
    expect(done.summary).toMatch(/error/);
    expect(events.some((e) => e.type === "run.started")).toBe(false);
    expect(getPlan(s.ctx.db, p.id)?.status).toBe("pending");
  });
});

describe("POST /plans/:id/decision", () => {
  it("validates edits, refuses non-pending plans, and 404s unknown ids", async () => {
    const session = s.ctx.agent.create("TB-01");
    const p = plan(session.id, "TC-PERF-003", "TC-DNS-005");
    const bad = await s.app.request(`/api/plans/${p.id}/decision`, json({ decision: "approve", items: [{ testId: "TC-NOPE-999", rationale: "x" }] }));
    expect(bad.status).toBe(400);
    const badFw = await s.app.request(`/api/plans/${p.id}/decision`, json({ decision: "approve", fw: "9.9.9" }));
    expect(badFw.status).toBe(400);
    const events: SessionEvent[] = [];
    const unsub = s.ctx.hub.subscribe(session.id, (_q, e) => events.push(e));
    const ok = await s.app.request(`/api/plans/${p.id}/decision`, json({ decision: "approve", fw: "2.0.4", items: [{ testId: "TC-DNS-005", rationale: "" }] }));
    unsub();
    expect(ok.status).toBe(204);
    const decided = getPlan(s.ctx.db, p.id)!;
    expect(decided).toMatchObject({ status: "approved", fw: "2.0.4", items: [{ testId: "TC-DNS-005", name: "DNS latency", rationale: "r" }] });
    expect(events).toEqual([{ type: "plan.decided", planId: p.id, decision: "approve", fw: "2.0.4", items: decided.items }]);
    expect((await s.app.request(`/api/plans/${p.id}/decision`, json({ decision: "reject" }))).status).toBe(409);
    expect((await s.app.request(`/api/plans/PLAN-9999/decision`, json({ decision: "approve" }))).status).toBe(404);
  });
});

describe("tool-call cap", () => {
  it(`stops a turn after ${MAX_TOOL_CALLS_PER_TURN} tool calls (stopReason tool_cap)`, async () => {
    const session = s.ctx.agent.create("TB-01");
    const events: SessionEvent[] = [];
    const unsub = s.ctx.hub.subscribe(session.id, (_q, e) => events.push(e));
    s.ctx.agent.postMessage(session.id, "greedy", { model: { provider: "replay", model: "greedy" } });
    await s.ctx.agent.waitIdle(session.id);
    unsub();
    expect(events.filter((e) => e.type === "tool.started")).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    expect(events.at(-1)).toMatchObject({ type: "turn.done", stopReason: "tool_cap" });
    expect(events.some((e) => e.type === "message.delta" && e.text.includes("should not"))).toBe(false);
  });
});
