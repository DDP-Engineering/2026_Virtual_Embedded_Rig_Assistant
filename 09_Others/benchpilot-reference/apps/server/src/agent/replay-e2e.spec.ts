// 06 P3 VERIFY: replay end-to-end through the HTTP API (demo-1: plan → approve → run → report with PERF fail,
// DNS pass, END fail), then demos 2–5 in the same session, reject and stop paths, and the contract that
// GET /sessions/:id equals the SSE stream folded with the shared reducer.
import { appendUserMessage, applySessionEvent, emptySessionState, type ReportDetail, type SessionDetail, type SessionEvent, type SessionSummary } from "@benchpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlan } from "../db/repos/plans.ts";
import { peekNextId } from "../db/repos/counters.ts";
import { NO_SCRIPT, REJECTED } from "../llm/replay.ts";
import { json, readSse, testServer, type TestServer } from "../test-support/server.ts";

let s: TestServer;

beforeAll(async () => {
  s = await testServer({ seed: true });
  s.ctx.settings.update((x) => ({ ...x, active: "replay" }));
}, 240_000);
afterAll(() => s?.close());

async function newSession(): Promise<string> {
  const res = await s.app.request("/api/sessions", json({ testbenchId: "TB-01" }));
  expect(res.status).toBe(201);
  return ((await res.json()) as SessionSummary).id;
}

/** One turn through the API; plans are decided by `decide` (default approve). Returns the turn's events. */
async function turn(sessionId: string, text: string, decide: (planId: string) => unknown = (id) => s.app.request(`/api/plans/${id}/decision`, json({ decision: "approve" }))) {
  const events: SessionEvent[] = [];
  const unsub = s.ctx.hub.subscribe(sessionId, (_seq, e) => {
    events.push(e);
    if (e.type === "plan.proposed") setImmediate(() => void decide(e.planId));
  });
  const res = await s.app.request(`/api/sessions/${sessionId}/messages`, json({ text }));
  expect(res.status).toBe(202);
  const posted = (await res.json()) as { turnId: string; messageId: string };
  await s.ctx.agent.waitIdle(sessionId);
  unsub();
  return { events, posted };
}

const of = <T extends SessionEvent["type"]>(events: SessionEvent[], type: T) => events.filter((e): e is Extract<SessionEvent, { type: T }> => e.type === type);
const report = async (id: string) => (await (await s.app.request(`/api/reports/${id}`)).json()) as ReportDetail;
const verdicts = (r: ReportDetail) => Object.fromEntries(r.runs.map((x) => [x.testId, x.verdict]));

function expectCleanTurn(events: SessionEvent[]) {
  expect(of(events, "turn.done").at(-1)?.stopReason).toBe("end");
  expect(of(events, "error")).toEqual([]);
  expect(of(events, "tool.done").filter((e) => !e.ok)).toEqual([]);
  const citations = of(events, "message.done").flatMap((e) => e.citations);
  expect(citations.filter((c) => !c.valid)).toEqual([]);
  return citations;
}

