// The panel engineering tools on a temporary workbench (spec REQ-DATA-a8bf1713 "Tools"): the cited plant M panel
// checked against real upstream runs (network, protection, motor_drives) and QElectroTech candidates, the prepared
// result change, refusals before any write, the impact of a changed device and the exports. Nothing physical is
// touched: only the result file is written, after approval.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectricalResult } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../index.js";

const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
const MODEL = "electrical-automation-model.json";
const PANEL = "electrical-automation-panels/pnl-plant-m.json";
let root: string;
let storage: api.WorkbenchDatabase;
let queue: api.WriteQueue;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-panel-"));
  for (const dir of [
    ".vera",
    "electrical-automation-tables",
    "electrical-automation-catalogs",
    "electrical-automation-panels",
    "schematics",
  ])
    await mkdir(join(root, dir));
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
  for (const [name, from] of [
    ["cat-motor-drives", "motor-drives/cat-motor-drives.json"],
    ["cat-panel", "panel-engineering/cat-panel.json"],
  ])
    await writeFile(
      join(root, `electrical-automation-catalogs/${name}.json`),
      await readFile(new URL(from as string, fixtures)),
    );
  await writeFile(join(root, PANEL), await readFile(new URL("panel-engineering/pnl-plant-m.json", fixtures)));
});
afterEach(async () => {
  storage?.close();
  await rm(root, { recursive: true, force: true });
});

function context(readOnly = false) {
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
      ...(readOnly
        ? {
            assertWritable: () => {
              throw Error("The session is read-only.");
            },
          }
        : {}),
    },
  };
}
const pathOf = (prepared: api.PreparedChange) => (prepared.request as { path: string }).path;
async function applied(prepared: Promise<api.PreparedChange>): Promise<string> {
  const change = await prepared;
  await change.apply(signal());
  return pathOf(change).split("/")[1] as string;
}
/** Network, protection and motor_drives (M1 DOL, M2 star-delta, M3), then the M1 and M2 QET candidates. */
async function upstream(): Promise<{ motorDrives: string; network: string; protection: string }> {
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
  const motorDrives = await applied(
    api.prepareMotorDrives(
      context(),
      {
        protection,
        catalog: "cat-motor-drives",
        motors: [
          { motor: "mot-f1", protection: "itm-gv2me10", contactor: "itm-lc1d09p7" },
          {
            motor: "mot-p2",
            startingCurrentMax: 70,
            switchover: 0.8,
            protection: "itm-c10g32",
            contactor: "itm-lc1d18p7",
            starContactor: "itm-lc1d09p7",
            overloadRelay: "itm-lrd21",
          },
          { motor: "mot-c3", speedControl: true },
        ],
      },
      signal(),
    ),
  );
  for (const [motor, path] of [
    ["mot-f1", "schematics/m1.qet"],
    ["mot-p2", "schematics/m2.qet"],
  ])
    await (
      await api.prepareQelectrotechChange(
        context(),
        { action: "candidate", motorDrivesRun: motorDrives, motor, path },
        signal(),
      )
    ).apply(signal());
  return { motorDrives, network, protection };
}
const schematics = [
  { path: "schematics/m1.qet", motor: "mot-f1" },
  { path: "schematics/m2.qet", motor: "mot-p2" },
];
const check = (motorDrivesRun: string, extra: Record<string, unknown> = {}) =>
  api.preparePanelEngineeringCheck(
    context(),
    { panel: "pnl-plant-m", motorDrivesRun, schematics, ...extra },
    signal(),
  );
async function stored(run: string): Promise<ElectricalResult> {
  return JSON.parse(
    await readFile(join(root, "electrical-automation-results", run, "result.json"), "utf8"),
  ) as ElectricalResult;
}
const view = (args: unknown) =>
  api.panelEngineeringTool.execute(context(), args, signal()) as Promise<Record<string, unknown>>;
const criterion = (result: ElectricalResult, id: string) => result.criteria.find((entry) => entry.id === id);
const value = (result: ElectricalResult, name: string) =>
  result.intermediate.find((entry) => entry.name === name)?.value;
