import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Lints probe files placed at real workspace paths inside a temporary copy of biome.json,
// so the import-boundary overrides apply exactly as they do to source files.
const softwareRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const biomeCli = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
let sandbox = "";

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "vera-boundaries-"));
  const config = JSON.parse(readFileSync(join(softwareRoot, "biome.json"), "utf8"));
  delete config.$schema;
  config.vcs = { enabled: false };
  writeFileSync(join(sandbox, "biome.json"), JSON.stringify(config));
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function lint(path: string, source: string): string {
  const file = join(sandbox, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  const run = spawnSync(process.execPath, [biomeCli, "lint", path], { cwd: sandbox, encoding: "utf8" });
  rmSync(file);
  return `${run.stdout}${run.stderr}`;
}

describe("import boundaries (01-system.md §4)", () => {
  it.each([
    ["src/libraries/core/src/x.ts", 'import { app } from "electron";\nexport const a = app;\n'],
    ["src/libraries/core/src/x.ts", 'import { useState } from "react";\nexport const s = useState;\n'],
    [
      "src/libraries/core/src/x.ts",
      'import { app } from "../../../apps/desktop/src/main/index.js";\nexport const a = app;\n',
    ],
    ["src/libraries/core/src/x.ts", 'import { spawn } from "node:child_process";\nexport const s = spawn;\n'],
    [
      "src/libraries/core/src/plugins/x.ts",
      'import { exec } from "child_process";\nexport const e = exec;\n',
    ],
    ["src/libraries/shared/src/x.ts", 'import { readFile } from "node:fs";\nexport const r = readFile;\n'],
    [
      "src/apps/desktop/src/renderer/x.ts",
      'import { ipcRenderer } from "electron";\nexport const i = ipcRenderer;\n',
    ],
    ["src/apps/desktop/src/renderer/x.ts", 'import { core } from "@vera/core";\nexport const c = core;\n'],
    ["src/apps/desktop/src/preload/x.ts", 'import { core } from "@vera/core";\nexport const c = core;\n'],
    ...["renderer", "preload"].map((layer) => [
      `src/apps/desktop/src/${layer}/x.ts`,
      'import { SessionService } from "../../../../libraries/core/src/index.js";\nexport const s = SessionService;\n',
    ]),
  ])("rejects a forbidden import in %s", (path, source) => {
    expect(lint(path, source)).toContain("noRestrictedImports");
  });

  it.each([
    ["src/libraries/core/src/x.ts", 'import { z } from "zod";\nexport const s = z.string();\n'],
    ["src/apps/desktop/src/main/x.ts", 'import { app } from "electron";\nexport const a = app;\n'],
    [
      "src/apps/desktop/src/main/x.ts",
      'import { spawn } from "node:child_process";\nexport const s = spawn;\n',
    ],
    ["src/apps/cli/src/x.ts", 'import { spawn } from "node:child_process";\nexport const s = spawn;\n'],
    [
      "src/libraries/core/src/x.test.ts",
      'import { spawn } from "node:child_process";\nexport const s = spawn;\n',
    ],
    [
      "src/apps/desktop/src/preload/x.ts",
      'import { contextBridge } from "electron";\nexport const b = contextBridge;\n',
    ],
  ])("allows a permitted import in %s", (path, source) => {
    const output = lint(path, source);
    expect(output).toContain("Checked 1 file");
    expect(output).not.toContain("noRestrictedImports");
  });
});
