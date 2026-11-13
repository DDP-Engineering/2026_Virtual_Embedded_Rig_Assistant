// apply_candidate under the session's permission modes: hidden in read-only, approved or denied in ask, applied by
// auto-edit and bypass, and offered only when the host enables it (the desktop does so with the official kicad-layout plugin).
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as core from "../index.js";
import type { LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";

const SOURCE = "(kicad_pcb\n\t(version 20260206)\n\t(at 140 125)\n)\n";
const CANDIDATE = "(kicad_pcb\n\t(version 20260206)\n\t(at 124 112 90)\n)\n";
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});

async function setup(offered = true) {
  const root = await mkdtemp(join(tmpdir(), "vera-apply-session-"));
  closes.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "boards"));
  await mkdir(join(root, "electronics-results/r1/candidate"), { recursive: true });
  await writeFile(join(root, "boards/main.kicad_pcb"), SOURCE);
  await writeFile(join(root, "electronics-results/r1/candidate/main.kicad_pcb"), CANDIDATE);
  await writeFile(
    join(root, "electronics-results/r1/state.json"),
    JSON.stringify({
      format: 1,
      kind: "kicad-layout-state",
      runId: "r1",
      tool: "kicad-layout-tool",
      toolVersion: "1.0.0",
      kicad: "10.0.8",
      source: { path: "boards/main.kicad_pcb", sha256: hash(SOURCE), bytes: SOURCE.length },
      candidate: { path: "candidate/main.kicad_pcb", sha256: hash(CANDIDATE), memorySha256: "0".repeat(64) },
      editor: { pid: 1 },
      edits: 1,
      objectives: { status: "pass" },
    }),
  );
  await writeFile(
    join(root, "scripts/apply.jsonl"),
    [{ toolCalls: [{ name: "apply_candidate", args: { run: "electronics-results/r1" } }] }, { text: "Done" }]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  closes.push(async () => handle.close());
  const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  const catalogs: string[][] = [];
  const host: core.SessionHost = {
    root,
    db: handle.db,
    gateway: {
      selectedModel: (id) => gateway.selectedModel(id),
      capabilities: (model) => gateway.capabilities(model),
      models: (id, signal) => gateway.models(id, signal),
      async *stream(request: LlmRequest) {
        catalogs.push(request.tools?.map((tool) => tool.name) ?? []);
        yield* gateway.stream(request);
      },
    },
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/apply",
    prompt: () => "Test",
    ...(offered ? { applyCandidate: true } : {}),
  };
  const service = new core.SessionService(host);
  closes.push(() => service.close());
  await service.waitReady();
  const board = () => readFile(join(root, "boards/main.kicad_pcb"), "utf8");
  return { root, handle, service, catalogs, board };
}

async function waiting(service: core.SessionService, id: string) {
  await expect
    .poll(() => service.get(id).snapshot.approvals.find((approval) => !approval.decision), { timeout: 2000 })
    .toBeDefined();
  const approval = service.get(id).snapshot.approvals.find((item) => !item.decision);
  if (!approval) throw Error("Pending approval disappeared");
  return approval;
}

it("asks for approval in ask mode and writes only when approved (REQ-FUNC-73b4e5d0, REQ-SEC-854495d1)", async () => {
  for (const decision of ["denied", "approved"] as const) {
    const { service, board, handle } = await setup();
    const session = service.create(null, "ask");
    service.send(session.id, "apply");
    const approval = await waiting(service, session.id);
    expect(approval).toMatchObject({ tool: "apply_candidate", path: "boards/main.kicad_pcb" });
    expect(approval.diff).toContain("+\t(at 124 112 90)");
    expect(await board()).toBe(SOURCE);
    service.decideApproval({
      sessionId: session.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision,
    });
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    expect(await board()).toBe(decision === "approved" ? CANDIDATE : SOURCE);
    const applied = handle.db.prepare("SELECT * FROM changes WHERE status='applied'").all();
    expect(applied.length).toBe(decision === "approved" ? 1 : 0);
  }
});

it("applies in auto-edit mode without a prompt (REQ-FUNC-73b4e5d0)", async () => {
  const { service, board, handle } = await setup();
  const session = service.create(null, "auto-edit");
  service.send(session.id, "apply");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  expect(await board()).toBe(CANDIDATE);
  expect(handle.db.prepare("SELECT decided_by FROM approvals").get()).toEqual({ decided_by: "mode" });
});

it("applies in bypass mode without a prompt (REQ-FUNC-73b4e5d0)", async () => {
  const { service, board, handle } = await setup();
  const session = service.create(null, "bypass");
  service.send(session.id, "apply");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  expect(await board()).toBe(CANDIDATE);
  expect(handle.db.prepare("SELECT decided_by FROM approvals").get()).toEqual({ decided_by: "mode" });
});

it("never offers or runs apply_candidate in read-only mode (REQ-SEC-c986d8f2)", async () => {
  const { service, board, catalogs, handle } = await setup();
  const session = service.create(null, "read-only");
  service.send(session.id, "apply");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  expect(catalogs.length).toBeGreaterThan(0);
  for (const catalog of catalogs) expect(catalog).not.toContain("apply_candidate");
  expect(await board()).toBe(SOURCE);
  expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
});

it("offers apply_candidate only when the host enables it (REQ-FUNC-3f443814)", async () => {
  const { service, board, catalogs } = await setup(false);
  const session = service.create(null, "auto-edit");
  service.send(session.id, "apply");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  for (const catalog of catalogs) expect(catalog).not.toContain("apply_candidate");
  expect(await board()).toBe(SOURCE);
});

it("names the official kicad-layout plugin as the only one that enables apply_candidate (REQ-FUNC-3f443814)", () => {
  const plugin = (id: string, tier: string) =>
    ({ manifest: { id }, record: { tier } }) as Parameters<typeof core.officialLayoutPlugin>[0];
  expect(core.officialLayoutPlugin(plugin("kicad-layout", "official"))).toBe(true);
  expect(core.officialLayoutPlugin(plugin("kicad-layout", "local"))).toBe(false);
  expect(core.officialLayoutPlugin(plugin("kicad", "official"))).toBe(false);
});