async function editPanel(change: (panel: Record<string, unknown>) => void) {
  const panel = JSON.parse(await readFile(join(root, PANEL), "utf8")) as Record<string, unknown>;
  change(panel);
  await writeFile(join(root, PANEL), `${JSON.stringify(panel, null, 2)}\n`);
}
const equipment = (panel: Record<string, unknown>) =>
  panel.equipment as {
    tag: string;
    item: { catalog: string; item: string } | null;
    [key: string]: unknown;
  }[];

const watched = [
  MODEL,
  PANEL,
  "electrical-automation-catalogs/cat-panel.json",
  "schematics/m1.qet",
  "schematics/m2.qet",
];
const hashes = () => Promise.all(watched.map(async (path) => hash(await readFile(join(root, path)))));
async function changeMotor(id: string, current: number) {
  const model = JSON.parse(await readFile(join(root, MODEL), "utf8"));
  model.objects.find((object: { id: string }) => object.id === id).properties.ratedCurrent.value = current;
  await writeFile(join(root, MODEL), `${JSON.stringify(model, null, 2)}\n`);
}
const resetPanel = async () =>
  writeFile(join(root, PANEL), await readFile(new URL("panel-engineering/pnl-plant-m.json", fixtures)));

describe("panel_engineering_check (CAD-02-A, REQ-FUNC-a0fb1b98, REQ-FUNC-b0b55ff0)", () => {
  it("prepares one new result reconciled with assemblies, model and schematics, writing nothing else", async () => {
    const { motorDrives } = await upstream();
    const before = await hashes();
    const results = await readdir(join(root, "electrical-automation-results"));
    const change = await check(motorDrives);
    const request = change.request as {
      tool: string;
      path: string;
      beforeSha256: string | null;
      existed: boolean;
    };
    expect(request).toMatchObject({ tool: "panel_engineering_check", beforeSha256: null, existed: false });
    expect(await readdir(join(root, "electrical-automation-results"))).toEqual(results);
    await change.apply(signal());
    const result = await stored(request.path.split("/")[1] as string);
    expect(result.producer).toEqual({
      plugin: "panel-engineering",
      operation: "panel",
      engine: { name: "vera-panel", version: "1.0.0" },
    });
    expect(result.panel?.bom.map((line) => `${line.tag}:${line.orderCode ?? "-"}`)).toEqual([
      "Q1-M1:GV2ME10",
      "KM1-M1:LC1D09P7",
      "Q1-M2:C10G32",
      "KM1-M2:LC1D18P7",
      "F1-M2:LRD21",
      "KM2-M2:LC1D18P7",
      "KM2-KM3-M2:LAD9V2",
      "KM3-M2:LC1D09P7",
      "KT1-M2:-",
      "S0-M1:XB5AA42",
      "S1-M1:XB5AA31",
      "S0-M2:XB5AA42",
      "S1-M2:XB5AA31",
      "G1:ABLS1A24050",
      "A1:TM221CE16T",
      "X0:NSYTRV42",
      "X1:NSYTRV42",
      "XM1:NSYTRV42",
      "XM2:NSYTRV42",
    ]);
    for (const id of ["assembly:M1", "assembly:M2", "model-loads", "model-devices"])
      expect(criterion(result, id)?.verdict, id).toBe("pass");
    expect(criterion(result, "model-loads")?.note).toContain("excluded by declaration: M3");
    expect(criterion(result, "schematic:schematics/m1.qet")?.verdict).toBe("pass");
    expect(criterion(result, "schematic:schematics/m2.qet")?.verdict).toBe("pass");
    expect(criterion(result, "terminals:X0")?.note).toContain(
      "3 connected terminals of X0 in schematics/m1.qet",
    );
    expect(criterion(result, "terminals:X1")?.verdict).toBe("pass");
    expect(criterion(result, "terminals:XM2")?.verdict).toBe("pass");
    expect(criterion(result, "supply:G1:m1-run")?.verdict).toBe("pass");
    expect(criterion(result, "bom-items")?.verdict).toBe("unknown");
    expect(criterion(result, "bom-items")?.note).toContain("KT1-M2");
    expect(value(result, "internalTemperature:m1-run")).toBeCloseTo(40.8399, 3);
    expect(result.sources).toContain(`panel:${PANEL}@sha256:${hash(await readFile(join(root, PANEL)))}`);
    expect(result.sources.some((source) => source.startsWith("qet:schematics/m2.qet@sha256:"))).toBe(true);
    expect(result.status).toBe("incomplete");
    expect(await hashes()).toEqual(before);
    await changeMotor("mot-f1", 4.7);
    const fresh = api.resultFreshness(result, api.parseModel(await readFile(join(root, MODEL), "utf8")));
    expect(fresh).toMatchObject({ freshness: "stale", changed: ["mot-f1"] });
  }, 60_000);

  it("fails the reconciliation on missing, other or undrawn devices and uncovered loads", async () => {
    const { motorDrives } = await upstream();
    await editPanel((panel) => {
      panel.equipment = equipment(panel).filter((entry) => entry.tag !== "KM1-M1" && entry.tag !== "S1-M2");
      const km = equipment(panel).find((entry) => entry.tag === "KM3-M2");
      if (km) km.item = { catalog: "cat-motor-drives", item: "itm-lc1d18p7" };
      panel.excluded = [];
      panel.scenarios = [{ tag: "full", title: "Everything" }];
    });
    const result = await stored(await applied(check(motorDrives)));
    expect(criterion(result, "assembly:M1")?.note).toContain("Missing: KM1 (LC1D09P7)");
    expect(criterion(result, "assembly:M2")?.note).toContain("KM3-M2: panel LC1D18P7, assembly LC1D09P7");
    expect(criterion(result, "model-loads")?.verdict).toBe("fail");
    expect(criterion(result, "model-loads")?.note).toContain("M3");
    expect(criterion(result, "schematic:schematics/m1.qet")?.note).toContain(
      "Drawn but not in the panel: KM1",
    );
    expect(criterion(result, "schematic:schematics/m2.qet")?.note).toContain(
      "Drawn but not in the panel: S1",
    );
  }, 60_000);
});

