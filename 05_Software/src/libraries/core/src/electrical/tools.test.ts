// electrical_model and electrical_model_change on a temporary workbench (spec REQ-DATA-06c0bd54 "Tools"): bounded
// views, one prepared change through the write flow, conflicts between concurrent changes and explicit-mapping imports.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../index.js";

const FIXTURE = new URL(
  "../../../../../tests/fixtures/electrical-model/two-pump-panel.json",
  import.meta.url,
);
const MODEL = "electrical-automation-model.json";
let root: string;
let storage: api.WorkbenchDatabase;
let queue: api.WriteQueue;
let fixtureText: string;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-electrical-"));
  await mkdir(join(root, ".vera"));
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
  fixtureText = await readFile(FIXTURE, "utf8");
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
const view = (args: unknown) => api.electricalModelTool.execute(context(), args, signal());
const prepare = (operations: unknown[]) =>
  api.prepareElectricalModelChange(context(), { operations }, signal());
const model = () => readFile(join(root, MODEL), "utf8");
const install = () => writeFile(join(root, MODEL), fixtureText);
const motor = {
  op: "add-object",
  object: {
    id: "mot-p3",
    type: "motor",
    ref: "M3",
    properties: { ratedPower: { value: null, unit: "kW", basis: "input" } },
  },
};
const feed = {
  op: "add-relation",
  relation: { id: "rel-feed-m3", type: "feeds", from: "cir-m2", to: "mot-p3" },
};

describe("electrical_model views (REQ-FUNC-4437aa41)", () => {
  it("reports a missing model, then the summary, objects, relations and results of the fixture", async () => {
    expect(await view({ view: "summary" })).toEqual({ exists: false, path: MODEL });
    await install();
    const summary = await view({ view: "summary" });
    expect(summary).toMatchObject({
      exists: true,
      sha256: hash(fixtureText),
      objects: 30,
      relations: 40,
      issues: [],
      counts: { motor: 2, circuit: 3, io: 7 },
    });
    const motors = await view({ view: "objects", type: "motor" });
    expect((motors.objects as { id: string }[]).map((item) => item.id)).toEqual(["mot-p1", "mot-p2"]);
    const [first] = motors.objects as { sha256: string; properties: Record<string, { value: unknown }> }[];
    expect(first?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first?.properties.ratedCurrent?.value).toBeNull();
    const picked = await view({ view: "objects", ids: ["prt-qf3"] });
    expect(picked).toMatchObject({ total: 1, objects: [{ ref: "QF3" }] });
    const relations = await view({ view: "relations", ids: ["mot-p1"] });
    expect((relations.relations as { id: string }[]).map((item) => item.id).sort()).toEqual([
      "rel-control-m1",
      "rel-feed-m1",
    ]);
    expect(await view({ view: "results" })).toEqual({ path: "electrical-automation-results", results: [] });
  });

  it("lists results with their freshness and an invalid result as invalid", async () => {
    await install();
    const current = JSON.parse(fixtureText);
    const result = (runId: string, ids: string[]) => ({
      kind: "vera-electrical-result",
      format: 1,
      runId,
      producer: {
        plugin: "electrical-network",
        operation: "load-balance",
        engine: { name: "t", version: "1" },
      },
      method: { id: "m", title: "Method" },
      status: "completed",
      preliminary: true,
      startedAt: "2026-11-15T12:00:00Z",
      finishedAt: "2026-11-15T12:00:01Z",
      model: { path: MODEL, sha256: hash(fixtureText) },
      catalog: null,
      inputs: ids.map((id) => ({
        id,
        snapshot: current.objects.find((item: { id: string }) => item.id === id),
      })),
      assumptions: [],
      sources: [],
      conditions: {},
      intermediate: [],
      criteria: [{ id: "c1", title: "Check", verdict: "pass" }],
      limits: [],
      messages: [],
    });
    for (const [runId, ids] of [
      ["run-a", ["mot-p1"]],
      ["run-b", ["lod-e1"]],
    ] as const) {
      await mkdir(join(root, "electrical-automation-results", runId), { recursive: true });
      await writeFile(
        join(root, "electrical-automation-results", runId, "result.json"),
        JSON.stringify(result(runId, [...ids])),
      );
    }
    await mkdir(join(root, "electrical-automation-results/run-c"));
    await writeFile(
      join(root, "electrical-automation-results/run-c/result.json"),
      JSON.stringify(result("run-x", ["mot-p1"])),
    );
    const change = await prepare([
      {
        op: "update-object",
        id: "mot-p1",
        properties: { ratedPower: { value: 5.5, unit: "kW", basis: "requirement" } },
      },
    ]);
    await change.apply(signal());
    const { results } = await view({ view: "results" });
    expect(results).toEqual([
      { runId: "run-c", freshness: "invalid", problem: "runId: run ID run-x differs from its folder run-c" },
      expect.objectContaining({
        runId: "run-b",
        freshness: "current",
        status: "completed",
        criteria: { pass: 1 },
      }),
      expect.objectContaining({ runId: "run-a", freshness: "stale", changed: ["mot-p1"], removed: [] }),
    ]);
  });

  it("refuses an invalid model with its problems", async () => {
    await writeFile(join(root, MODEL), fixtureText.replace('"unit": "kW"', '"unit": "V"'));
    await expect(view({ view: "summary" })).rejects.toThrow(
      /Invalid electrical model:\nobjects\[11\]\.properties\.ratedPower\.unit: unit V is not a unit of power/,
    );
  });
});

