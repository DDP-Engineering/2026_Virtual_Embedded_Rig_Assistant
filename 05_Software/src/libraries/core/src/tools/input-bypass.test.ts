import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionMode } from "@vera/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readCableTableFile } from "../electrical/cable-table.js";
import { readCatalogFile } from "../electrical/catalog-tool.js";
import {
  hashEvidenceFile,
  readLightingProject,
  readLightingReport,
  readPhotometryFile,
} from "../electrical/lighting-files.js";
import { readMeasurementFile } from "../electrical/measurements.js";
import { readModelFile } from "../electrical/tools.js";
import { NodeWorkerPool } from "../workers/node-host.js";
import { workerFixture } from "../workers/worker.test-support.js";
import { createToolContext, toolPathGuard } from "./context.js";
import { ToolRegistry } from "./registry.js";

let scratch: string;
let root: string;
let outside: string;
let managed: string;
let pool: NodeWorkerPool;
let bundle: ReturnType<typeof workerFixture>;
let mode: PermissionMode;
let epoch: AbortController;
const registry = new ToolRegistry();
beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), "vera-input-bypass-")));
  root = join(scratch, "bench");
  outside = join(scratch, "sibling");
  managed = join(scratch, "data");
  for (const path of [root, outside, managed]) await mkdir(path);
  await writeFile(join(outside, "log.txt"), "2026-11-16T12:00:00Z INFO captured sibling\n");
  await writeFile(
    join(outside, "register.json"),
    JSON.stringify({
      schemaVersion: 1,
      device: { id: "fixture", revision: "A" },
      sourceRefs: ["manual.md#L1-L1"],
      registers: [{ name: "CTRL", widthBits: 8, fields: [{ name: "ON", lsb: 0, width: 1 }] }],
    }),
  );
  mode = "bypass";
  epoch = new AbortController();
  bundle = workerFixture();
  pool = new NodeWorkerPool(bundle.url, { capacity: 1, deadlineMs: 3000 });
});
afterEach(async () => {
  await pool.dispose();
  bundle.close();
  await rm(scratch, { recursive: true, force: true });
});
function context() {
  return {
    ...createToolContext(root, pool),
    managedRoots: [managed],
    permissionMode: () => mode,
    bypassSignal: () => epoch.signal,
  };
}
async function call(name: string, args: unknown) {
  const result = await registry.execute(context(), name, args, new AbortController().signal);
  return { ...result, value: JSON.parse(result.text) };
}
it("reads sibling logs in its isolated worker and definitions only in Bypass with canonical provenance", async () => {
  for (const permission of ["bypass", "ask", "auto-edit", "read-only"] as const) {
    mode = permission;
    const log = await call("parse_log", { path: join(outside, "log.txt"), profile: "iso" });
    const decode = await call("decode_register", {
      definitionPath: join(outside, "register.json"),
      register: "CTRL",
      value: "1",
    });
    expect(log.isError).toBe(permission !== "bypass");
    expect(decode.isError).toBe(permission !== "bypass");
    if (permission === "bypass") {
      expect(log.value).toMatchObject({
        scan: { complete: true, lines: 1 },
        source: { path: join(outside, "log.txt").replaceAll("\\", "/"), ref: null },
      });
      expect(log.value.events[0]).toMatchObject({ message: "captured sibling", ref: null });
      expect(decode.value).toMatchObject({
        valueDec: "1",
        source: { path: join(outside, "register.json").replaceAll("\\", "/"), ref: null },
      });
    }
  }
});
it("never refreshes an already admitted guard after leaving and re-entering Bypass", async () => {
  const guardPromise = toolPathGuard(context());
  epoch.abort();
  mode = "ask";
  epoch = new AbortController();
  mode = "bypass";
  const guard = await guardPromise;
  await expect(guard.resolve(join(outside, "log.txt"))).rejects.toThrow();
});
it("refuses protected canonical input aliases in every mode", async () => {
  await writeFile(join(managed, "log.txt"), "secret");
  const alias = join(outside, "alias");
  await symlink(managed, alias, process.platform === "win32" ? "junction" : "dir");
  for (const permission of ["bypass", "ask", "auto-edit", "read-only"] as const) {
    mode = permission;
    for (const path of [join(managed, "log.txt"), join(alias, "log.txt"), join(alias, "missing")])
      expect((await call("parse_log", { path, profile: "iso" })).isError).toBe(true);
  }
});

