// The electrical documentation tools on a temporary workbench (spec REQ-DATA-aa83ed5c): the plant M reference -
// real upstream runs (network, protection, motor_drives), the CAD-01 candidates numbered in place, the CAD-02 panel
// check and a model with a document, PLC I/O, tags, terminals and cable ends - its lists and checks, planted defects
// that are reported and never repaired, the revision, the change report, refusals before any write and the exports.
// Nothing is printed, ordered or sent: only result and export files are written, after approval.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectricalResult } from "@vera/shared";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../index.js";

const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
const MODEL = "electrical-automation-model.json";
const PANEL = "electrical-automation-panels/pnl-plant-m.json";
const TAGS = "plc/tags-plant-m.csv";
const M1 = "schematics/m1.qet";
const M2 = "schematics/m2.qet";
let root: string;
let storage: api.WorkbenchDatabase;
let queue: api.WriteQueue;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-doc-"));
  for (const dir of [
    ".vera",
    "electrical-automation-tables",
    "electrical-automation-catalogs",
    "electrical-automation-panels",
    "schematics",
    "plc",
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
  for (const [to, from] of [
    [MODEL, "electrical-documentation/plant-m-doc.json"],
    ["electrical-automation-tables/tbl-test-cu-pvc.json", "electrical-network/tbl-test-cu-pvc.json"],
    ["electrical-automation-catalogs/cat-motor-drives.json", "motor-drives/cat-motor-drives.json"],
    ["electrical-automation-catalogs/cat-panel.json", "panel-engineering/cat-panel.json"],
    [PANEL, "panel-engineering/pnl-plant-m.json"],
    [TAGS, "electrical-documentation/tags-plant-m.csv"],
  ])
    await writeFile(join(root, to as string), await readFile(new URL(from as string, fixtures)));
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

/** Numbers every conductor of a candidate in place: one number per potential, `<folio><nn>` (fixture generator). */
function numbered(xml: string): string {
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

/** Network, protection, motor_drives, the numbered M1/M2 candidates and the panel check. */
async function upstream(): Promise<{ motorDrives: string; protection: string; panel: string }> {
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
    ["mot-f1", M1],
    ["mot-p2", M2],
  ]) {
    await (
      await api.prepareQelectrotechChange(
        context(),
        { action: "candidate", motorDrivesRun: motorDrives, motor, path },
        signal(),
      )
    ).apply(signal());
    const file = join(root, path as string);
    await writeFile(file, numbered(await readFile(file, "utf8")), "utf8");
  }
  const panel = await applied(
    api.preparePanelEngineeringCheck(
      context(),
      {
        panel: "pnl-plant-m",
        motorDrivesRun: motorDrives,
        schematics: [
          { path: M1, motor: "mot-f1" },
          { path: M2, motor: "mot-p2" },
        ],
      },
      signal(),
    ),
  );
  return { motorDrives, protection, panel };
}
const schematics = [
  { path: M1, motor: "mot-f1" },
  { path: M2, motor: "mot-p2" },
];
const check = (panelRun: string, extra: Record<string, unknown> = {}) =>
  api.prepareElectricalDocumentationCheck(
    context(),
    { panelRun, schematics, document: "doc-mcp1", tags: TAGS, ...extra },
    signal(),
  );
async function stored(run: string): Promise<ElectricalResult> {
  return JSON.parse(
    await readFile(join(root, "electrical-automation-results", run, "result.json"), "utf8"),
  ) as ElectricalResult;
}
const criterion = (result: ElectricalResult, id: string) => result.criteria.find((entry) => entry.id === id);
type Section = NonNullable<ElectricalResult["documentation"]>;
const section = (result: ElectricalResult) => result.documentation as Section;
function list(result: ElectricalResult, name: string) {
  const entry = section(result).lists.find((candidate) => candidate.list === name);
  if (!entry) throw Error(`no list ${name}`);
  return {
    ...entry,
    records: entry.rows.map((row) => ({
      key: row.key,
      source: row.source,
      ...Object.fromEntries(entry.columns.map((column, i) => [column, row.cells[i] ?? null])),
    })) as ({ key: string; source: string } & Record<string, string | null>)[],
  };
}
async function editModel(
  change: (model: { objects: Record<string, unknown>[]; relations: { id: string }[] }) => void,
) {
  const model = JSON.parse(await readFile(join(root, MODEL), "utf8"));
  change(model);
  await writeFile(join(root, MODEL), `${JSON.stringify(model, null, 2)}\n`);
}
const watched = [MODEL, PANEL, TAGS, M1, M2, "electrical-automation-catalogs/cat-panel.json"];
const hashes = () => Promise.all(watched.map(async (path) => hash(await readFile(join(root, path)))));
async function allFiles(dir = root, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".vera") continue;
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...(await allFiles(join(dir, entry.name), `${path}/`)));
    else out.push(path);
  }
  return out.sort();
}
/** The conductor block of the given index (0-based, document order). */
function conductorAt(xml: string, index: number): { start: number; end: number } {
  const starts = [...xml.matchAll(/<conductor /g)].map((match) => match.index as number);
  const start = starts[index] as number;
  const end = xml.indexOf("</conductor>", start) + "</conductor>".length;
  return { start, end };
}

