// 04 §1/§3 tool output caps and argument guards (mandatory P3 case): results ≤ 12 000 chars with `truncated`,
// row limits ≤ 200, tshark row/timeout caps, invalid filters → {error}, no paths from the model.
import type { PlanItem } from "@benchpilot/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlan, decidePlan } from "../db/repos/plans.ts";
import { getTestbenchConfig, insertDoc } from "../db/repos/testbenches.ts";
import { testServer, type TestServer } from "../test-support/server.ts";
import { TsharkError, tsharkLines } from "../tshark.ts";
import { capturePath } from "./packets.ts";
import { capResult, executeTool, PREVIEW_CAP, RESULT_CAP, type ToolContext } from "./registry.ts";

let s: TestServer;
let ctx: ToolContext;
let endRun: string;
let dnsRun: string;
const call = (name: string, args: unknown) => executeTool(s.ctx.registry, ctx, name, args);

beforeAll(async () => {
  s = await testServer();
  ctx = {
    db: s.ctx.db,
    config: s.cfg,
    catalog: s.ctx.catalog,
    skills: s.ctx.skills,
    pools: s.ctx.pools(),
    testbench: getTestbenchConfig(s.ctx.db, "TB-01")!,
    sessionId: "S-0001",
    signal: new AbortController().signal,
    emit: () => {},
    approvals: s.ctx.approvals,
    loadedSkills: () => [],
  };
  const items: PlanItem[] = ["TC-END-004", "TC-DNS-005"].map((id) => {
    const t = s.ctx.catalog.get(id)!;
    return { testId: id, rationale: "r", name: t.name, version: t.version, duration: t.duration };
  });
  const p = createPlan(s.ctx.db, { sessionId: "S-0001", testbenchId: "TB-01", title: "t", device: "RTR-AX3000", fw: "2.1.0", items, rationale: "r" });
  decidePlan(s.ctx.db, p.id, { decision: "approve" });
  const r = JSON.parse((await call("run_test_plan", { plan_id: p.id })).text) as { results: { test_id: string; test_run_id: string }[] };
  endRun = r.results.find((x) => x.test_id === "TC-END-004")!.test_run_id;
  dnsRun = r.results.find((x) => x.test_id === "TC-DNS-005")!.test_run_id;
}, 120_000);
afterAll(() => s?.close());

describe("capResult", () => {
  it("leaves small results alone", () => {
    expect(capResult({ a: [1, 2, 3] })).toEqual({ text: '{"a":[1,2,3]}', truncated: false });
  });

  it("halves the largest array until the JSON fits, and marks it", () => {
    const big = { name: "x", rows: Array.from({ length: 2000 }, (_, i) => ({ i, text: "lorem ipsum dolor sit amet" })) };
    const { text, truncated } = capResult(big);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(RESULT_CAP);
    const parsed = JSON.parse(text) as { rows: unknown[]; truncated: boolean; omitted: number; name: string };
    expect(parsed).toMatchObject({ name: "x", truncated: true });
    expect(parsed.rows.length + parsed.omitted).toBe(2000);
  });

  it("cuts long text with a marker", () => {
    const { text, truncated } = capResult("y".repeat(50_000));
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(RESULT_CAP);
    expect(text).toMatch(/truncated/);
  });
});