describe("replay end-to-end (07 demo)", () => {
  let sessionId: string;

  it("demo-1: plan → approve → run → RPT-0009 (PERF fail, DNS pass, END fail); snapshot == folded SSE stream", async () => {
    sessionId = await newSession();
    const prompt = "Run the performance tests for firmware 2.1.0.";
    // Subscribe to the stream before posting, as the web client does after loading the snapshot.
    const sse = await s.app.request(`/api/sessions/${sessionId}/events?since=0`);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const streamed = readSse(sse, (e) => e.type === "turn.done");
    const { events, posted } = await turn(sessionId, prompt);
    const stream = await streamed;

    const citations = expectCleanTurn(events);
    expect(citations.length).toBeGreaterThanOrEqual(5);
    expect(of(events, "skill.loaded").map((e) => e.name)).toEqual(["test-planner"]);
    const proposed = of(events, "plan.proposed")[0]!;
    expect(proposed.items.map((i) => i.testId)).toEqual(["TC-PERF-003", "TC-DNS-005", "TC-END-004"]);
    expect(of(events, "plan.decided")[0]).toMatchObject({ planId: proposed.planId, decision: "approve" });
    expect(of(events, "run.completed")[0]).toMatchObject({ reportId: "RPT-0009", summary: { passed: 1, failed: 2, errored: 0, total: 3 } });
    expect(verdicts(await report("RPT-0009"))).toEqual({ "TC-PERF-003": "fail", "TC-DNS-005": "pass", "TC-END-004": "fail" });
    expect(getPlan(s.ctx.db, proposed.planId)?.status).toBe("done");
    const tools = of(events, "tool.started").map((e) => e.name);
    expect(tools.indexOf("propose_test_plan")).toBeLessThan(tools.indexOf("run_test_plan"));

    // Contract: the SSE stream, folded by the shared reducer after the optimistic user message, equals the snapshot.
    expect(stream.map((x) => x.event)).toEqual(events);
    const folded = stream.reduce((st, x) => applySessionEvent(st, x.event), appendUserMessage(emptySessionState(), posted.messageId, prompt));
    const detail = (await (await s.app.request(`/api/sessions/${sessionId}`)).json()) as SessionDetail;
    const { session, seq, ...snapshot } = detail;
    expect(snapshot).toEqual(folded);
    expect(seq).toBe(stream.at(-1)!.id);
    expect(session).toMatchObject({ id: sessionId, title: prompt, status: "idle", lastReportId: "RPT-0009", provider: "replay" });

    // Resume: Last-Event-ID replays exactly the events after it.
    const mid = stream[Math.floor(stream.length / 2)]!.id;
    const resumed = await readSse(await s.app.request(`/api/sessions/${sessionId}/events`, { headers: { "Last-Event-ID": String(mid) } }), (e) => e.type === "turn.done");
    expect(resumed.map((x) => x.id)).toEqual(stream.filter((x) => x.id > mid).map((x) => x.id));
  }, 120_000);

  it("demo-2: analysis with an environment and a product-bug cluster, plus a ticket draft", async () => {
    const { events } = await turn(sessionId, "Analyze the root cause of the failures in RPT-0009.");
    expectCleanTurn(events);
    const r = await report("RPT-0009");
    expect(r.analysis?.clusters.map((c) => c.category)).toEqual(["environment", "product_bug"]);
    expect(r.analysis?.skill).toBe("endurance-tester");
    expect(r.tickets.map((t) => t.component)).toEqual(["mesh-agent"]);
  }, 60_000);

  it("demo-3: DHCP + IPv6 on 2.1.0 both fail (RPT-0010); telemetry is the new plaintext endpoint", async () => {
    const { events } = await turn(sessionId, "Compare firmware 2.1.0 with 2.0.4. What changed, and is 2.1.0 release-ready?");
    expectCleanTurn(events);
    expect(verdicts(await report("RPT-0010"))).toEqual({ "TC-DHCP-001": "fail", "TC-IPV6-002": "fail" });
    const traffic = of(events, "tool.done").find((e) => e.summary.includes("added"));
    expect(traffic?.preview).toContain("telemetry.vendor.example");
    const r = await report("RPT-0010");
    expect(r.analysis?.clusters.map((c) => c.category)).toEqual(["product_bug", "product_bug", "security"]);
  }, 60_000);

  it("demo-4: the throughput re-run passes (RPT-0011)", async () => {
    const { events } = await turn(sessionId, "Re-run the throughput test to confirm the environment issue.");
    expectCleanTurn(events);
    expect(verdicts(await report("RPT-0011"))).toEqual({ "TC-PERF-003": "pass" });
  }, 60_000);

  it("demo-5: DNS reliability answer cites history, packets and lab notes", async () => {
    const { events } = await turn(sessionId, "Is TC-DNS-005 a reliable test?");
    const citations = expectCleanTurn(events);
    expect(citations.map((c) => c.ref)).toContain("ev:TB-01/doc/docs/lab-notes.md#2026-10-03");
    expect(of(events, "tool.started").filter((e) => e.name === "query_packets")).toHaveLength(3);
  }, 60_000);

  it("reject: nothing runs, the plan is rejected and the pools are untouched", async () => {
    const id = await newSession();
    const next = peekNextId(s.ctx.db, "RPT");
    const { events } = await turn(id, "Run the performance tests for firmware 2.1.0.", (planId) =>
      s.app.request(`/api/plans/${planId}/decision`, json({ decision: "reject", comment: "not today" })),
    );
    expect(of(events, "turn.done").at(-1)?.stopReason).toBe("end");
    expect(of(events, "tool.started").map((e) => e.name)).not.toContain("run_test_plan");
    expect(of(events, "plan.decided")[0]).toMatchObject({ decision: "reject", comment: "not today" });
    const text = of(events, "message.delta").map((e) => e.text).join("");
    expect(text).toContain(REJECTED);
    expect(peekNextId(s.ctx.db, "RPT")).toBe(next);
  }, 60_000);

  it("stop while the plan is pending: turn aborted, plan cancelled, decision then refused (409)", async () => {
    const id = await newSession();
    let planId = "";
    const { events } = await turn(id, "Run the performance tests for firmware 2.1.0.", async (p) => {
      planId = p;
      expect((await s.app.request(`/api/sessions/${id}/messages`, json({ text: "again" }))).status).toBe(409);
      await s.app.request(`/api/sessions/${id}/stop`, { method: "POST" });
    });
    expect(of(events, "turn.done").at(-1)?.stopReason).toBe("aborted");
    expect(getPlan(s.ctx.db, planId)?.status).toBe("rejected");
    const detail = (await (await s.app.request(`/api/sessions/${id}`)).json()) as SessionDetail;
    expect(detail.items.find((i) => i.kind === "plan")).toMatchObject({ plan: { status: "cancelled" } });
    expect((await s.app.request(`/api/plans/${planId}/decision`, json({ decision: "approve" }))).status).toBe(409);
    // The session continues: the next turn sees a repaired transcript.
    const after = await turn(id, "Hello there");
    expect(of(after.events, "turn.done").at(-1)?.stopReason).toBe("end");
  }, 60_000);

  it("an unscripted prompt gets the replay fallback answer", async () => {
    const id = await newSession();
    const { events } = await turn(id, "What is the weather like?");
    expect(of(events, "message.delta").map((e) => e.text).join("")).toBe(NO_SCRIPT);
  });
});
