import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readCableTableFile } from "../electrical/cable-table.js";
import { industrialCatalogTool, listCatalogs, readCatalogFile } from "../electrical/catalog-tool.js";
import {
  hashEvidenceFile,
  readLightingProject,
  readLightingReport,
  readPhotometryFile,
} from "../electrical/lighting-files.js";
import { readMeasurementFile } from "../electrical/measurements.js";
import { electricalModelTool, listResults, readModelFile, readResultFile } from "../electrical/tools.js";
import { readHilPlan } from "../plugins/hil/compile.js";
import { readRegistry } from "../plugins/resource-registry.js";
import { createToolContext } from "./context.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-app-inputs-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
// REQ-SEC-3856567c: refuse before opening or parsing a protected input, including absent files.
it.each([
  ["model", () => readModelFile(root, [root])],
  ["result", () => readResultFile(root, "20261116-123456-abcd", [root])],
  ["result listing", () => listResults(root, null, [root])],
  ["catalog", () => readCatalogFile(root, "cat-protected", [root])],
  ["catalog listing", () => listCatalogs(root, [root])],
  ["cable table", () => readCableTableFile(root, "tbl-protected", [root])],
  ["measurement", () => readMeasurementFile(root, "mea-protected", [root])],
  ["lighting project", () => readLightingProject(root, "lgt-protected", [root])],
  ["lighting report", () => readLightingReport(root, "rep-protected", [root])],
  ["photometry", () => readPhotometryFile(root, "protected.ies", [root])],
  ["evidence", () => hashEvidenceFile(root, "protected.pdf", [root])],
  ["HIL plan", () => readHilPlan(root, "plans/protected.json", [root])],
  ["resource registry", () => readRegistry(root, undefined, [root])],
] as const)("refuses application-data %s", async (_, read) => {
  await expect(read()).rejects.toThrow(/VERA application data/);
});
it("agent read entrypoints pass host exclusions while internal readers retain their defaults", async () => {
  const ctx = { ...createToolContext(root), managedRoots: [root], permissionMode: () => "bypass" as const };
  const signal = new AbortController().signal;
  await expect(electricalModelTool.execute(ctx, { view: "summary" }, signal)).rejects.toThrow(
    /VERA application data/,
  );
  await expect(industrialCatalogTool.execute(ctx, { view: "list" }, signal)).rejects.toThrow(
    /VERA application data/,
  );
  expect(await readModelFile(root)).toBeNull();
});