describe("tool outputs stay within the caps", () => {
  it("200 raw syslog lines (~50 kB) are cut to ≤ 12 000 chars and flagged; the preview is ≤ 2 000", async () => {
    const o = await call("search_logs", { test_run_id: endRun, limit: 200 });
    expect(o.ok).toBe(true);
    expect(o.text.length).toBeLessThanOrEqual(RESULT_CAP);
    expect(o.truncated).toBe(true);
    expect(JSON.parse(o.text).truncated).toBe(true);
    expect(o.preview.length).toBeLessThanOrEqual(PREVIEW_CAP);
    expect(o.summary).toMatch(/truncated/);
  });

  it("row limits above 200 are rejected by the schema", async () => {
    const o = await call("search_logs", { test_run_id: endRun, query: "mesh-agent", limit: 500 });
    expect(o.ok).toBe(false);
    expect(JSON.parse(o.text).error).toMatch(/Invalid arguments.*limit/);
  });

  it("search_logs returns at most `limit` lines and says when there are more", async () => {
    const o = await call("search_logs", { test_run_id: endRun, limit: 5 });
    const r = JSON.parse(o.text) as { lines: { ev: string }[]; truncated?: boolean };
    expect(r.lines).toHaveLength(5);
    expect(r.truncated).toBe(true);
    expect(r.lines[0]!.ev).toMatch(new RegExp(`^ev:${endRun}/log/`));
  });

  it("regex args longer than 200 chars are refused", async () => {
    const o = await call("search_logs", { test_run_id: endRun, regex: "a".repeat(201) });
    expect(o.ok).toBe(false);
  });

  it("read_testbench_doc caps documents at 8 000 chars", async () => {
    insertDoc(s.ctx.db, "TB-01", { path: "docs/huge.md", title: "Huge", content: `# Huge\n\n${"word ".repeat(5000)}`, pinned: false });
    const r = JSON.parse((await call("read_testbench_doc", { path: "docs/huge.md" })).text) as { markdown: string; truncated: boolean };
    expect(r.markdown.length).toBe(8000);
    expect(r.truncated).toBe(true);
  });
});

describe("query_packets (tshark guards)", () => {
  it("stops at `limit` rows and flags truncation", async () => {
    const r = JSON.parse((await call("query_packets", { test_run_id: dnsRun, capture: "capture-lan", display_filter: "frame", limit: 5 })).text);
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
    expect(r.rows[0]).toMatchObject({ frame: 1, ev: `ev:${dnsRun}/pcap/capture-lan/1` });
  });

  it("returns {error} with tshark's message for an invalid display filter", async () => {
    const o = await call("query_packets", { test_run_id: dnsRun, capture: "capture-lan", display_filter: "dns.tiem > 0.02" });
    expect(o.ok).toBe(false);
    expect(JSON.parse(o.text).error).toMatch(/dns\.tiem/);
  });

  it("only opens the run's own captures: no paths, no traversal, no option injection", async () => {
    for (const capture of ["../../../data/ground_truth", "C:\\Windows\\win.ini", "capture-lan/../../x"]) {
      const o = await call("query_packets", { test_run_id: dnsRun, capture, display_filter: "frame" });
      expect(JSON.parse(o.text).error).toMatch(/No capture/);
    }
    const run = (await import("../db/repos/runs.ts")).getTestRun(s.ctx.db, dnsRun)!;
    expect(capturePath(s.cfg.runtimeDir, { ...run, artifacts: [{ name: "evil", type: "pcapng", path: "../../data/ground_truth.json" }] }, "evil")).toBeNull();
    const field = await call("query_packets", { test_run_id: dnsRun, capture: "capture-lan", display_filter: "frame", fields: ["-r"] });
    expect(field.ok).toBe(false);
    const multi = await call("query_packets", { test_run_id: dnsRun, capture: "capture-lan", display_filter: "frame\n-w x" });
    expect(multi.ok).toBe(false);
  });

  it("tshark calls time out", async () => {
    const file = capturePath(s.cfg.runtimeDir, (await import("../db/repos/runs.ts")).getTestRun(s.ctx.db, endRun)!, "capture-lan")!;
    await expect(tsharkLines(s.cfg.tsharkPath, ["-r", file, "-V"], { timeoutMs: 1, maxLines: 1_000_000 })).rejects.toThrow(TsharkError);
  });
});

describe("nothing agent-facing reaches ground_truth.json", () => {
  it("documents are read from the DB by exact path only", async () => {
    for (const p of ["../../data/ground_truth.json", "data/ground_truth.json", "/etc/passwd"]) {
      const o = await call("read_testbench_doc", { path: p });
      expect(JSON.parse(o.text).error).toMatch(/No document/);
    }
  });

  it("artifact downloads only serve the run's own files", async () => {
    expect((await s.app.request(`/api/runs/${dnsRun}/artifacts/..%2F..%2F..%2Fdata%2Fground_truth.json`)).status).toBe(404);
    const ok = await s.app.request(`/api/runs/${dnsRun}/artifacts/capture-lan.pcapng`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/vnd.tcpdump.pcap");
  });
});