describe("electrical_documentation_check lists (CAD-03-A, REQ-FUNC-68911c98, REQ-FUNC-3d4e6392)", () => {
  it("derives every list from the model, the panel and the schematics with traceable sources, writing nothing else", async () => {
    const { panel } = await upstream();
    const before = await hashes();
    const files = await allFiles();
    const change = await check(panel);
    const request = change.request as { tool: string; path: string; beforeSha256: string | null };
    expect(request).toMatchObject({ tool: "electrical_documentation_check", beforeSha256: null });
    expect(await allFiles()).toEqual(files);
    await change.apply(signal());
    const run = request.path.split("/")[1] as string;
    expect(await allFiles()).toEqual([...files, `electrical-automation-results/${run}/result.json`].sort());
    expect(await hashes()).toEqual(before);
    const result = await stored(run);
    expect(result.producer).toEqual({
      plugin: "electrical-documentation",
      operation: "documentation",
      engine: { name: "vera-documentation", version: "1.0.0" },
    });
    const doc = section(result);
    expect(doc.lists.map((entry) => entry.list)).toEqual([
      "materials",
      "connections",
      "cables",
      "terminals",
      "labels",
      "io",
      "contents",
    ]);
    expect(doc.revision).toEqual({ value: "B", document: "doc-mcp1", date: "2026-11-16", author: null });
    expect(doc.panel.run).toBe(panel);
    const m1 = await readFile(join(root, M1));
    const m2 = await readFile(join(root, M2));

    const materials = list(result, "materials").records;
    expect(materials.find((row) => row.orderCode === "LC1D09P7")).toMatchObject({
      quantity: "2",
      tags: "KM1-M1, KM3-M2",
      manufacturer: "Schneider Electric",
      key: "item:cat-motor-drives/itm-lc1d09p7",
    });
    expect(materials.find((row) => row.key === "tag:KT1-M2")).toMatchObject({
      orderCode: null,
      quantity: "1",
    });
    expect(materials.find((row) => row.orderCode === "NSYTRV42")?.tags).toBe("X0, X1, XM1, XM2");
    expect(materials.every((row) => row.source.startsWith(`panel-result:${panel}#bom/`))).toBe(true);

    const conductors =
      api.readQetProject(m1.toString("utf8"), M1).conductors.length +
      api.readQetProject(m2.toString("utf8"), M2).conductors.length;
    const connections = list(result, "connections").records;
    expect(connections).toHaveLength(conductors);
    const supply = connections.find((row) => row.schematic === M1 && row.from === "X0:L1");
    expect(supply).toMatchObject({ to: "Q1-M1:1", folio: "1" });
    expect(supply?.wire).toMatch(/^1\d\d$/);
    expect(supply?.source).toMatch(new RegExp(`^qet:${M1}@sha256:${hash(m1)}#folio1/conductor\\d+$`));
    expect(connections.find((row) => row.schematic === M2 && row.from?.startsWith("KM1-M2:"))).toBeTruthy();
    expect(connections.every((row) => row.wire !== null)).toBe(true);

    const cables = list(result, "cables").records;
    expect(cables.find((row) => row.cable === "W1")).toMatchObject({
      circuit: "C1",
      from: "XM1:1, XM1:2, XM1:3",
      to: "M1",
      state: "ok",
    });
    expect(cables.find((row) => row.cable === "W2")?.from).toBe("XM2:1, XM2:2, XM2:3, XM2:4, XM2:5, XM2:6");
    expect(cables.find((row) => row.cable === "W3")?.state).toMatch(/^excluded: /);
    expect(cables.find((row) => row.cable === "W1")?.source).toMatch(
      /^model:electrical-automation-model\.json@sha256:[0-9a-f]{64}#cbl-m1/,
    );

    const terminals = list(result, "terminals").records;
    expect(terminals.find((row) => row.key === "XM1:2")).toMatchObject({
      strip: "XM1",
      cable: "W1",
      outside: "M1",
    });
    const x0 = terminals.find((row) => row.key === "X0:L1");
    // X0 is the shared incoming strip: both schematics draw it, so the point carries both inside ends.
    expect(x0?.wire?.split(", ")).toContain(supply?.wire);
    expect(x0?.inside).toBe("Q1-M1:1, Q1-M2:1");
    expect(x0?.origin).toBe("schematic");
    expect(terminals.find((row) => row.key === "A1:I0.0")).toMatchObject({ io: "I0.0" });

    const labels = list(result, "labels").records;
    const wireEnds = labels.filter((row) => row.kind === "wire-end");
    expect(wireEnds).toHaveLength(2 * connections.length);
    expect(
      wireEnds.filter((row) => row.text === supply?.wire && row.schematic === M1).map((row) => row.at),
    ).toEqual(expect.arrayContaining(["X0:L1", "Q1-M1:1"]));
    expect(labels.filter((row) => row.kind === "cable" && row.text === "W1")).toHaveLength(2);
    expect(labels.find((row) => row.kind === "device" && row.text === "KM1-M1")).toBeTruthy();

    const io = list(result, "io").records;
    expect(io.map((row) => row.address)).toEqual(["I0.0", "I0.1", "I0.2"]);
    expect(io[0]).toMatchObject({
      signal: "DI",
      module: "A1",
      device: "KM1-M1",
      terminal: "A1:I0.0",
      tag: "M1_Running",
      tagFile: "%I0.0",
      state: "ok",
    });
    expect(io[0]?.source).toContain(`tags:${TAGS}@sha256:${hash(await readFile(join(root, TAGS)))}#line2`);

    const contents = list(result, "contents").records;
    expect(contents.map((row) => row.list)).toEqual([
      "materials",
      "connections",
      "cables",
      "terminals",
      "labels",
      "io",
    ]);
    for (const row of contents) {
      const entry = doc.lists.find((candidate) => candidate.list === row.list);
      expect(row).toMatchObject({ rows: String(entry?.rows.length), sha256: entry?.sha256, revision: "B" });
    }
    for (const id of [
      "source:panel-result",
      "source:motor-drives",
      "source:panel-file",
      `source:schematic:${M1}`,
      `source:schematic:${M2}`,
      "source:tags",
      `labels:${M1}`,
      `numbering:${M1}`,
      `numbering:${M2}`,
      `cross-references:${M2}`,
      `wire-ends:${M1}`,
      `duplicates:${M2}`,
      `device-refs:${M1}`,
      `device-refs:${M2}`,
      "cable-ends",
      "terminal-points",
      "io-chain",
      "tag-file",
      "revision",
    ])
      expect(criterion(result, id)?.verdict, id).toBe("pass");
    expect(
      result.criteria.filter((entry) => entry.id.startsWith(`assembly:${M1}:connection:`)).length,
    ).toBeGreaterThan(0);
    expect(
      result.criteria
        .filter((entry) => entry.id.startsWith("assembly:"))
        .every((entry) => entry.verdict === "pass"),
    ).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.model.sha256).toBe(hash(await readFile(join(root, MODEL))));
    expect(result.sources).toContain(`qet:${M1}@sha256:${hash(m1)}`);
    expect(result.sources).toContain(`tags:${TAGS}@sha256:${hash(await readFile(join(root, TAGS)))}`);
    const model = api.parseModel(await readFile(join(root, MODEL), "utf8"));
    expect(api.resultFreshness(result, model).freshness).toBe("current");
  }, 90_000);
});

