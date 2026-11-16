// The plant M reference bench shared by the electrical documentation and EPLAN tool tests: a temporary workbench with
// the documentation model, cable table, catalogs, panel file and tag file, a session database and write queue, and the
// real upstream chain (network, protection, motor_drives, the CAD-01 candidates numbered in place, the panel check).
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import * as api from "../index.js";

const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
export const PLANT_M = {
  model: "electrical-automation-model.json",
  panel: "electrical-automation-panels/pnl-plant-m.json",
  tags: "plc/tags-plant-m.csv",
  m1: "schematics/m1.qet",
  m2: "schematics/m2.qet",
} as const;
export const plantMSchematics = [
  { path: PLANT_M.m1, motor: "mot-f1" },
  { path: PLANT_M.m2, motor: "mot-p2" },
];
const signal = () => new AbortController().signal;

/** Numbers every conductor of a candidate in place: one number per potential, `<folio><nn>` (fixture generator). */
export function numbered(xml: string): string {
  const project = api.readQetProject(xml, "candidate.qet");
  const numbers = new Map<string, string>();
  const perFolio = new Map<number, number>();
  const tags = [...xml.matchAll(/<conductor [^>]*>/g)];
  expect(tags.length).toBe(project.conductors.length);
  let out = "";
  let at = 0;
  project.conductors.forEach((conductor, i) => {
    const end = conductor.ends[0] ?? conductor.ends[1];
    const potential = end ? project.potentialOf.get(api.terminalKey(end)) : undefined;
    let num = potential ? numbers.get(potential) : undefined;
    if (num === undefined) {
      const next = (perFolio.get(conductor.folio) ?? 0) + 1;
      perFolio.set(conductor.folio, next);
      num = `${conductor.folio + 1}${String(next).padStart(2, "0")}`;
      if (potential) numbers.set(potential, num);
    }
    const tag = tags[i] as RegExpMatchArray;
    out += xml.slice(at, tag.index) + tag[0].replace(' num=""', ` num="${num}"`);
    at = (tag.index as number) + tag[0].length;
  });
  return out + xml.slice(at);
}

export interface PlantMBench {
  root: string;
  context(readOnly?: boolean): api.ToolContext;
  /** Applies a prepared result change and returns its run ID. */
  applied(prepared: Promise<api.PreparedChange>): Promise<string>;
  /** Network, protection, motor_drives, the numbered M1/M2 candidates and the panel check. */
  upstream(): Promise<{ motorDrives: string; protection: string; panel: string }>;
  /** The documentation check of plant M on a panel run (document doc-mcp1, the tag file). */
  documentation(panelRun: string, extra?: Record<string, unknown>): Promise<api.PreparedChange>;
  close(): Promise<void>;
}

/** Creates the plant M workbench in a new temporary folder. */
export async function plantMBench(prefix = "vera-plant-m-"): Promise<PlantMBench> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  for (const dir of [
    ".vera",
    "electrical-automation-tables",
    "electrical-automation-catalogs",
    "electrical-automation-panels",
    "schematics",
    "plc",
  ])
    await mkdir(join(root, dir));
  const storage = await api.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
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
  const queue = new api.WriteQueue();
  for (const [to, from] of [
    [PLANT_M.model, "electrical-documentation/plant-m-doc.json"],
    ["electrical-automation-tables/tbl-test-cu-pvc.json", "electrical-network/tbl-test-cu-pvc.json"],
    ["electrical-automation-catalogs/cat-motor-drives.json", "motor-drives/cat-motor-drives.json"],
    ["electrical-automation-catalogs/cat-panel.json", "panel-engineering/cat-panel.json"],
    [PLANT_M.panel, "panel-engineering/pnl-plant-m.json"],
    [PLANT_M.tags, "electrical-documentation/tags-plant-m.csv"],
  ] as const)
    await writeFile(join(root, to), await readFile(new URL(from, fixtures)));

  const context = (readOnly = false): api.ToolContext => ({
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
  });
  const applied = async (prepared: Promise<api.PreparedChange>): Promise<string> => {
    const change = await prepared;
    await change.apply(signal());
    return (change.request as { path: string }).path.split("/")[1] as string;
  };
  const upstream = async () => {
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
    for (const { path, motor } of plantMSchematics) {
      await (
        await api.prepareQelectrotechChange(
          context(),
          { action: "candidate", motorDrivesRun: motorDrives, motor, path },
          signal(),
        )
      ).apply(signal());
      const file = join(root, path);
      await writeFile(file, numbered(await readFile(file, "utf8")), "utf8");
    }
    const panel = await applied(
      api.preparePanelEngineeringCheck(
        context(),
        { panel: "pnl-plant-m", motorDrivesRun: motorDrives, schematics: plantMSchematics },
        signal(),
      ),
    );
    return { motorDrives, protection, panel };
  };
  const documentation = (panelRun: string, extra: Record<string, unknown> = {}) =>
    api.prepareElectricalDocumentationCheck(
      context(),
      { panelRun, schematics: plantMSchematics, document: "doc-mcp1", tags: PLANT_M.tags, ...extra },
      signal(),
    );
  return {
    root,
    context,
    applied,
    upstream,
    documentation,
    close: async () => {
      storage.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
