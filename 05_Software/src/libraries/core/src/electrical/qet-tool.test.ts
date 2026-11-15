// The QElectroTech tools on a temporary workbench (spec REQ-DATA-963cbdf6 "Tools"): candidates from stored, current
// motor_drives results through the prepared change, refusals before any write, byte-preserving edits with a base
// sha256 and conflicts, the check result with the project's sha256, and reconcile operations applied through the model
// tool. Upstream results are produced by the real network, protection and motor drives engines.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ElectricalResult, validatePluginManifest } from "@vera/shared";
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
  root = await mkdtemp(join(tmpdir(), "vera-qet-"));
  for (const dir of [".vera", "electrical-automation-tables", "electrical-automation-catalogs", "schematics"])
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
async function applied(prepared: Promise<api.PreparedChange>): Promise<string> {
  const change = await prepared;
  await change.apply(signal());
  return pathOf(change).split("/")[1] as string;
}
/** Network, protection and two motor_drives runs: M1 DOL + M2 star-delta + M3, and M1 reversing. */
async function upstream(): Promise<{ main: string; reversing: string; network: string }> {
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
  const m1 = { motor: "mot-f1", protection: "itm-gv2me10", contactor: "itm-lc1d09p7" };
  const main = await applied(
    api.prepareMotorDrives(
      context(),
      {
        protection,
        catalog: "cat-motor-drives",
        motors: [
          m1,
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
  const reversing = await applied(
    api.prepareMotorDrives(
      context(),
      { protection, catalog: "cat-motor-drives", motors: [{ ...m1, reversing: true }] },
      signal(),
    ),
  );
  return { main, reversing, network };
}
const candidate = (motorDrivesRun: string, motor: string, path: string) =>
  api.prepareQelectrotechChange(context(), { action: "candidate", motorDrivesRun, motor, path }, signal());
const view = (args: unknown) =>
  api.qelectrotechTool.execute(context(), args, signal()) as Promise<Record<string, unknown>>;

describe("qelectrotech_change candidate (REQ-FUNC-2e3af206, REQ-REL-3e094ff0)", () => {
  it("prepares the three templates as new files from current assemblies, checked before preview", async () => {
    const { main, reversing } = await upstream();
    const before = await readFile(join(root, MODEL));
    const dol = await candidate(main, "mot-f1", "schematics/m1-dol.qet");
    expect(dol.request).toMatchObject({
      tool: "qelectrotech_change",
      existed: false,
      beforeSha256: null,
      path: "schematics/m1-dol.qet",
    });
    expect(api.qelectrotechChangeTool.class).toBe("write");
    await expect(readdir(join(root, "schematics"))).resolves.toEqual([]);
    const written = (await dol.apply(signal())) as {
      sha256: string;
      checks: { id: string; verdict: string }[];
    };
    const bytes = await readFile(join(root, "schematics/m1-dol.qet"));
    expect(written.sha256).toBe(hash(bytes));
    expect(written.checks.every((c) => c.verdict === "pass")).toBe(true);
    expect(written.checks.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "assembly-devices",
        "connection:supply/Q1",
        "connection:KM1/motor:U1,V1,W1",
        "coil-supply:KM1",
      ]),
    );
    const devices = (await view({ view: "devices", path: "schematics/m1-dol.qet" })) as {
      devices: { label: string }[];
    };
    expect(devices.devices.map((d) => d.label)).toEqual(["KM1", "M1", "Q1", "S0", "S1", "X0", "X1", "X1"]);
    for (const [run, motor, method] of [
      [reversing, "mot-f1", "reversing"],
      [main, "mot-p2", "star-delta"],
    ] as const) {
      const prepared = await candidate(run, motor, `schematics/${method}.qet`);
      const result = (await prepared.apply(signal())) as { checks: { id: string; verdict: string }[] };
      const mechanical = result.checks.find((c) => c.id === "mechanical-interlock");
      expect(mechanical).toBeDefined();
      expect(
        result.checks.filter((c) => c.id !== "mechanical-interlock").every((c) => c.verdict === "pass"),
      ).toBe(true);
    }
    const reversed = await readFile(join(root, "schematics/reversing.qet"), "utf8");
    expect(api.readQetProject(reversed, "r.qet").properties["vera-template"]).toBe("reversing 1");
    expect(hash(await readFile(join(root, MODEL)))).toBe(hash(before));
  });

  it("refuses an existing path, another method, a missing motor, a foreign and a stale result before any write", async () => {
    const { main, network } = await upstream();
    await writeFile(join(root, "schematics/taken.qet"), "x");
    await expect(candidate(main, "mot-f1", "schematics/taken.qet")).rejects.toThrow(
      /already exists: a candidate is always a new file/,
    );
    await expect(candidate(main, "mot-c3", "schematics/c3.qet")).rejects.toThrow(
      /No QElectroTech template for the vfd method of mot-c3/,
    );
    await expect(candidate(main, "mot-x", "schematics/x.qet")).rejects.toThrow(/holds no assembly for mot-x/);
    await expect(candidate(network, "mot-f1", "schematics/x.qet")).rejects.toThrow(
      /was not produced by motor-drives/,
    );
    await expect(candidate(main, "mot-f1", "schematics/x.txt")).rejects.toThrow(/must be a \.qet file/);
    await (
      await api.prepareElectricalModelChange(
        context(),
        {
          operations: [
            {
              op: "update-object",
              id: "mot-f1",
              properties: { loadInertia: { value: 0.4, unit: "kg·m²", basis: "input" } },
            },
          ],
        },
        signal(),
      )
    ).apply(signal());
    await expect(candidate(main, "mot-p2", "schematics/x.qet")).rejects.toThrow(
      /is stale \(changed: [^)]*mot-f1/,
    );
    expect(await readdir(join(root, "schematics"))).toEqual(["taken.qet"]);
  });
});

describe("qelectrotech_change edit (REQ-DATA-6609a3b6, REQ-REL-3e094ff0)", () => {
  it("splices only the edited information, keeps UUIDs and every other byte, and refuses a wrong base or a conflict", async () => {
    const path = "schematics/dol.qet";
    const original = await readFile(new URL("qelectrotech/dol.generated.qet", fixtures), "utf8");
    await writeFile(join(root, path), original);
    const project = api.readQetProject(original, path);
    const coil = project.elements.find((e) => e.type.endsWith("coil.elmt")) as api.QetElement;
    const motor = project.elements.find((e) => e.label === "M1") as api.QetElement;
    const sha256 = hash(original);
    const edit = (args: Record<string, unknown>) =>
      api.prepareQelectrotechChange(
        context(),
        { action: "edit", path, sha256, elements: [], ...args },
        signal(),
      );
    const prepared = await edit({
      title: "Fan M1 & starter",
      elements: [
        { uuid: coil.uuid, info: { label: "KM10", comment: "line <contactor>" } },
        { uuid: motor.uuid.toUpperCase(), info: { location: "+F1" } },
      ],
    });
    expect(prepared.request).toMatchObject({ existed: true, beforeSha256: sha256 });
    await prepared.apply(signal());
    const changed = await readFile(join(root, path), "utf8");
    const after = api.readQetProject(changed, path);
    expect(after.title).toBe("Fan M1 & starter");
    expect(after.byUuid.get(coil.uuid)?.info).toMatchObject({ label: "KM10", comment: "line <contactor>" });
    expect(after.byUuid.get(motor.uuid)?.info.location).toBe("+F1");
    expect(after.elements.map((e) => e.uuid)).toEqual(project.elements.map((e) => e.uuid));
    expect(after.conductors.length).toBe(project.conductors.length);
    // Outside the edited spans the bytes are the original ones.
    const label = coil.node.children.find((c) => c.name === "elementInformations")
      ?.children[0] as api.XmlElement;
    expect(changed.slice(0, project.root.attributes.find((a) => a.name === "title")?.valueStart)).toBe(
      original.slice(0, project.root.attributes.find((a) => a.name === "title")?.valueStart),
    );
    expect(changed.endsWith(original.slice(Math.max(motor.node.end, coil.node.end)))).toBe(true);
    expect(changed).toContain(`${original.slice(label.start, label.contentStart)}KM10</elementInformation>`);
    await expect(edit({ elements: [{ uuid: coil.uuid, info: { label: "KM2" } }] })).rejects.toThrow(
      /changed: its sha256 is .*, not the base/,
    );
  });

  it("refuses unknown elements, information names and an unchanged edit; a file changed after preview is a conflict", async () => {
    const path = "schematics/dol.qet";
    const original = await readFile(new URL("qelectrotech/dol.generated.qet", fixtures), "utf8");
    await writeFile(join(root, path), original);
    const coil = api
      .readQetProject(original, path)
      .elements.find((e) => e.type.endsWith("coil.elmt")) as api.QetElement;
    const edit = (elements: unknown[]) =>
      api.prepareQelectrotechChange(
        context(),
        { action: "edit", path, sha256: hash(original), elements },
        signal(),
      );
    await expect(
      edit([{ uuid: "{00000000-0000-4000-8000-000000000000}", info: { label: "X" } }]),
    ).rejects.toThrow(/has no element/);
    await expect(edit([{ uuid: coil.uuid, info: { formula: "%prefix" } }])).rejects.toThrow(
      /The information formula cannot be edited/,
    );
    await expect(edit([{ uuid: coil.uuid, info: { label: "KM1" } }])).rejects.toThrow(
      /leaves the project unchanged/,
    );
    await expect(
      edit([
        { uuid: coil.uuid, info: { comment: "a" } },
        { uuid: coil.uuid.toUpperCase(), info: { location: "b" } },
      ]),
    ).rejects.toThrow(/is named twice/);
    const prepared = await edit([{ uuid: coil.uuid, info: { label: "KM5" } }]);
    const meanwhile = original.replace("M1 dol", "changed in QElectroTech");
    await writeFile(join(root, path), meanwhile);
    await expect(prepared.apply(signal())).rejects.toThrow(/changed|conflict/i);
    expect(await readFile(join(root, path), "utf8")).toBe(meanwhile);
  });
});

describe("qelectrotech_check and reconcile (REQ-FUNC-b21bd414, REQ-FUNC-3f13f78d)", () => {
  it("stores one result with the project's sha256, maps devices through the model tool and goes stale with the motor", async () => {
    const { main } = await upstream();
    const path = "schematics/m2.qet";
    await (await candidate(main, "mot-p2", path)).apply(signal());
    const bytes = await readFile(join(root, path));
    const modelBefore = await readFile(join(root, MODEL));
    const reconciled = (await view({ view: "reconcile", path })) as unknown as api.QetReconcile;
    expect(reconciled.matched).toEqual([
      expect.objectContaining({ ref: "M2", object: "mot-p2", type: "motor", identity: "unrecorded" }),
    ]);
    expect(reconciled.qetOnly.map((q) => q.ref)).toEqual([
      "F1",
      "KM1",
      "KM2",
      "KM3",
      "KT1",
      "Q1",
      "S0",
      "S1",
      "X0",
      "X1",
    ]);
    expect(reconciled.operations.find((o) => o.op === "update-object")).toMatchObject({
      id: "mot-p2",
      attributes: { qetProject: path },
    });
    expect(hash(await readFile(join(root, MODEL)))).toBe(hash(modelBefore));

    const check = await api.prepareQelectrotechCheck(
      context(),
      { path, motorDrivesRun: main, motor: "mot-p2" },
      signal(),
    );
    await check.apply(signal());
    const stored = JSON.parse(await readFile(join(root, pathOf(check)), "utf8")) as ElectricalResult;
    expect(stored.producer).toMatchObject({ plugin: "qelectrotech", operation: "check" });
    expect(stored.sources).toContain(`qet:${path}@sha256:${hash(bytes)}`);
    expect(stored.conditions.qetSha256).toEqual({ text: hash(bytes) });
    const verdict = (id: string) => stored.criteria.find((c) => c.id === id)?.verdict;
    expect([verdict("project-read"), verdict("labels"), verdict("cross-references")]).toEqual([
      "pass",
      "pass",
      "pass",
    ]);
    expect(verdict("conductor-numbering")).toBe("unknown");
    expect(verdict("device-list")).toBe("unknown");
    expect([
      verdict("interlock:sequence"),
      verdict("star-point"),
      verdict("interlock:electrical:KM2/KM3"),
    ]).toEqual(["pass", "pass", "pass"]);
    expect(stored.criteria.find((c) => c.id === "star-point")?.subject).toBe("mot-p2");

    await (
      await api.prepareElectricalModelChange(context(), { operations: reconciled.operations }, signal())
    ).apply(signal());
    const again = (await view({ view: "reconcile", path })) as unknown as api.QetReconcile;
    expect(again.operations).toEqual([]);
    expect(again.matched).toHaveLength(11);
    const second = await api.prepareQelectrotechCheck(context(), { path }, signal());
    await second.apply(signal());
    const mapped = JSON.parse(await readFile(join(root, pathOf(second)), "utf8")) as ElectricalResult;
    expect(mapped.criteria.find((c) => c.id === "device-list")?.verdict).toBe("pass");
    expect(mapped.inputs.length).toBe(12);
    await (
      await api.prepareElectricalModelChange(
        context(),
        { operations: [{ op: "update-object", id: "mot-p2", note: "new pump" }] },
        signal(),
      )
    ).apply(signal());
    const listed = (await api.electricalModelTool.execute(context(), { view: "results" }, signal())) as {
      results: api.ResultEntry[];
    };
    expect(listed.results.find((r) => r.runId === pathOf(second).split("/")[1])).toMatchObject({
      freshness: "stale",
      changed: ["mot-p2"],
    });
    expect(await readFile(join(root, path))).toEqual(bytes);
  });

  it("keeps CRLF line endings on inserted information and the full hash in sources for a long path", async () => {
    const dir = `schematics/${"d".repeat(60)}/${"e".repeat(60)}`;
    const path = `${dir}/dol.qet`;
    await mkdir(join(root, dir), { recursive: true });
    const crlf = (await readFile(new URL("qelectrotech/dol.generated.qet", fixtures), "utf8")).replace(
      /\n/g,
      "\r\n",
    );
    await writeFile(join(root, path), crlf);
    const motor = api.readQetProject(crlf, path).elements.find((e) => e.label === "M1") as api.QetElement;
    await (
      await api.prepareQelectrotechChange(
        context(),
        {
          action: "edit",
          path,
          sha256: hash(crlf),
          elements: [{ uuid: motor.uuid, info: { location: "+F1" } }],
        },
        signal(),
      )
    ).apply(signal());
    const changed = await readFile(join(root, path), "utf8");
    expect(changed).toContain(
      '\r\n                    <elementInformation name="location" show="1">+F1</elementInformation>',
    );
    expect(changed.replace(/\r\n/g, "")).not.toContain("\n");
    const check = await api.prepareQelectrotechCheck(context(), { path }, signal());
    await check.apply(signal());
    const stored = JSON.parse(await readFile(join(root, pathOf(check)), "utf8")) as ElectricalResult;
    expect(stored.sources[0]).toMatch(new RegExp(`@sha256:${hash(changed)}$`));
  });

  it("reports a recorded identity that differs and refuses a check without a model or with half a run", async () => {
    const path = "schematics/dol.qet";
    await writeFile(join(root, path), await readFile(new URL("qelectrotech/dol.generated.qet", fixtures)));
    await (
      await api.prepareElectricalModelChange(
        context(),
        {
          operations: [
            {
              op: "update-object",
              id: "mot-f1",
              attributes: { qetUuid: "{00000000-0000-4000-8000-000000000001}", qetProject: path },
            },
          ],
        },
        signal(),
      )
    ).apply(signal());
    const reconciled = (await view({ view: "reconcile", path })) as unknown as api.QetReconcile;
    expect(reconciled.matched[0]).toMatchObject({ ref: "M1", identity: "differs" });
    expect(reconciled.problems[0]).toMatch(/M1: the model records QET element/);
    await expect(
      api.prepareQelectrotechCheck(context(), { path, motor: "mot-f1" }, signal()),
    ).rejects.toThrow(/go together/);
    await rm(join(root, MODEL));
    await expect(api.prepareQelectrotechCheck(context(), { path }, signal())).rejects.toThrow(
      /has no electrical model/,
    );
    await expect(view({ view: "project", path: "schematics/none.qet" })).rejects.toThrow(/does not exist/);
  });
});

it("ships the qelectrotech plugin in the electrical ecosystem, which enables only its own tools (REQ-SEC-4dfa2a5b)", async () => {
  const plugin = new URL("../../../../../plugins/qelectrotech/", import.meta.url);
  const { manifest, issues } = validatePluginManifest(
    parse(await readFile(new URL("plugin.yaml", plugin), "utf8")),
  );
  expect(issues).toEqual([]);
  if (!manifest) throw Error("no manifest");
  expect(api.electricalModelPlugin({ manifest })).toBe(true);
  for (const tool of ["qelectrotech", "qelectrotech_change", "qelectrotech_check"]) {
    expect(api.electricalPluginTools[tool]).toBe(manifest.id);
    expect(api.electricalToolOffered(tool, [manifest.id])).toBe(true);
    expect(api.electricalToolOffered(tool, ["motor-drives"])).toBe(false);
  }
  expect(await readFile(new URL("skills/qelectrotech-schematics/SKILL.md", plugin), "utf8")).toMatch(
    /^---\r?\nname: qelectrotech-schematics\r?\n/,
  );
});