describe("planted defects are reported, never repaired (CAD-03-B, REQ-FUNC-9a06c922, REQ-FUNC-e7ad9a1c, REQ-FUNC-df08e0a4)", () => {
  it("finds duplicates, missing connections and references, wire ends and uncorrelated I/O", async () => {
    const { panel } = await upstream();
    let xml = await readFile(join(root, M1), "utf8");
    const project = api.readQetProject(xml, M1);
    // 1. A wire number of another potential on the first control conductor (duplicate number).
    const power = project.conductors.find((c) => c.folio === 0) as api.QetConductor;
    const control = project.conductors.findIndex((c) => c.folio === 1);
    let block = conductorAt(xml, control);
    xml = `${xml.slice(0, block.start)}${xml.slice(block.start, block.end).replace(/num="\d+"/, `num="${power.num}"`)}${xml.slice(block.end)}`;
    // 2. The last conductor without its number (wire end without label).
    block = conductorAt(xml, project.conductors.length - 1);
    xml = `${xml.slice(0, block.start)}${xml.slice(block.start, block.end).replace(/num="\d+"/, 'num=""')}${xml.slice(block.end)}`;
    // 3. A second conductor between the same two terminals (duplicate connection).
    block = conductorAt(xml, 0);
    xml = `${xml.slice(0, block.end)}\n${xml.slice(block.start, block.end)}${xml.slice(block.end)}`;
    // 4. The first conductor to the motor M1 removed (missing assembly connection).
    const motor = project.elements.find((e) => e.label === "M1") as api.QetElement;
    const missing = project.conductors.findIndex((c) => c.ends.some((e) => e?.element === motor.uuid));
    expect(missing).toBeGreaterThanOrEqual(0);
    block = conductorAt(xml, missing + 1);
    xml = `${xml.slice(0, block.start)}${xml.slice(block.end)}`;
    // 5. The start button relabelled KM9 (a label in neither the panel nor the model).
    xml = xml.replace(/(<elementInformation name="label" show="1">)S1(<)/, "$1KM9$2");
    await writeFile(join(root, M1), xml, "utf8");
    // Model: I0.2 without its tag, W1 without its motor end, XM1:3 renamed XM1:9 (beyond the 3-point strip).
    await editModel((model) => {
      model.relations = model.relations.filter((r) => r.id !== "rel-tag-i02" && r.id !== "rel-w1-end-m1");
      const xm13 = model.objects.find((o) => o.id === "trm-xm1-3") as { ref: string };
      xm13.ref = "XM1:9";
    });
    // Tag file: M1_Running at another address, an entry with no model tag, I0.2 twice.
    await writeFile(
      join(root, TAGS),
      "name,address,dataType,comment\nM1_Running,%I0.5,BOOL,\nM2_Overload,%I0.1,BOOL,\nM2_Running,%I0.2,BOOL,\nSpare_1,%I0.7,BOOL,\nM2_Run_Copy,%I0.2,BOOL,\n",
    );
    const before = await hashes();
    const result = await stored(await applied(check(panel)));
    expect(await hashes()).toEqual(before);
    const note = (id: string) => `${criterion(result, id)?.verdict}: ${criterion(result, id)?.note}`;
    expect(note(`numbering:${M1}`)).toMatch(new RegExp(`^fail: .*${power.num}`));
    expect(note(`wire-ends:${M1}`)).toMatch(/^fail: .*without a number/);
    expect(note(`duplicates:${M1}`)).toMatch(/^fail: .*X0:L1.*Q1-M1:1/);
    expect(note(`device-refs:${M1}`)).toMatch(/^fail: .*KM9/);
    expect(
      result.criteria.filter(
        (entry) => entry.id.startsWith(`assembly:${M1}:connection:`) && entry.verdict === "fail",
      ).length,
    ).toBeGreaterThan(0);
    expect(note("cable-ends")).toMatch(/^fail: .*W1.*M1/);
    expect(note("terminal-points")).toMatch(/^fail: .*XM1:9/);
    expect(note("io-chain")).toMatch(/^fail: .*I0\.2.*tag/);
    expect(note("tag-file")).toMatch(/^fail: /);
    for (const text of ["M1_Running", "%I0.5", "Spare_1", "%I0.2"]) expect(note("tag-file")).toContain(text);
    expect(note(`source:schematic:${M1}`)).toMatch(/^fail: /);
    expect(result.status).toBe("incomplete");
    const io = list(result, "io").records;
    expect(io.find((row) => row.address === "I0.0")?.state).toContain("%I0.5");
    expect(io.find((row) => row.key === "file:Spare_1")?.state).toBe("only in the tag file");
    // The sources keep the planted defects: nothing was corrected.
    expect(await readFile(join(root, M1), "utf8")).toBe(xml);
  }, 90_000);
});

