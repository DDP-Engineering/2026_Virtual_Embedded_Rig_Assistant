// electrical_network on a temporary workbench (spec REQ-DATA-42ce122f "Result written", "Report"): one prepared new
// result file, the model left as it is, freshness after a model change and the Markdown report of a stored result.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePluginManifest } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import * as api from "../index.js";

const fixtures = new URL("../../../../../tests/fixtures/electrical-network/", import.meta.url);
const MODEL = "electrical-automation-model.json";
const TABLE = "electrical-automation-tables/tbl-test-cu-pvc.json";
let root: string;
let storage: api.WorkbenchDatabase;
let queue: api.WriteQueue;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-network-"));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "electrical-automation-tables"));
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
  await writeFile(join(root, MODEL), await readFile(new URL("network-a.json", fixtures)));
  await writeFile(join(root, TABLE), await readFile(new URL("tbl-test-cu-pvc.json", fixtures)));
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
const request = {
  cableTable: "tbl-test-cu-pvc",
  voltageTolerance: 10,
  scenarios: [
    { id: "normal", title: "Normal operation", simultaneity: { "brd-main": 0.9 } },
    { id: "pump-off", title: "Pump stopped", loads: { "mot-p1": 0 } },
  ],
  voltageDropLimit: { value: 4, unit: "%" },
  voltageDropLimitLighting: { value: 3, unit: "%" },
};
const pathOf = (prepared: api.PreparedChange) => (prepared.request as { path: string }).path;
const view = (args: unknown) => api.electricalModelTool.execute(context(), args, signal());

describe("electrical_network (REQ-FUNC-f4654788)", () => {
  it("prepares one new result file, writes it on apply and leaves the model as it is", async () => {
    const before = await readFile(join(root, MODEL));
    const prepared = await api.prepareElectricalNetwork(context(), request, signal());
    expect(prepared.request).toMatchObject({
      tool: "electrical_network",
      existed: false,
      beforeSha256: null,
    });
    expect(pathOf(prepared)).toMatch(
      /^electrical-automation-results\/[0-9]{8}-[0-9]{6}-[0-9a-f]{4}\/result\.json$/,
    );
    expect(api.electricalNetworkTool.class).toBe("write");
    const applied = await prepared.apply(signal());
    expect(applied).toMatchObject({ path: pathOf(prepared), status: "incomplete" });
    expect(String(applied.report)).toContain("Radial LV network");
    const written = JSON.parse(await readFile(join(root, pathOf(prepared)), "utf8"));
    const runId = pathOf(prepared).split("/")[1] as string;
    expect("result" in api.checkResult(written, runId)).toBe(true);
    expect(written.inputs.map((input: { id: string }) => input.id)).toEqual(
      expect.arrayContaining(["prj-network-a", "sup-t1", "brd-main", "cir-m1", "cbl-w2", "mot-p1", "prt-q1"]),
    );
    expect(hash(await readFile(join(root, MODEL)))).toBe(hash(before));
    const listed = (await view({ view: "results" })) as { results: api.ResultEntry[] };
    expect(listed.results[0]).toMatchObject({
      runId,
      freshness: "current",
      producer: { plugin: "electrical-network" },
    });
  });

  it("lists the result stale after a cable change, naming the cable", async () => {
    const prepared = await api.prepareElectricalNetwork(context(), request, signal());
    await prepared.apply(signal());
    const change = await api.prepareElectricalModelChange(
      context(),
      {
        operations: [
          {
            op: "update-object",
            id: "cbl-w2",
            properties: { length: { value: 45, unit: "m", basis: "input" } },
          },
        ],
      },
      signal(),
    );
    await change.apply(signal());
    const listed = (await view({ view: "results" })) as { results: api.ResultEntry[] };
    expect(listed.results[0]).toMatchObject({ freshness: "stale", changed: ["cbl-w2"] });
  });

  it("never overwrites a file that appears at the run path", async () => {
    const prepared = await api.prepareElectricalNetwork(context(), request, signal());
    await mkdir(join(root, pathOf(prepared), ".."), { recursive: true });
    await writeFile(join(root, pathOf(prepared)), "someone else's");
    await expect(prepared.apply(signal())).rejects.toThrow();
    expect(await readFile(join(root, pathOf(prepared)), "utf8")).toBe("someone else's");
  });

  it("refuses an invalid or missing table and a missing model before any write (REQ-DATA-42ce122f)", async () => {
    const table = JSON.parse(await readFile(join(root, TABLE), "utf8"));
    table.cable.material = "silver";
    await writeFile(join(root, TABLE), JSON.stringify(table));
    await expect(api.prepareElectricalNetwork(context(), request, signal())).rejects.toThrow(
      /Invalid cable table/,
    );
    await expect(
      api.prepareElectricalNetwork(context(), { ...request, cableTable: "tbl-none" }, signal()),
    ).rejects.toThrow(/does not exist/);
    await rm(join(root, MODEL));
    await writeFile(join(root, TABLE), await readFile(new URL("tbl-test-cu-pvc.json", fixtures)));
    await expect(api.prepareElectricalNetwork(context(), request, signal())).rejects.toThrow(
      /no electrical model/,
    );
    await expect(readdir(join(root, "electrical-automation-results"))).rejects.toThrow();
  });
});