describe("electrical_model_change (REQ-FUNC-46374a53)", () => {
  it("prepares one write-class change with both hashes and a diff, and writes canonical bytes", async () => {
    await install();
    expect(api.electricalModelChangeTool).toMatchObject({ name: "electrical_model_change", class: "write" });
    const change = await prepare([motor, feed]);
    expect(change.request).toMatchObject({
      tool: "electrical_model_change",
      path: MODEL,
      existed: true,
      beforeSha256: hash(fixtureText),
    });
    const request = change.request as api.FileChangeRequest;
    expect(request.diff).toContain('+      "ref": "M3"');
    expect(await model()).toBe(fixtureText);
    const result = await change.apply(signal());
    const written = await model();
    expect(result).toEqual({
      path: MODEL,
      sha256: hash(written),
      bytes: Buffer.byteLength(written),
      ids: [],
    });
    expect(request.afterSha256).toBe(hash(written));
    expect(api.serializeModel(api.parseModel(written))).toBe(written);
    expect(storage.db.prepare("SELECT path, status FROM changes").all()).toEqual([
      { path: MODEL, status: "applied" },
    ]);
  });

  it("creates a model from set-project and returns generated IDs", async () => {
    const change = await prepare([
      { op: "set-project", name: "New panel" },
      { op: "add-object", object: { type: "motor", ref: "M1" } },
    ]);
    expect(change.request).toMatchObject({ existed: false, beforeSha256: null });
    const result = await change.apply(signal());
    const ids = result.ids as string[];
    expect(ids.map((id) => /^(prj|mot)-[0-9a-f]{8}$/.exec(id)?.[1])).toEqual(["prj", "mot"]);
    const created = api.parseModel(await model());
    expect(created.project).toMatchObject({ id: ids[0], name: "New panel" });
    expect(created.objects).toEqual([{ id: ids[1], type: "motor", ref: "M1" }]);
  });

  it("refuses operations that give an invalid model or no change, before any write", async () => {
    await install();
    await expect(prepare([{ op: "remove-object", id: "mot-p1" }])).rejects.toThrow(
      /Invalid electrical model change:\nrelations\[\d+\]\.to: object mot-p1 does not exist/,
    );
    await expect(prepare([{ op: "update-object", id: "mot-p9", name: "x" }])).rejects.toThrow(
      "operations[0]: no object mot-p9",
    );
    await expect(prepare([{ op: "update-object", id: "mot-p1", name: "Pump 1" }])).rejects.toThrow(
      "leave the electrical model unchanged",
    );
    await rm(join(root, MODEL));
    await expect(prepare([motor])).rejects.toThrow("start with set-project and a name");
    expect(storage.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  });
});

describe("concurrent changes (REQ-REL-cc710d50)", () => {
  it("applies the first of two prepared changes and refuses the second as a conflict", async () => {
    await install();
    const first = await prepare([motor, feed]);
    const second = await prepare([{ op: "update-object", id: "mot-p2", name: "Pump two" }]);
    await first.apply(signal());
    const afterFirst = await model();
    await expect(second.apply(signal())).rejects.toThrow(/Conflict/);
    expect(await model()).toBe(afterFirst);
  });

  it("refuses a creation when another change created the model first", async () => {
    const create = [{ op: "set-project", name: "Panel" }];
    const one = await prepare(create);
    const two = await prepare([{ op: "set-project", name: "Other" }]);
    await one.apply(signal());
    await expect(two.apply(signal())).rejects.toThrow(/Conflict/);
    expect(api.parseModel(await model()).project.name).toBe("Panel");
  });
});

describe("workbench confinement (REQ-FUNC-46374a53, REQ-FUNC-784f108f)", () => {
  it("refuses an import path outside the workbench and writes nothing", async () => {
    await install();
    await expect(prepare([{ op: "import", path: "../outside.json", mapping: {} }])).rejects.toThrow();
    expect(await model()).toBe(fixtureText);
  });

  it("refuses a model file that is a link to a file outside the workbench", async () => {
    const outside = await mkdtemp(join(tmpdir(), "vera-electrical-outside-"));
    try {
      await writeFile(join(outside, MODEL), fixtureText);
      try {
        await symlink(join(outside, MODEL), join(root, MODEL), "file");
      } catch {
        return; // Windows without the symlink privilege: the link cannot exist, so there is nothing to refuse.
      }
      await expect(view({ view: "summary" })).rejects.toThrow();
      await expect(prepare([{ op: "set-project", name: "Moved" }])).rejects.toThrow();
      expect(await readFile(join(outside, MODEL), "utf8")).toBe(fixtureText);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("writes the workbench model in bypass mode too, never a path the agent chose", async () => {
    await install();
    const bypass = { ...context(), permissionMode: () => "bypass" as const, bypassSignal: () => signal() };
    const change = await api.prepareElectricalModelChange(
      bypass,
      { operations: [{ op: "update-object", id: "mot-p2", name: "Standby pump" }] },
      signal(),
    );
    expect((change.request as api.FileChangeRequest).path).toBe(MODEL);
    await change.apply(signal());
    expect(await model()).toContain('"name": "Standby pump"');
  });
});

describe("explicit-mapping import (REQ-FUNC-784f108f)", () => {
  const exchange = (overrides: Record<string, unknown> = {}) => ({
    kind: "vera-electrical-model",
    format: 1,
    project: {
      id: "prj-vendor",
      name: "Vendor export",
      profile: { jurisdiction: null, domain: null, standards: [], limits: [] },
    },
    sources: [{ id: "src-vendor", kind: "datasheet", title: "Pump datasheet", revision: "B" }],
    objects: [
      { id: "cir-x", type: "circuit", ref: "C9" },
      {
        id: "mot-x",
        type: "motor",
        ref: "M9",
        properties: {
          ratedPower: { value: 2.2, unit: "kW", basis: "input", source: { id: "src-vendor", page: "4" } },
        },
      },
    ],
    relations: [{ id: "rel-x", type: "feeds", from: "cir-x", to: "mot-x" }],
    ...overrides,
  });
  const write = (document: unknown) => writeFile(join(root, "import.json"), JSON.stringify(document));
  const mapping = { "src-vendor": "new", "cir-x": "cir-m2", "mot-x": "mot-p3", "rel-x": "new" };

  it("imports a sibling exchange only in Bypass and keeps the model in the workbench", async () => {
    await install();
    const sibling = await mkdtemp(join(tmpdir(), "vera-exchange-"));
    try {
      const path = join(sibling, "exchange.json");
      await writeFile(path, JSON.stringify(exchange()));
      const operations = [motor, { op: "import", path, mapping }];
      await expect(prepare(operations)).rejects.toThrow();
      const ctx = { ...context(), permissionMode: () => "bypass" as const };
      const change = await api.prepareElectricalModelChange(ctx, { operations }, signal());
      expect(change.request).toMatchObject({ path: MODEL });
      await change.apply(signal());
      expect(api.parseModel(await model()).objects.some((item) => item.id === "mot-p3")).toBe(true);
      await expect(readFile(join(sibling, MODEL))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });

  it("merges when every ID is mapped, keeping mapped existing IDs and rewriting endpoints and citations", async () => {
    await install();
    await write(exchange());
    const refused = prepare([{ op: "import", path: "import.json", mapping }]);
    await expect(refused).rejects.toThrow("mot-x is mapped to mot-p3, which is not an existing motor");
    const change = await prepare([motor, { op: "import", path: "import.json", mapping }]);
    await change.apply(signal());
    const merged = api.parseModel(await model());
    expect(merged.objects.find((item) => item.id === "cir-m2")?.ref).toBe("C9");
    expect(merged.objects.find((item) => item.id === "mot-p3")?.properties?.ratedPower).toMatchObject({
      value: 2.2,
      source: { id: "src-vendor", page: "4" },
    });
    expect(merged.relations.find((item) => item.id === "rel-x")).toMatchObject({
      from: "cir-m2",
      to: "mot-p3",
    });
  });

  it("refuses an unmapped ID, a mapping to another type, format 2 and a new ID that collides, writing nothing", async () => {
    await install();
    const cases: [unknown, Record<string, string>, string | RegExp][] = [
      [
        exchange(),
        { "src-vendor": "new", "cir-x": "new", "mot-x": "new" },
        "the mapping does not name rel-x",
      ],
      [
        exchange(),
        { ...mapping, "mot-x": "cir-m1" },
        "mot-x is mapped to cir-m1, which is not an existing motor",
      ],
      [exchange({ format: 2 }), mapping, /Invalid exchange file:\nformat:/],
      [
        exchange({ objects: [{ id: "mot-p1", type: "motor", ref: "M9" }], relations: [] }),
        { "src-vendor": "new", "mot-p1": "new" },
        "mot-p1 is mapped as new but the model already holds it",
      ],
    ];
    for (const [document, map, message] of cases) {
      await write(document);
      await expect(prepare([{ op: "import", path: "import.json", mapping: map }])).rejects.toThrow(message);
    }
    expect(await model()).toBe(fixtureText);
    expect(storage.db.prepare("SELECT * FROM changes").all()).toEqual([]);
  });
});