describe("refusals (REQ-REL-665727e6)", () => {
  it("refuses missing, foreign or stale runs, a non-board and read-only sessions before any change", async () => {
    const { motorDrives, protection } = await upstream();
    const results = await readdir(join(root, "electrical-automation-results"));
    await expect(check("20260101-000000-0000")).rejects.toThrow(/does not exist/);
    await expect(check(protection)).rejects.toThrow(/not produced by motor-drives/);
    await editPanel((panel) => {
      panel.board = "cir-m1";
    });
    await expect(check(motorDrives)).rejects.toThrow(/cir-m1, which is not a board/);
    await resetPanel();
    await expect(
      api.preparePanelEngineeringCheck(
        context(true),
        { panel: "pnl-plant-m", motorDrivesRun: motorDrives },
        signal(),
      ),
    ).rejects.toThrow(/read-only/);
    await changeMotor("mot-f1", 4.7);
    await expect(check(motorDrives)).rejects.toThrow(/is stale \(changed: mot-f1/);
    expect(await readdir(join(root, "electrical-automation-results"))).toEqual(results);
  }, 60_000);
});

describe("impact of a changed device (CAD-02-D, REQ-FUNC-40a5f935)", () => {
  it("names the BOM lines, rails, budgets and scenarios a change affects", async () => {
    const { motorDrives } = await upstream();
    const run = await applied(check(motorDrives));
    const unchanged = await view({ view: "impact", runId: run });
    expect(unchanged).toMatchObject({ stale: false, changed: [], frameChanged: false, schematics: [] });
    expect((unchanged.affected as { bom: string[] }).bom).toEqual([]);
    await editPanel((panel) => {
      const km = equipment(panel).find((entry) => entry.tag === "KM1-M1");
      if (km) km.item = { catalog: "cat-motor-drives", item: "itm-lc1d18p7" };
    });
    const contactor = await view({ view: "impact", runId: run });
    expect(contactor).toMatchObject({ stale: true, changed: ["KM1-M1"], frameChanged: false });
    expect(contactor.affected).toMatchObject({
      bom: ["KM1-M1"],
      layout: ["R1"],
      wholeLayout: false,
      // G1's output depends on the air temperature of the scenarios where KM1-M1 dissipates.
      supplies: [{ supply: "G1", scenarios: ["full", "m1-run"] }],
      dissipation: ["full", "m1-run"],
      thermal: ["full", "m1-run"],
    });
    await resetPanel();
    await editPanel((panel) => {
      const plc = equipment(panel).find((entry) => entry.tag === "A1");
      if (plc) plc.conditions = { expansion: { text: "maximum" }, installation: { text: "horizontal" } };
    });
    const plc = await view({ view: "impact", runId: run });
    expect((plc.affected as { supplies: unknown }).supplies).toEqual([
      { supply: "G1", scenarios: ["full", "idle", "m1-run"] },
    ]);
    await resetPanel();
    await editPanel((panel) => {
      (panel.enclosure as { installation: string }).installation = "free-standing";
    });
    const enclosure = await view({ view: "impact", runId: run });
    expect(enclosure).toMatchObject({
      frameChanged: true,
      affected: { wholeLayout: true, layout: ["R1", "R2", "R3"] },
    });
    expect((enclosure.affected as { thermal: string[] }).thermal).toEqual(["full", "idle", "m1-run"]);
    await resetPanel();
    await writeFile(
      join(root, "schematics/m1.qet"),
      `${await readFile(join(root, "schematics/m1.qet"), "utf8")}
`,
    );
    expect(await view({ view: "impact", runId: run })).toMatchObject({
      stale: true,
      schematics: [{ path: "schematics/m1.qet", state: "changed" }],
    });
  }, 60_000);
});

describe("exports and draft (REQ-FUNC-dd7ad54a, REQ-FUNC-7a0835ed)", () => {
  it("exports the BOM as CSV and the layout as SVG without writing", async () => {
    const { motorDrives } = await upstream();
    const run = await applied(check(motorDrives));
    const files = await readdir(join(root, "electrical-automation-results", run));
    const csv = (await view({ view: "export", runId: run, format: "bom-csv" })).text as string;
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "tag,kind,role,location,quantity,manufacturer,orderCode,name,catalog,item,motor,mountedOn,supply",
    );
    expect(lines.find((line) => line.startsWith("KM1-M1,"))).toContain(
      'Schneider Electric,LC1D09P7,"TeSys D contactor 3P (3 NO), AC-3 <= 440 V 9 A, 230 V AC 50/60 Hz coil"',
    );
    const svg = (await view({ view: "export", runId: run, format: "layout-svg" })).text as string;
    expect(svg).toContain('viewBox="0 0 350 562"');
    expect(svg.match(/<g><rect /g)).toHaveLength(10);
    expect(svg).toContain("Not placed: Q1-M2, KM2-M2, KT1-M2");
    await expect(view({ view: "export", runId: motorDrives, format: "bom-csv" })).rejects.toThrow(
      /not a panel_engineering_check result/,
    );
    expect(await readdir(join(root, "electrical-automation-results", run))).toEqual(files);
  }, 60_000);

  it("drafts equipment with the accessories the catalog lists, refusing stale runs", async () => {
    const { motorDrives } = await upstream();
    const draft = await view({ view: "draft", motorDrivesRun: motorDrives, motors: ["mot-f1", "mot-p2"] });
    const entries = draft.equipment as {
      tag: string;
      item: { item: string } | null;
      schematicTag: string;
      accessoryHints: { orderCode: string; note?: string }[];
    }[];
    expect(
      entries.slice(0, 2).map((entry) => `${entry.tag}:${entry.item?.item}:${entry.schematicTag}`),
    ).toEqual(["Q1-M1:itm-gv2me10:Q1", "KM1-M1:itm-lc1d09p7:KM1"]);
    const km1 = entries.find((entry) => entry.tag === "KM1-M2");
    expect(km1?.accessoryHints.map((hint) => hint.orderCode)).toEqual(["LAD9V2", "LRD21"]);
    expect(km1?.accessoryHints[1]?.note).toContain("LRD21 product page");
    await changeMotor("mot-p2", 22);
    await expect(view({ view: "draft", motorDrivesRun: motorDrives })).rejects.toThrow(/stale/);
  }, 60_000);

  it("is offered only with the panel-engineering plugin", () => {
    expect(api.electricalToolOffered("panel_engineering_check", ["panel-engineering"])).toBe(true);
    expect(api.electricalToolOffered("panel_engineering", ["qelectrotech"])).toBe(false);
  });
});