describe("electrical_model view report (REQ-FUNC-8b895a77)", () => {
  it("renders the stored result with method, scenarios, criteria, fault currents and table conditions", async () => {
    const prepared = await api.prepareElectricalNetwork(context(), request, signal());
    await prepared.apply(signal());
    const runId = pathOf(prepared).split("/")[1] as string;
    const report = (await view({ view: "report", runId })) as {
      runId: string;
      freshness: string;
      report: string;
    };
    expect(report).toMatchObject({ runId, freshness: "current" });
    const text = report.report;
    expect(text).toContain("Preliminary");
    expect(text).toContain("IEC 60909-0:2016");
    expect(text).toContain("normal: Normal operation");
    expect(text).toContain("tbl-test-cu-pvc 1");
    expect(text).toMatch(
      /method air \(In air, reference 30 °C\), 3 loaded conductors; ambient 30 °C -> k_theta 1; 1 grouped circuits -> k_group 1/,
    );
    expect(text).toMatch(
      /C1 \(cir-m1\).*cable-section.*pass.*Proposed 2\.5 mm², governing current-capacity/s,
    );
    expect(text).toMatch(/C2 \(cir-l1\).*voltage-drop.*fail/s);
    expect(text).toMatch(/ik3Max.*16\.15\d* kA/);
    expect(text).not.toContain("Stale");
    const change = await api.prepareElectricalModelChange(
      context(),
      { operations: [{ op: "update-object", id: "cbl-w2", ref: "W2-new" }] },
      signal(),
    );
    await change.apply(signal());
    const stale = (await view({ view: "report", runId })) as { freshness: string; report: string };
    expect(stale.freshness).toBe("stale");
    expect(stale.report).toMatch(/Stale.*W2-new \(cbl-w2\)/s);
  });
  it("refuses an unknown run and an invalid result", async () => {
    await expect(view({ view: "report", runId: "20260101-000000-0000" })).rejects.toThrow(/does not exist/);
    await mkdir(join(root, "electrical-automation-results/bad-run"), { recursive: true });
    await writeFile(join(root, "electrical-automation-results/bad-run/result.json"), "{}");
    await expect(view({ view: "report", runId: "bad-run" })).rejects.toThrow(/invalid/);
    await expect(view({ view: "report" })).rejects.toThrow(/runId/);
  });
});

it("ships the electrical-network plugin in the electrical ecosystem, which enables the tool (REQ-SEC-4dfa2a5b)", async () => {
  const plugin = new URL("../../../../../plugins/electrical-network/", import.meta.url);
  const { manifest, issues } = validatePluginManifest(
    parse(await readFile(new URL("plugin.yaml", plugin), "utf8")),
  );
  expect(issues).toEqual([]);
  if (!manifest) throw Error("no manifest");
  expect(api.electricalModelPlugin({ manifest })).toBe(true);
  expect(api.electricalToolNames).toContain("electrical_network");
  expect(await readFile(new URL("skills/network-sizing/SKILL.md", plugin), "utf8")).toMatch(
    /^---\r?\nname: network-sizing\r?\n/,
  );
});