it("uses shared scope for all electrical input families while fixed model storage stays confined", async () => {
  const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
  const copies = [
    ["electrical-automation-catalogs", "lighting-design/cat-lighting.json", "cat-lighting.json"],
    ["electrical-automation-tables", "electrical-network/tbl-test-cu-pvc.json", "tbl-test-cu-pvc.json"],
    [
      "electrical-automation-measurements",
      "power-quality-pfc/meas-fictional-mdb-day.json",
      "meas-fictional-mdb-day.json",
    ],
    [
      "electrical-automation-measurements",
      "power-quality-pfc/meas-fictional-mdb-day.csv",
      "meas-fictional-mdb-day.csv",
    ],
    ["electrical-automation-lighting", "lighting-design/lgt-office-a.json", "lgt-office-a.json"],
    ["electrical-automation-lighting", "lighting-design/rep-office-a.json", "rep-office-a.json"],
    ["electrical-automation-photometry", "lighting-design/fict-panel.ldt", "fict-panel.ldt"],
  ];
  for (const [folder, fixture, file] of copies) {
    await mkdir(join(outside, folder as string), { recursive: true });
    await cp(new URL(fixture as string, fixtures), join(outside, folder as string, file as string));
  }
  for (const folder of new Set(copies.map((row) => row[0] as string)))
    await symlink(
      join(outside, folder),
      join(root, folder),
      process.platform === "win32" ? "junction" : "dir",
    );
  const reads = [
    (guard: Awaited<ReturnType<typeof toolPathGuard>>) =>
      readCatalogFile(root, "cat-lighting", [managed], guard),
    (guard: Awaited<ReturnType<typeof toolPathGuard>>) =>
      readCableTableFile(root, "tbl-test-cu-pvc", [managed], guard),
    (guard: Awaited<ReturnType<typeof toolPathGuard>>) =>
      readMeasurementFile(root, "meas-fictional-mdb-day", [managed], guard),
    (guard: Awaited<ReturnType<typeof toolPathGuard>>) =>
      readLightingProject(root, "lgt-office-a", [managed], guard),
    (guard: Awaited<ReturnType<typeof toolPathGuard>>) =>
      readLightingReport(root, "rep-office-a", [managed], guard),
    (guard: Awaited<ReturnType<typeof toolPathGuard>>) =>
      readPhotometryFile(root, "fict-panel.ldt", [managed], guard),
    (guard: Awaited<ReturnType<typeof toolPathGuard>>) =>
      hashEvidenceFile(root, join(outside, "log.txt"), [managed], guard),
  ];
  const guard = await toolPathGuard(context());
  for (const read of reads) await expect(read(guard)).resolves.toBeDefined();
  const catalog = await readCatalogFile(root, "cat-lighting", [managed], guard);
  expect(catalog.stamp.path).toBe(
    join(outside, "electrical-automation-catalogs/cat-lighting.json").replaceAll("\\", "/"),
  );
  expect((await call("industrial_catalog", { view: "items", catalog: "cat-lighting" })).isError).toBe(false);
  await cp(new URL("lighting-design/model-office-a.json", fixtures), join(outside, "model.json"));
  expect(await readModelFile(root, [managed])).toBeNull();
  mode = "ask";
  const confined = await toolPathGuard(context());
  for (const read of reads) await expect(read(confined)).rejects.toThrow();
  mode = "bypass";
  epoch.abort();
  for (const read of reads) await expect(read(guard)).rejects.toThrow();
});

it("terminates an outside log worker on downgrade and does not revive its result on re-entry", async () => {
  await writeFile(join(outside, "log.txt"), "a".repeat(12000) + "!\n");
  const pending = call("parse_log", {
    path: join(outside, "log.txt"),
    pattern: "(?<level>error)(?<message>x)|(?<stall>(a+)+$)",
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  epoch.abort();
  mode = "ask";
  epoch = new AbortController();
  mode = "bypass";
  expect((await pending).isError).toBe(true);
  await writeFile(join(outside, "log.txt"), "2026-11-16T12:00:00Z INFO replacement worker\n");
  expect((await call("parse_log", { path: join(outside, "log.txt"), profile: "iso" })).isError).toBe(false);
});