describe("revision (CAD-03-C, REQ-FUNC-59134b83)", () => {
  it("takes the revision only from the model document and flags another folio revision", async () => {
    const { panel } = await upstream();
    const plain = await stored(await applied(check(panel, { document: undefined })));
    expect(section(plain).revision).toEqual({ value: null, document: null, date: null, author: null });
    expect(criterion(plain, "revision")?.verdict).toBe("unknown");
    const xml = await readFile(join(root, M1), "utf8");
    await writeFile(join(root, M1), xml.replace('indexrev=""', 'indexrev="C"'), "utf8");
    const other = await stored(await applied(check(panel)));
    expect(criterion(other, "revision")).toMatchObject({ verdict: "fail" });
    expect(criterion(other, "revision")?.note).toContain(`${M1} folio 1 states revision C`);
  }, 90_000);
});

describe("change report and live changes (CAD-03-D, REQ-FUNC-cc872eff, REQ-FUNC-359d4b0a)", () => {
  it("names the changed rows, affected objects and stale results, then a raised revision passes", async () => {
    const { panel, motorDrives } = await upstream();
    const first = await applied(check(panel));
    const view = (args: unknown) =>
      api.electricalDocumentationTool.execute(context(), args, signal()) as Promise<Record<string, unknown>>;
    expect(await view({ view: "changes", runId: first })).toMatchObject({ stale: false, sources: [] });
    const page = await view({ view: "list", runId: first, list: "connections", offset: 50 });
    expect(page).toMatchObject({ list: "connections", title: "Connection list", revision: "B", offset: 50 });
    expect((page.rows as unknown[]).length).toBe((page.total as number) - 50);
    await expect(view({ view: "list", runId: first })).rejects.toThrow(/needs list/);
    await editModel((model) => {
      const w1 = model.objects.find((o) => o.id === "cbl-m1") as {
        properties: { length: { value: number } };
      };
      w1.properties.length.value += 5;
    });
    let xml = await readFile(join(root, M1), "utf8");
    const block = conductorAt(xml, 0);
    xml = `${xml.slice(0, block.start)}${xml.slice(block.start, block.end).replace(/num="(\d+)"/, 'num="199"')}${xml.slice(block.end)}`;
    await writeFile(join(root, M1), xml, "utf8");
    const files = await allFiles();
    const live = await view({ view: "changes", runId: first });
    expect(await allFiles()).toEqual(files);
    expect(live).toMatchObject({ stale: true });
    expect((live.objects as { changed: string[] }).changed).toContain("cbl-m1");
    expect(live.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "changed", source: expect.stringContaining(M1) }),
      ]),
    );
    expect((live.results as { runId: string }[]).map((entry) => entry.runId)).toEqual(
      expect.arrayContaining([first, motorDrives]),
    );

    const second = await stored(await applied(check(panel, { previousRun: first })));
    const changes = section(second).changes as NonNullable<Section["changes"]>;
    expect(changes.previousRun).toBe(first);
    expect(changes.previousRevision).toBe("B");
    expect(changes.rows).toEqual(expect.arrayContaining([{ list: "cables", key: "W1", change: "changed" }]));
    expect(
      changes.rows.filter((row) => row.list === "connections" && row.change === "changed").length,
    ).toBeGreaterThan(0);
    expect(changes.objects.changed).toContain("cbl-m1");
    expect(changes.sources.map((entry) => entry.source)).toEqual(
      expect.arrayContaining([expect.stringContaining(`qet:${M1}@`)]),
    );
    // A cable length is an input of the network chain (motor_drives) but not of the panel result.
    expect(changes.results.map((entry) => entry.runId)).toEqual(expect.arrayContaining([first, motorDrives]));
    expect(changes.results.map((entry) => entry.runId)).not.toContain(panel);
    expect(criterion(second, "revision")).toMatchObject({ verdict: "fail" });
    expect(criterion(second, "revision")?.note).toContain("revision B");
    expect(criterion(second, "source:motor-drives")?.verdict).toBe("fail");
    expect(criterion(second, "source:panel-result")?.verdict).toBe("pass");
    expect(second.status).toBe("incomplete");

    await editModel((model) => {
      const doc = model.objects.find((o) => o.id === "doc-mcp1") as { attributes: Record<string, string> };
      doc.attributes.revision = "C";
    });
    const third = await stored(await applied(check(panel, { previousRun: second.runId })));
    expect(section(third).revision.value).toBe("C");
    expect(criterion(third, "revision")?.verdict).toBe("pass");
  }, 120_000);
});

