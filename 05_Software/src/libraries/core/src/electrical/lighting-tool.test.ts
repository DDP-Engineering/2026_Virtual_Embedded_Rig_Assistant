// lighting_design on a temporary workbench (spec REQ-DATA-affb2e6b "Request", "Result"): one new result file through
// the write flow, input files unchanged, snapshots of the model project and the lighting load, sha256 of every file
// read in the sources, verification with a hashed evidence file, and refusals that prepare nothing.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePluginManifest } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import * as api from "../index.js";

const fixtures = new URL("../../../../../tests/fixtures/lighting-design/", import.meta.url);
const MODEL = "electrical-automation-model.json";
const LIGHTING = "electrical-automation-lighting";
const PHOTOMETRY = "electrical-automation-photometry";
const RESULTS = "electrical-automation-results";
let root: string;
let storage: api.WorkbenchDatabase;
let queue: api.WriteQueue;
const signal = () => new AbortController().signal;
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const fixture = (name: string) => readFile(new URL(name, fixtures));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-lighting-"));
  for (const folder of [".vera", LIGHTING, PHOTOMETRY, "electrical-automation-catalogs"])
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
  await writeFile(join(root, MODEL), await fixture("model-office-a.json"));
  for (const name of ["lgt-office-a.json", "rep-office-a.json"])
    await writeFile(join(root, LIGHTING, name), await fixture(name));
  for (const name of ["fict-panel.ldt", "fict-downlight.ies"])
    await writeFile(join(root, PHOTOMETRY, name), await fixture(name));
  await writeFile(
    join(root, "electrical-automation-catalogs/cat-lighting.json"),
    await fixture("cat-lighting.json"),
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
const prepare = (args: unknown) => api.prepareLightingDesign(context(), args, signal());
const results = async () => readdir(join(root, RESULTS)).catch(() => [] as string[]);
async function edit(folder: string, name: string, change: (value: Record<string, unknown>) => void) {
  const path = join(root, folder, name);
  const value = JSON.parse(await readFile(path, "utf8"));
  change(value);
  await writeFile(path, JSON.stringify(value));
}

describe("lighting_design (REQ-FUNC-98dceeb1)", () => {
  it("prepares one new result with snapshots and file hashes and leaves every input file as it is", async () => {
    const before = await Promise.all(
      [MODEL, `${LIGHTING}/lgt-office-a.json`, `${PHOTOMETRY}/fict-panel.ldt`].map((name) =>
        readFile(join(root, name)),
      ),
    );
    const prepared = await prepare({
      project: "lgt-office-a",
      level: "preliminary",
      catalog: "cat-lighting",
    });
    expect(prepared.request).toMatchObject({ tool: "lighting_design", existed: false, beforeSha256: null });
    expect(api.lightingDesignTool.class).toBe("write");
    expect(await results()).toEqual([]);
    const applied = await prepared.apply(signal());
    expect(applied).toMatchObject({ path: pathOf(prepared), status: "incomplete" });
    expect(String(applied.report)).toContain("Lighting - preliminary lumen-method estimate");
    expect(String(applied.report)).toMatch(/Preliminary result/);
    const written = JSON.parse(await readFile(join(root, pathOf(prepared)), "utf8"));
    expect("result" in api.checkResult(written, runOf(prepared))).toBe(true);
    expect(written).toMatchObject({
      producer: { plugin: "lighting-design", operation: "lighting" },
      preliminary: true,
      catalog: { id: "cat-lighting", version: "2026-11-15.1" },
    });
    expect(written.inputs.map((entry: { id: string }) => entry.id)).toEqual(["prj-office-a", "lod-l1"]);
    expect(written.sources).toEqual(
      expect.arrayContaining([
        `lighting project ${LIGHTING}/lgt-office-a.json sha256 ${hash(before[1] as Buffer)}`,
        `photometry typ-panel: ${PHOTOMETRY}/fict-panel.ldt sha256 ${hash(before[2] as Buffer)}`,
      ]),
    );
    const after = await Promise.all(
      [MODEL, `${LIGHTING}/lgt-office-a.json`, `${PHOTOMETRY}/fict-panel.ldt`].map((name) =>
        readFile(join(root, name)),
      ),
    );
    expect(after.map(hash)).toEqual(before.map(hash));
    expect(await results()).toEqual([runOf(prepared)]);
  });

  it("goes stale when the lighting load changes", async () => {
    const run = runOf(await applyLighting());
    await (
      await api.prepareElectricalModelChange(
        context(),
        {
          operations: [
            {
              op: "update-object",
              id: "lod-l1",
              properties: { activePower: { value: 0.5, unit: "kW", basis: "input" } },
            },
          ],
        },
        signal(),
      )
    ).apply(signal());
    const listed = (await view({ view: "results" })) as { results: api.ResultEntry[] };
    expect(listed.results.find((entry) => entry.runId === run)).toMatchObject({
      freshness: "stale",
      changed: ["lod-l1"],
    });
  });
});

async function applyLighting(
  args: Record<string, unknown> = { project: "lgt-office-a", level: "preliminary" },
) {
  const prepared = await prepare(args);
  await prepared.apply(signal());
  return prepared;
}

describe("verification (REQ-FUNC-addd6a2f)", () => {
  it("hashes the evidence file and gives a non-preliminary result only for a matched engine record", async () => {
    const evidence = Buffer.from("%PDF-1.7 exported engine report (test bytes)");
    await writeFile(join(root, LIGHTING, "office-a-report.pdf"), evidence);
    await edit(LIGHTING, "rep-office-a.json", (record) => {
      record.origin = "engine";
      record.evidence = { path: `${LIGHTING}/office-a-report.pdf`, sha256: hash(evidence) };
    });
    const args = {
      project: "lgt-office-a",
      level: "verification",
      report: "rep-office-a",
      scenarios: ["scn-work"],
    };
    const prepared = await applyLighting(args);
    const written = JSON.parse(await readFile(join(root, pathOf(prepared)), "utf8"));
    expect(written.preliminary).toBe(false);
    expect(written.criteria.find((entry: { id: string }) => entry.id === "report-match")?.verdict).toBe(
      "pass",
    );
    await writeFile(join(root, LIGHTING, "office-a-report.pdf"), "changed bytes");
    const changed = JSON.parse(await readFile(join(root, pathOf(await applyLighting(args))), "utf8"));
    expect(changed.preliminary).toBe(true);
    const record = await readFile(join(root, LIGHTING, "rep-office-a.json"));
    expect(changed.sources).toContain(`report record ${LIGHTING}/rep-office-a.json sha256 ${hash(record)}`);
    expect(changed.criteria.find((entry: { id: string }) => entry.id === "report-match")).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/sha256/),
    });
  });
});

