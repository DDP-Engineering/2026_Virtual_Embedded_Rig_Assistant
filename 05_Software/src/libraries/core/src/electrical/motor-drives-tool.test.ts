// motor_drives on a temporary workbench (spec REQ-DATA-79118f9a "Request", "Result written"): it builds on stored,
// current electrical-network and protection-coordination results, prepares one new result file, leaves the model as
// it is, goes stale with the motors it read and refuses a stale, missing or foreign protection result.
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
  root = await mkdtemp(join(tmpdir(), "vera-motor-drives-"));
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
  await writeFile(join(root, MODEL), await readFile(new URL("motor-drives/plant-m.json", fixtures)));
  await writeFile(
    join(root, "electrical-automation-tables/tbl-test-cu-pvc.json"),
    await readFile(new URL("electrical-network/tbl-test-cu-pvc.json", fixtures)),
  );
  await writeFile(
    join(root, "electrical-automation-catalogs/cat-motor-drives.json"),
    await readFile(new URL("motor-drives/cat-motor-drives.json", fixtures)),
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
async function applied(prepared: Promise<api.PreparedChange>): Promise<string> {
  const change = await prepared;
  await change.apply(signal());
  return runOf(change);
}
/** Network and protection results stored like the agent would, in that order. */
async function upstream(): Promise<{ network: string; protection: string }> {
  const network = await applied(
    api.prepareElectricalNetwork(
      context(),
      {
        cableTable: "tbl-test-cu-pvc",
        voltageTolerance: 10,
        scenarios: [{ id: "normal", title: "Normal operation" }],
        voltageDropLimit: { value: 4, unit: "%" },
      },
      signal(),
    ),
  );
  const protection = await applied(
    api.prepareProtectionCoordination(
      context(),
      {
        network,
        catalog: "cat-motor-drives",
        breakingCapacity: "Icu",
        circuits: [
          { circuit: "cir-m1", candidates: ["itm-gv2me10"], setting: 4.6 },
          { circuit: "cir-m2", candidates: ["itm-c10g32"] },
        ],
        starters: [{ circuit: "cir-m2", protection: "itm-c10g32", contactor: "itm-lc1d18p7", type: 2 }],
      },
      signal(),
    ),
  );
  return { network, protection };
}
const request = (protection: string) => ({
  protection,
  catalog: "cat-motor-drives",
  motors: [
    {
      motor: "mot-p2",
      startingCurrentMax: 70,
      switchover: 0.8,
      protection: "itm-c10g32",
      contactor: "itm-lc1d18p7",
      starContactor: "itm-lc1d09p7",
      overloadRelay: "itm-lrd21",
    },
  ],
});
const updateMotor = async (id: string, property: string, value: number, unit: string) =>
  (
    await api.prepareElectricalModelChange(
      context(),
      {
        operations: [
          { op: "update-object", id, properties: { [property]: { value, unit, basis: "input" } } },
        ],
      },
      signal(),
    )
  ).apply(signal());

describe("motor_drives (REQ-FUNC-285949c8)", () => {
  it("prepares one new result from current results, leaves the model as it is and reports the scheme", async () => {
    const { network, protection } = await upstream();
    const before = await readFile(join(root, MODEL));
    const prepared = await api.prepareMotorDrives(context(), request(protection), signal());
    expect(prepared.request).toMatchObject({ tool: "motor_drives", existed: false, beforeSha256: null });
    expect(api.motorDrivesTool.class).toBe("write");
    const result = await prepared.apply(signal());
    expect(result).toMatchObject({ path: pathOf(prepared), status: "incomplete" });
    expect(String(result.report)).toContain("## Assembly M2 (mot-p2) - star-delta");
    const written = JSON.parse(await readFile(join(root, pathOf(prepared)), "utf8"));
    expect("result" in api.checkResult(written, runOf(prepared))).toBe(true);
    expect(written.catalog).toEqual({ id: "cat-motor-drives", version: "2026-11-15.1" });
    expect(written.conditions).toMatchObject({
      protectionRun: { text: protection },
      networkRun: { text: network },
      proposal1: { text: "mot-p2 star-delta" },
    });
    expect(written.assemblies[0]).toMatchObject({ motor: "mot-p2", circuit: "cir-m2", method: "star-delta" });
    expect(hash(await readFile(join(root, MODEL)))).toBe(hash(before));
    const again = await api.prepareMotorDrives(context(), request(protection), signal());
    await again.apply(signal());
    const second = JSON.parse(await readFile(join(root, pathOf(again)), "utf8"));
    expect(second.criteria).toEqual(written.criteria);
    expect(second.assemblies).toEqual(written.assemblies);
  });

  it("goes stale when the motor changes and then refuses the stale protection result (REQ-REL-6bf4730e)", async () => {
    const { protection } = await upstream();
    const motorRun = await applied(api.prepareMotorDrives(context(), request(protection), signal()));
    await updateMotor("mot-p2", "loadInertia", 0.3, "kg·m²");
    const listed = (await view({ view: "results" })) as { results: api.ResultEntry[] };
    expect(listed.results.find((entry) => entry.runId === motorRun)).toMatchObject({
      freshness: "stale",
      changed: ["mot-p2"],
    });
    // The protection result read the motor too (its circuit feeds it), so it is stale and refused.
    await expect(api.prepareMotorDrives(context(), request(protection), signal())).rejects.toThrow(
      /protection-coordination result .* is stale \(changed: mot-p2; removed: none\): run protection_coordination again/,
    );
  });

  it("refuses a missing or foreign protection result and a missing catalog before any write", async () => {
    await expect(
      api.prepareMotorDrives(context(), request("20260101-000000-0000"), signal()),
    ).rejects.toThrow(/does not exist/);
    const { network, protection } = await upstream();
    await expect(api.prepareMotorDrives(context(), request(network), signal())).rejects.toThrow(
      /was not produced by protection-coordination/,
    );
    await expect(
      api.prepareMotorDrives(context(), { ...request(protection), catalog: "cat-none" }, signal()),
    ).rejects.toThrow(/does not exist/);
    expect((await readdir(join(root, "electrical-automation-results"))).length).toBe(2);
  });
});

it("ships the motor-drives plugin in the electrical ecosystem, which enables only its own tool (REQ-SEC-4dfa2a5b)", async () => {
  const plugin = new URL("../../../../../plugins/motor-drives/", import.meta.url);
  const { manifest, issues } = validatePluginManifest(
    parse(await readFile(new URL("plugin.yaml", plugin), "utf8")),
  );
  expect(issues).toEqual([]);
  if (!manifest) throw Error("no manifest");
  expect(api.electricalModelPlugin({ manifest })).toBe(true);
  expect(api.electricalPluginTools.motor_drives).toBe(manifest.id);
  expect(api.electricalToolOffered("motor_drives", [manifest.id])).toBe(true);
  expect(api.electricalToolOffered("protection_coordination", [manifest.id])).toBe(false);
  expect(await readFile(new URL("skills/motor-starting/SKILL.md", plugin), "utf8")).toMatch(
    /^---\r?\nname: motor-starting\r?\n/,
  );
});
