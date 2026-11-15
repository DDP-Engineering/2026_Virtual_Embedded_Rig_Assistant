// protection_coordination on a temporary workbench (spec REQ-DATA-a5673202 "Request", "Result written"): it builds on a
// stored, current electrical-network result, prepares one new result file, leaves the model as it is, goes stale
// with the network inputs and refuses a stale, missing or foreign network result.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePluginManifest } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import * as api from "../index.js";

const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
const MODEL = "electrical-automation-model.json";
let root: string;
let storage: api.WorkbenchDatabase;
let queue: api.WriteQueue;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-protection-"));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "electrical-automation-tables"));
  await mkdir(join(root, "electrical-automation-catalogs"));
  storage = await api.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  new api.SessionsRepository(storage.db).create({
    id: "ses_test",
    title: "",
    created_at: "now",
    updated_at: "now",
    model_ref: null,
    permission_mode: "auto-edit",
    status: "idle",
    archived: 0,
  });
  queue = new api.WriteQueue();
  await writeFile(join(root, MODEL), await readFile(new URL("electrical-network/network-a.json", fixtures)));
  await writeFile(
    join(root, "electrical-automation-tables/tbl-test-cu-pvc.json"),
    await readFile(new URL("electrical-network/tbl-test-cu-pvc.json", fixtures)),
  );
  await writeFile(
    join(root, "electrical-automation-catalogs/cat-lv-protection.json"),
    await readFile(new URL("protection-coordination/cat-lv-protection.json", fixtures)),
  );
});
afterEach(async () => {
  storage?.close();
  await rm(root, { recursive: true, force: true });
});

function context() {
  return {
    ...api.createToolContext(root),
    change: {
      db: storage.db,
      queue,
      sessionId: "ses_test",
      turnId: "turn",
      callId: crypto.randomUUID(),
      now: () => "now",
      recorded: () => undefined,
    },
  };
}
const pathOf = (prepared: api.PreparedChange) => (prepared.request as { path: string }).path;
const runOf = (prepared: api.PreparedChange) => pathOf(prepared).split("/")[1] as string;
const view = (args: unknown) => api.electricalModelTool.execute(context(), args, signal());
async function networkRun(): Promise<string> {
  const prepared = await api.prepareElectricalNetwork(
    context(),
    {
      cableTable: "tbl-test-cu-pvc",
      voltageTolerance: 10,
      scenarios: [{ id: "normal", title: "Normal operation" }],
      voltageDropLimit: { value: 4, unit: "%" },
    },
    signal(),
  );
  await prepared.apply(signal());
  return runOf(prepared);
}
const request = (network: string) => ({
  network,
  catalog: "cat-lv-protection",
  breakingCapacity: "Icu",
  assumedInstantaneousTripTime: 0.1,
  circuits: [
    { circuit: "cir-f1", protection: "prt-q1", candidates: ["itm-a9f74340", "itm-c10g32"] },
    {
      circuit: "cir-l1",
      candidates: ["itm-a9f74216", "itm-c10g20"],
      disconnectionTime: 0.4,
    },
  ],
  starters: [],
});

