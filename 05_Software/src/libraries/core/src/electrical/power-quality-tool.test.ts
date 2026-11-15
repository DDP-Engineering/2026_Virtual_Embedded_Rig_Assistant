// power_quality on a temporary workbench (spec REQ-DATA-4dc5e2c7 "Request", "Result"): it builds on a stored, current
// electrical-network result and a measurement file of the board, prepares one new result file, leaves the model as it
// is, goes stale with the loads under the board and refuses stale, foreign or other-board inputs.
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
const MEASUREMENTS = "electrical-automation-measurements";
let root: string;
let storage: api.WorkbenchDatabase;
let queue: api.WriteQueue;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-power-quality-"));
  for (const folder of [
    ".vera",
    "electrical-automation-tables",
    "electrical-automation-catalogs",
    MEASUREMENTS,
  ])
    await mkdir(join(root, folder));
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
  await writeFile(join(root, MODEL), await readFile(new URL("power-quality-pfc/plant-q.json", fixtures)));
  await writeFile(
    join(root, "electrical-automation-tables/tbl-test-cu-pvc.json"),
    await readFile(new URL("electrical-network/tbl-test-cu-pvc.json", fixtures)),
  );
  await writeFile(
    join(root, "electrical-automation-catalogs/cat-pfc.json"),
    await readFile(new URL("power-quality-pfc/cat-pfc.json", fixtures)),
  );
  for (const name of ["meas-fictional-mdb-day.json", "meas-fictional-mdb-day.csv"])
    await writeFile(
      join(root, MEASUREMENTS, name),
      await readFile(new URL(`power-quality-pfc/${name}`, fixtures)),
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
const networkRun = () =>
  applied(
    api.prepareElectricalNetwork(
      context(),
      {
        cableTable: "tbl-test-cu-pvc",
        voltageTolerance: 10,
        scenarios: [
          { id: "day", title: "Day shift" },
          { id: "night", title: "Night", loads: { "lod-m1": 0.15, "lod-m2": 0.15, "lod-m3": 0.15 } },
        ],
        voltageDropLimit: { value: 4, unit: "%" },
      },
      signal(),
    ),
  );
const request = (network: string) => ({
  board: "brd-main",
  network,
  measurements: "meas-fictional-mdb-day",
  catalog: "cat-pfc",
  targetPowerFactor: 0.95,
  voltageTolerance: 10,
  resonanceMargin: 0.1,
  harmonicThreshold: 0.5,
  maxSteps: 12,
  harmonicGeneratorPower: 43,
  steps: [{ capacitor: "itm-blrch125a150b48" }],
  contactor: "itm-lc1dfkp7",
  protection: "itm-c10g32",
});

describe("power_quality (REQ-FUNC-7c320847)", () => {
  it("prepares one new result from a current network result and the measurements and leaves the model as it is", async () => {
    const network = await networkRun();
    const before = await readFile(join(root, MODEL));
    const prepared = await api.preparePowerQuality(context(), request(network), signal());
    expect(prepared.request).toMatchObject({ tool: "power_quality", existed: false, beforeSha256: null });
    expect(api.powerQualityTool.class).toBe("write");
    const result = await prepared.apply(signal());
    expect(result).toMatchObject({ path: pathOf(prepared), status: "incomplete" });
    expect(String(result.report)).toContain("Power factor correction");
    expect(String(result.report)).toMatch(/resonance:BLRCH125A150B48 \| fail/);
    const written = JSON.parse(await readFile(join(root, pathOf(prepared)), "utf8"));
    expect("result" in api.checkResult(written, runOf(prepared))).toBe(true);
    expect(written.producer).toMatchObject({ plugin: "power-quality-pfc", operation: "pfc" });
    expect(written.catalog).toEqual({ id: "cat-pfc", version: "2026-11-15.1" });
    const sha = hash(
      Buffer.concat([
        await readFile(join(root, MEASUREMENTS, "meas-fictional-mdb-day.json")),
        await readFile(join(root, MEASUREMENTS, "meas-fictional-mdb-day.csv")),
      ]),
    );
    expect(written.conditions).toMatchObject({
      networkRun: { text: network },
      bankType: { text: "automatic" },
      measurements: { text: `meas-fictional-mdb-day sha256 ${sha.slice(0, 16)} origin fictional rows 96` },
    });
    expect(written.inputs.map((entry: { id: string }) => entry.id)).toEqual(
      expect.arrayContaining(["brd-main", "lod-m1", "cir-v1", "sup-t1"]),
    );
    expect(hash(await readFile(join(root, MODEL)))).toBe(hash(before));
    const listed = (await view({ view: "results" })) as { results: api.ResultEntry[] };
    expect(listed.results.find((entry) => entry.runId === runOf(prepared))?.freshness).toBe("current");
  });

  it("goes stale when a load under the board changes and then refuses the stale network result (REQ-REL-0f24c593)", async () => {
    const network = await networkRun();
    const run = await applied(api.preparePowerQuality(context(), request(network), signal()));
    await (
      await api.prepareElectricalModelChange(
        context(),
        {
          operations: [
            {
              op: "update-object",
              id: "lod-v1",
              properties: { powerFactor: { value: 0.9, unit: "1", basis: "input" } },
            },
          ],
        },
        signal(),
      )
    ).apply(signal());
    const listed = (await view({ view: "results" })) as { results: api.ResultEntry[] };
    expect(listed.results.find((entry) => entry.runId === run)).toMatchObject({
      freshness: "stale",
      changed: ["lod-v1"],
    });
    await expect(api.preparePowerQuality(context(), request(network), signal())).rejects.toThrow(
      /electrical-network result .* is stale \(changed: lod-v1; removed: none\): run electrical_network again/,
    );
  });

  it("refuses a foreign result, another board's or an invalid measurement file before any write", async () => {
    const network = await networkRun();
    const own = await applied(api.preparePowerQuality(context(), request(network), signal()));
    await expect(api.preparePowerQuality(context(), request(own), signal())).rejects.toThrow(
      /was not produced by electrical-network/,
    );
    await expect(
      api.preparePowerQuality(context(), request("20260101-000000-0000"), signal()),
    ).rejects.toThrow(/does not exist/);
    const json = join(root, MEASUREMENTS, "meas-fictional-mdb-day.json");
    const text = await readFile(json, "utf8");
    await writeFile(json, text.replace('"board": "brd-main"', '"board": "brd-other"'));
    await expect(api.preparePowerQuality(context(), request(network), signal())).rejects.toThrow(
      /measures brd-other, not brd-main/,
    );
    await writeFile(json, text.replace('"unit": "kW"', '"unit": "kvar"'));
    await expect(api.preparePowerQuality(context(), request(network), signal())).rejects.toThrow(
      /Invalid measurement file/,
    );
    expect((await readdir(join(root, "electrical-automation-results"))).length).toBe(2);
  });
});

it("ships the power-quality-pfc plugin in the electrical ecosystem, which enables only its own tool (REQ-SEC-4dfa2a5b)", async () => {
  const plugin = new URL("../../../../../plugins/power-quality-pfc/", import.meta.url);
  const { manifest, issues } = validatePluginManifest(
    parse(await readFile(new URL("plugin.yaml", plugin), "utf8")),
  );
  expect(issues).toEqual([]);
  if (!manifest) throw Error("no manifest");
  expect(api.electricalModelPlugin({ manifest })).toBe(true);
  expect(api.electricalPluginTools.power_quality).toBe(manifest.id);
  expect(api.electricalToolOffered("power_quality", [manifest.id])).toBe(true);
  expect(api.electricalToolOffered("motor_drives", [manifest.id])).toBe(false);
  expect(await readFile(new URL("skills/power-factor-correction/SKILL.md", plugin), "utf8")).toMatch(
    /^---\r?\nname: power-factor-correction\r?\n/,
  );
});