describe("refusals (REQ-REL-500b461c)", () => {
  it("refuses missing or foreign runs, wrong objects, unreadable files and read-only sessions before any change", async () => {
    const { panel, motorDrives } = await upstream();
    const files = await allFiles();
    await expect(check("20260101-000000-0000")).rejects.toThrow(/does not exist/);
    await expect(check(motorDrives)).rejects.toThrow(/not a panel_engineering_check result/);
    await expect(check(panel, { document: "cbl-m1" })).rejects.toThrow(/cbl-m1 .*not a document/);
    await expect(check(panel, { schematics: [{ path: M1, motor: "cir-m1" }] })).rejects.toThrow(
      /cir-m1.*not a motor/,
    );
    await expect(check(panel, { schematics: [{ path: "schematics/none.qet" }] })).rejects.toThrow(
      /does not exist/,
    );
    await expect(check(panel, { previousRun: panel })).rejects.toThrow(
      /not an electrical_documentation_check result/,
    );
    await expect(
      check(panel, {
        schematics: [{ path: M1, motor: "mot-f1" }, { path: "schematics/../schematics/m1.qet" }],
      }),
    ).rejects.toThrow(/schematics\/m1\.qet is named twice/);
    await expect(check(panel, { tags: "../outside.csv" })).rejects.toThrow(/outside|workbench/i);
    await expect(check(panel, { tags: "plc/none.csv" })).rejects.toThrow(
      /The tag file plc\/none\.csv does not exist/,
    );
    await writeFile(join(root, TAGS), "name,address,plc\nA,%I0.0,x\n");
    await expect(check(panel)).rejects.toThrow(/Invalid tag file plc\/tags-plant-m\.csv: line 1: .*plc/);
    await writeFile(
      join(root, TAGS),
      await readFile(new URL("electrical-documentation/tags-plant-m.csv", fixtures)),
    );
    await expect(
      api.prepareElectricalDocumentationCheck(context(true), { panelRun: panel }, signal()),
    ).rejects.toThrow(/read-only/);
    await rm(join(root, MODEL));
    await expect(check(panel)).rejects.toThrow(/no electrical model/);
    expect(await allFiles()).toEqual(files.filter((path) => path !== MODEL));
  }, 90_000);
});