describe("protection_coordination (REQ-FUNC-4dcdce2d)", () => {
  it("prepares one new result from the current network result and leaves the model as it is", async () => {
    const network = await networkRun();
    const before = await readFile(join(root, MODEL));
    const prepared = await api.prepareProtectionCoordination(context(), request(network), signal());
    expect(prepared.request).toMatchObject({
      tool: "protection_coordination",
      existed: false,
      beforeSha256: null,
    });
    expect(api.protectionCoordinationTool.class).toBe("write");
    const applied = await prepared.apply(signal());
    expect(applied).toMatchObject({ path: pathOf(prepared), status: "incomplete" });
    expect(String(applied.report)).toContain("LV protection");
    const written = JSON.parse(await readFile(join(root, pathOf(prepared)), "utf8"));
    expect("result" in api.checkResult(written, runOf(prepared))).toBe(true);
    expect(written.catalog).toEqual({ id: "cat-lv-protection", version: "2026-11-15.1" });
    expect(written.conditions.cableTable.text).toMatch(/^tbl-test-cu-pvc 1 sha256 [0-9a-f]{16} \(k 115\)$/);
    const networkResult = await api.readResultFile(root, network);
    const ids = written.inputs.map((input: { id: string }) => input.id);
    for (const input of networkResult.inputs) expect(ids).toContain(input.id);
    expect(hash(await readFile(join(root, MODEL)))).toBe(hash(before));
    // Same model, network result, catalog and request: the same criteria.
    const again = await api.prepareProtectionCoordination(context(), request(network), signal());
    await again.apply(signal());
    const second = JSON.parse(await readFile(join(root, pathOf(again)), "utf8"));
    expect(second.criteria).toEqual(written.criteria);
    const report = (await view({ view: "report", runId: runOf(prepared) })) as { report: string };
    expect(report.report).toMatch(/F1 \(cir-f1\).*breaking-capacity:A9F74340.*fail/s);
  });

  it("goes stale with the network inputs and then refuses the stale network result (REQ-REL-62b1aee8)", async () => {
    const network = await networkRun();
    const prepared = await api.prepareProtectionCoordination(context(), request(network), signal());
    await prepared.apply(signal());
    const change = await api.prepareElectricalModelChange(
      context(),
      {
        operations: [
          {
            op: "update-object",
            id: "cbl-w3",
            properties: { length: { value: 80, unit: "m", basis: "input" } },
          },
        ],
      },
      signal(),
    );
    await change.apply(signal());
    const listed = (await view({ view: "results" })) as { results: api.ResultEntry[] };
    const protection = listed.results.find((entry) => entry.runId === runOf(prepared));
    expect(protection).toMatchObject({ freshness: "stale", changed: ["cbl-w3"] });
    await expect(api.prepareProtectionCoordination(context(), request(network), signal())).rejects.toThrow(
      /is stale \(changed: cbl-w3; removed: none\): run electrical_network again/,
    );
  });

  it("refuses a missing or foreign network result and a missing catalog before any write", async () => {
    await expect(
      api.prepareProtectionCoordination(context(), request("20260101-000000-0000"), signal()),
    ).rejects.toThrow(/does not exist/);
    const network = await networkRun();
    const prepared = await api.prepareProtectionCoordination(context(), request(network), signal());
    await prepared.apply(signal());
    await expect(
      api.prepareProtectionCoordination(context(), request(runOf(prepared)), signal()),
    ).rejects.toThrow(/was not produced by electrical-network/);
    await expect(
      api.prepareProtectionCoordination(context(), { ...request(network), catalog: "cat-none" }, signal()),
    ).rejects.toThrow(/does not exist/);
    expect((await readdir(join(root, "electrical-automation-results"))).length).toBe(2);
  });

  it("leaves k unknown when the cable table changed after the network run", async () => {
    const network = await networkRun();
    const path = join(root, "electrical-automation-tables/tbl-test-cu-pvc.json");
    const table = JSON.parse(await readFile(path, "utf8"));
    table.version = "2";
    await writeFile(path, JSON.stringify(table));
    const prepared = await api.prepareProtectionCoordination(context(), request(network), signal());
    await prepared.apply(signal());
    const written = JSON.parse(await readFile(join(root, pathOf(prepared)), "utf8"));
    expect(written.conditions.cableTable.text).toBe(
      "cable table tbl-test-cu-pvc changed since the network run",
    );
    const letThrough = written.criteria.find(
      (entry: { id: string }) => entry.id === "let-through-energy:C10G20",
    );
    expect(letThrough).toMatchObject({ verdict: "unknown" });
  });
});

it("ships the protection-coordination plugin in the electrical ecosystem, which enables the tool (REQ-SEC-4dfa2a5b)", async () => {
  const plugin = new URL("../../../../../plugins/protection-coordination/", import.meta.url);
  const { manifest, issues } = validatePluginManifest(
    parse(await readFile(new URL("plugin.yaml", plugin), "utf8")),
  );
  expect(issues).toEqual([]);
  if (!manifest) throw Error("no manifest");
  expect(api.electricalModelPlugin({ manifest })).toBe(true);
  expect(api.electricalToolNames).toContain("protection_coordination");
  expect(await readFile(new URL("skills/protection-selection/SKILL.md", plugin), "utf8")).toMatch(
    /^---\r?\nname: protection-selection\r?\n/,
  );
});
