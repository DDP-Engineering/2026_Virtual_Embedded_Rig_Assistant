// Lighting project and report record format 1 (spec REQ-DATA-affb2e6b "Files"): the fictional fixtures parse; wrong
// kinds, versions, unknown fields, duplicate IDs and dangling references are refused with their path; reads are
// confined to the workbench.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashEvidenceFile,
  parseLightingProject,
  parseLightingReport,
  readLightingProject,
  readLightingReport,
  readPhotometryFile,
} from "./lighting-files.js";

const fixtures = new URL("../../../../../tests/fixtures/lighting-design/", import.meta.url);
const text = async (name: string) => (await readFile(new URL(name, fixtures))).toString("utf8");
const project = async () => JSON.parse(await text("lgt-office-a.json"));
const report = async () => JSON.parse(await text("rep-office-a.json"));
const parse = (value: unknown) => parseLightingProject(JSON.stringify(value), "lgt-office-a");

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-lighting-files-"));
  await mkdir(join(root, "electrical-automation-lighting"));
  await mkdir(join(root, "electrical-automation-photometry"));
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe("lighting project", () => {
  it("parses the fictional fixture (REQ-DATA-affb2e6b)", async () => {
    const parsed = parse(await project());
    expect(parsed.origin).toBe("fictional");
    expect(parsed.luminaires).toHaveLength(12);
    expect(parsed.scenarios.map((scenario) => scenario.id)).toEqual(["scn-work", "scn-cleaning"]);
  });

  it("refuses a wrong kind, another format, unknown fields, duplicate IDs and dangling references (REQ-DATA-affb2e6b)", async () => {
    const base = await project();
    expect(() => parse({ ...base, kind: "vera-lighting-report" })).toThrow(/kind/);
    expect(() => parse({ ...base, format: 2 })).toThrow(/format/);
    expect(() => parse({ ...base, colour: "red" })).toThrow(/colour|Unrecognized/);
    const duplicate = structuredClone(base);
    duplicate.luminaires[1].id = "lum-1";
    expect(() => parse(duplicate)).toThrow(/luminaires\[1\]\.id: the id lum-1 is used twice/);
    const dangling = structuredClone(base);
    dangling.luminaires[0].type = "typ-none";
    expect(() => parse(dangling)).toThrow(
      /luminaires\[0\]\.type: the luminaire type typ-none is not in types/,
    );
    const scenario = structuredClone(base);
    scenario.scenarios[0].requirement = "req-none";
    scenario.scenarios[1].luminaires = ["lum-1", "lum-1", "lum-99"];
    expect(() => parse(scenario)).toThrow(/req-none[\s\S]*listed twice[\s\S]*lum-99/);
    const photometry = structuredClone(base);
    photometry.types[0].photometry = "../model.ies";
    expect(() => parse(photometry)).toThrow(/\.ies or \.ldt file name/);
    expect(() => parseLightingProject(JSON.stringify(base), "lgt-other")).toThrow(
      /differs from the file name/,
    );
    expect(() => parseLightingProject("{", "lgt-office-a")).toThrow(/not JSON/);
  });
});

describe("lighting report record", () => {
  it("parses the fictional record and refuses a second surface for one scenario (REQ-DATA-affb2e6b)", async () => {
    const base = await report();
    expect(parseLightingReport(JSON.stringify(base), "rep-office-a").surfaces[0]?.ugr).toBeNull();
    const twice = structuredClone(base);
    twice.surfaces.push({ ...twice.surfaces[0] });
    expect(() => parseLightingReport(JSON.stringify(twice), "rep-office-a")).toThrow(/two surfaces/);
    const inverted = structuredClone(base);
    inverted.surfaces[0].minimum = 900;
    expect(() => parseLightingReport(JSON.stringify(inverted), "rep-office-a")).toThrow(/minimum is above/);
  });
});

describe("confined reads", () => {
  it("reads project, report and photometry with their sha256 and refuses names outside the folders (REQ-REL-840d2785)", async () => {
    for (const name of ["lgt-office-a.json", "rep-office-a.json"])
      await writeFile(
        join(root, "electrical-automation-lighting", name),
        await readFile(new URL(name, fixtures)),
      );
    const ldt = await readFile(new URL("fict-panel.ldt", fixtures));
    await writeFile(join(root, "electrical-automation-photometry/fict-panel.ldt"), ldt);
    const read = await readLightingProject(root, "lgt-office-a");
    expect(read.stamp.path).toBe("electrical-automation-lighting/lgt-office-a.json");
    expect((await readLightingReport(root, "rep-office-a")).report.project).toBe("lgt-office-a");
    await expect(readLightingReport(root, "lgt-office-a")).rejects.toThrow(/kind/);
    const photometry = await readPhotometryFile(root, "fict-panel.ldt");
    expect(photometry.stamp.sha256).toBe(createHash("sha256").update(ldt).digest("hex"));
    await expect(readPhotometryFile(root, "../x.ies")).rejects.toThrow(/not a valid/);
    await expect(readPhotometryFile(root, "absent.ies")).rejects.toThrow(/does not exist/);
    await expect(readLightingProject(root, "../lgt")).rejects.toThrow(/not a valid id/);
    await writeFile(join(root, "report.pdf"), "pdf bytes");
    expect(await hashEvidenceFile(root, "report.pdf")).toBe(
      createHash("sha256").update("pdf bytes").digest("hex"),
    );
    await expect(hashEvidenceFile(root, "../outside.pdf")).rejects.toThrow();
  });
});