describe("refusals (REQ-REL-840d2785)", () => {
  it("refuses missing, foreign or invalid inputs and prepares nothing", async () => {
    await expect(prepare({ project: "lgt-absent", level: "preliminary" })).rejects.toThrow(/does not exist/);
    await expect(prepare({ project: "lgt-office-a", level: "verification" })).rejects.toThrow(/needs report/);
    await expect(
      prepare({ project: "lgt-office-a", level: "preliminary", catalog: "cat-absent" }),
    ).rejects.toThrow(/does not exist/);
    await edit(LIGHTING, "rep-office-a.json", (record) => (record.project = "lgt-other"));
    await expect(
      prepare({ project: "lgt-office-a", level: "verification", report: "rep-office-a" }),
    ).rejects.toThrow(/belongs to lgt-other/);
    await rm(join(root, PHOTOMETRY, "fict-panel.ldt"));
    await expect(prepare({ project: "lgt-office-a", level: "preliminary" })).rejects.toThrow(
      /photometry file electrical-automation-photometry\/fict-panel.ldt does not exist/,
    );
    await writeFile(join(root, PHOTOMETRY, "fict-panel.ldt"), "Fictional\n1\n3\n");
    await expect(prepare({ project: "lgt-office-a", level: "preliminary" })).rejects.toThrow(
      /Invalid photometry file/,
    );
    await writeFile(join(root, PHOTOMETRY, "fict-panel.ldt"), await fixture("fict-panel.ldt"));
    await edit(LIGHTING, "lgt-office-a.json", (project) => {
      (project.types as { photometry: string }[])[0] = {
        ...(project.types as object[])[0],
        photometry: "../x.ies",
      } as never;
    });
    await expect(prepare({ project: "lgt-office-a", level: "preliminary" })).rejects.toThrow(
      /Invalid lighting project/,
    );
    await edit(LIGHTING, "lgt-office-a.json", (project) => {
      (project.types as Record<string, unknown>[])[0] = {
        id: "typ-panel",
        photometry: "fict-panel.ldt",
        load: "lod-s1",
      };
    });
    await expect(prepare({ project: "lgt-office-a", level: "preliminary" })).rejects.toThrow(
      /not a lighting load/,
    );
    expect(await results()).toEqual([]);
  });
});

it("ships the lighting-design plugin in the electrical ecosystem, which enables only its own tool (REQ-SEC-4dfa2a5b)", async () => {
  const plugin = new URL("../../../../../plugins/lighting-design/", import.meta.url);
  const { manifest, issues } = validatePluginManifest(
    parse(await readFile(new URL("plugin.yaml", plugin), "utf8")),
  );
  expect(issues).toEqual([]);
  if (!manifest) throw Error("no manifest");
  expect(api.electricalModelPlugin({ manifest })).toBe(true);
  expect(api.electricalPluginTools.lighting_design).toBe(manifest.id);
  expect(api.electricalToolOffered("lighting_design", [manifest.id])).toBe(true);
  expect(api.electricalToolOffered("power_quality", [manifest.id])).toBe(false);
  expect(await readFile(new URL("skills/lighting-design/SKILL.md", plugin), "utf8")).toMatch(
    /^---\r?\nname: lighting-design\r?\n/,
  );
});