describe("exports (CAD-03-C, REQ-FUNC-c0be3443)", () => {
  it("writes CSV, XLSX and PDF new files with the controlled header and refuses a second export", async () => {
    const { panel } = await upstream();
    const run = await applied(check(panel));
    const result = await stored(run);
    const exported = async (args: Record<string, unknown>) => {
      const change = await api.prepareElectricalDocumentationExport(
        context(),
        { runId: run, ...args },
        signal(),
      );
      expect((change.request as { tool: string; beforeSha256: string | null }).tool).toBe(
        "electrical_documentation_export",
      );
      await change.apply(signal());
      return readFile(join(root, pathOf(change)));
    };
    const csv = (await exported({ format: "csv", list: "connections" })).toString("utf8");
    const lines = csv.split("\r\n");
    expect(lines.slice(0, 4)).toEqual([
      "Project,Plant M documentation reference (fictional) (prj-plant-m)",
      "Document,Connection list",
      "Revision,B",
      `Run,${run}`,
    ]);
    expect(csv).toContain(`Model sha256,${result.model.sha256}`);
    expect(csv).toContain(
      "\r\n\r\nwire,from,to,potential,folio,section,color,cable,schematic,key,source\r\n",
    );
    expect(lines.filter((line) => line.includes(",X0:L1,Q1-M1:1,"))).toHaveLength(1);
    await expect(
      api.prepareElectricalDocumentationExport(
        context(),
        { runId: run, format: "csv", list: "connections" },
        signal(),
      ),
    ).rejects.toThrow(/already exported/);

    const zip = unzipSync(new Uint8Array(await exported({ format: "xlsx" })));
    expect(Object.keys(zip)).toEqual(
      expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet7.xml"]),
    );
    const workbook = strFromU8(zip["xl/workbook.xml"] as Uint8Array);
    for (const name of ["Materials", "Connections", "Cables", "Terminals", "Labels", "I-O", "Contents"])
      expect(workbook).toContain(`name="${name}"`);
    const sheet = strFromU8(zip["xl/worksheets/sheet2.xml"] as Uint8Array);
    expect(sheet).toContain("<t>Revision</t>");
    expect(sheet).toContain("<t>X0:L1</t>");
    expect(sheet).toContain(`<t>${result.model.sha256}</t>`);

    const pdf = (await exported({ format: "pdf" })).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("(Contents)");
    expect(pdf).toContain("(Connection list)");
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf)?.[1]);
    expect(pages).toBeGreaterThan(2);
    expect(pdf.split(`Run ${run}`).length - 1).toBe(pages);
    await expect(
      api.prepareElectricalDocumentationExport(context(), { runId: panel, format: "pdf" }, signal()),
    ).rejects.toThrow(/not an electrical_documentation_check result/);
    // Manual visual check (REQ-FUNC-c0be3443): VERA_DOC_EXPORT_DIR=<folder> keeps the exports and the result.
    const keep = process.env.VERA_DOC_EXPORT_DIR;
    if (keep) {
      await mkdir(keep, { recursive: true });
      for (const name of [
        "documentation-connections.csv",
        "documentation.xlsx",
        "documentation.pdf",
        "result.json",
      ])
        await writeFile(
          join(keep, name),
          await readFile(join(root, "electrical-automation-results", run, name)),
        );
    }
  }, 90_000);
});

describe("gating (REQ-SEC-4dfa2a5b)", () => {
  it("offers the documentation tools only with the electrical-documentation plugin", () => {
    for (const name of [
      "electrical_documentation",
      "electrical_documentation_check",
      "electrical_documentation_export",
    ]) {
      expect(api.electricalToolOffered(name, ["electrical-documentation"])).toBe(true);
      expect(api.electricalToolOffered(name, ["panel-engineering", "qelectrotech"])).toBe(false);
    }
  });
});
