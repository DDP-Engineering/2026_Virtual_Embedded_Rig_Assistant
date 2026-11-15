// The electrical model tools under the session's permission modes: approved or denied in ask mode, applied by
// auto-edit, the change tool hidden in read-only mode, the model tools offered only with an electrical or automation
// plugin loaded and each plugin tool only with its own plugin.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as core from "../index.js";
import type { LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";

const FIXTURE = new URL(
  "../../../../../tests/fixtures/electrical-model/two-pump-panel.json",
  import.meta.url,
);
const MODEL = "electrical-automation-model.json";
const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});

async function setup(plugins: readonly string[] = ["electrical-network"]) {
  const root = await mkdtemp(join(tmpdir(), "vera-electrical-session-"));
  closes.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  const fixture = await readFile(FIXTURE, "utf8");
  await writeFile(join(root, MODEL), fixture);
  const operations = [{ op: "update-object", id: "mot-p1", name: "Duty pump" }];
  await writeFile(
    join(root, "scripts/change.jsonl"),
    [{ toolCalls: [{ name: "electrical_model_change", args: { operations } }] }, { text: "Done" }]
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
    model: () => "replay/change",
    prompt: () => "Test",
    electricalPlugins: plugins,
  };
  const service = new core.SessionService(host);
  closes.push(() => service.close());
  await service.waitReady();
  const model = () => readFile(join(root, MODEL), "utf8");
  return { handle, service, catalogs, model, fixture };
}

async function waiting(service: core.SessionService, id: string) {
  await expect
    .poll(() => service.get(id).snapshot.approvals.find((approval) => !approval.decision), { timeout: 2000 })
    .toBeDefined();
  const approval = service.get(id).snapshot.approvals.find((item) => !item.decision);
  if (!approval) throw Error("Pending approval disappeared");
  return approval;
}

it("asks for approval in ask mode and writes the model only when approved (REQ-FUNC-46374a53)", async () => {
  for (const decision of ["denied", "approved"] as const) {
    const { service, model, handle, fixture, catalogs } = await setup();
    const session = service.create(null, "ask");
    service.send(session.id, "rename the pump");
    const approval = await waiting(service, session.id);
    expect(approval).toMatchObject({ tool: "electrical_model_change", path: MODEL });
    expect(catalogs[0]).toEqual(
      expect.arrayContaining(["electrical_model", "electrical_model_change", "electrical_network"]),
    );
    for (const other of [
      "industrial_catalog",
      "protection_coordination",
      "motor_drives",
      "power_quality",
      "lighting_design",
      "qelectrotech",
      "qelectrotech_change",
      "qelectrotech_check",
      "panel_engineering",
      "panel_engineering_check",
    ])
      expect(catalogs[0]).not.toContain(other);
    expect(approval.diff).toContain('+      "name": "Duty pump"');
    expect(await model()).toBe(fixture);
    service.decideApproval({
      sessionId: session.id,
      approvalId: approval.approvalId,
      requestSha256: approval.requestSha256,
      decision,
    });
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    const written = await model();
    if (decision === "denied") expect(written).toBe(fixture);
    else expect(written).toContain('"name": "Duty pump"');
    const applied = handle.db.prepare("SELECT * FROM changes WHERE status='applied'").all();
    expect(applied.length).toBe(decision === "approved" ? 1 : 0);
  }
});

it("writes in auto-edit mode without a prompt (REQ-FUNC-46374a53)", async () => {
  const { service, model, handle } = await setup();
  const session = service.create(null, "auto-edit");
  service.send(session.id, "rename the pump");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  expect(await model()).toContain('"name": "Duty pump"');
  expect(handle.db.prepare("SELECT decided_by FROM approvals").get()).toEqual({ decided_by: "mode" });
});

it("offers only the read tools in read-only mode and writes nothing (REQ-SEC-4dfa2a5b)", async () => {
  const { service, model, catalogs, handle, fixture } = await setup([
    "industrial-catalog",
    "electrical-network",
    "protection-coordination",
    "motor-drives",
    "power-quality-pfc",
    "lighting-design",
    "qelectrotech",
    "panel-engineering",
  ]);
  const session = service.create(null, "read-only");
  service.send(session.id, "rename the pump");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  expect(catalogs.length).toBeGreaterThan(0);
  for (const catalog of catalogs) {
    expect(catalog).toContain("electrical_model");
    expect(catalog).toContain("industrial_catalog");
    expect(catalog).not.toContain("electrical_model_change");
    expect(catalog).not.toContain("electrical_network");
    expect(catalog).not.toContain("protection_coordination");
    expect(catalog).not.toContain("motor_drives");
    expect(catalog).not.toContain("power_quality");
    expect(catalog).not.toContain("lighting_design");
    expect(catalog).toContain("qelectrotech");
    expect(catalog).not.toContain("qelectrotech_change");
    expect(catalog).not.toContain("qelectrotech_check");
    expect(catalog).toContain("panel_engineering");
    expect(catalog).not.toContain("panel_engineering_check");
  }
  expect(await model()).toBe(fixture);
  expect(handle.db.prepare("SELECT * FROM changes").all()).toEqual([]);
});

it("offers no electrical tool without an electrical or automation plugin (REQ-SEC-4dfa2a5b)", async () => {
  const { service, model, catalogs, fixture } = await setup([]);
  const session = service.create(null, "auto-edit");
  service.send(session.id, "rename the pump");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  for (const catalog of catalogs) {
    expect(catalog).not.toContain("electrical_model");
    expect(catalog).not.toContain("electrical_model_change");
    expect(catalog).not.toContain("industrial_catalog");
    expect(catalog).not.toContain("electrical_network");
    expect(catalog).not.toContain("protection_coordination");
    expect(catalog).not.toContain("motor_drives");
    expect(catalog).not.toContain("power_quality");
    expect(catalog).not.toContain("lighting_design");
  }
  expect(await model()).toBe(fixture);
});

it("offers each plugin tool only while its own plugin is loaded (REQ-SEC-4dfa2a5b)", () => {
  const offered = (plugins: string[]) =>
    core.electricalToolNames.filter((name) => core.electricalToolOffered(name, plugins));
  expect(offered([])).toEqual([]);
  expect(offered(["plc-engineering"])).toEqual(["electrical_model", "electrical_model_change"]);
  expect(offered(["protection-coordination"])).toEqual([
    "electrical_model",
    "electrical_model_change",
    "protection_coordination",
  ]);
  expect(
    offered([
      "industrial-catalog",
      "electrical-network",
      "protection-coordination",
      "motor-drives",
      "power-quality-pfc",
      "lighting-design",
      "qelectrotech",
      "panel-engineering",
    ]),
  ).toEqual(core.electricalToolNames);
  expect(core.electricalToolOffered("read", [])).toBe(true);
});

it("enables the electrical model for plugins of the electrical and automation ecosystems (REQ-SEC-4dfa2a5b)", () => {
  const plugin = (ecosystem: string) =>
    ({ manifest: { ecosystem } }) as Parameters<typeof core.electricalModelPlugin>[0];
  expect(core.electricalModelPlugin(plugin("electrical"))).toBe(true);
  expect(core.electricalModelPlugin(plugin("automation"))).toBe(true);
  expect(core.electricalModelPlugin(plugin("electronics"))).toBe(false);
});
