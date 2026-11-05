import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// REQ-TEST-fa9a50c1: exercise the real collector with TypeScript outputs present.
it("collects shared authored tests once while excluding generated dist copies", () => {
  const shared = resolve(root, "src/libraries/shared");
  const dist = resolve(shared, "dist");
  const hadDist = existsSync(dist);
  mkdirSync(dist, { recursive: true });
  const generated = resolve(dist, `collector-${randomUUID()}.test.js`);
  writeFileSync(generated, "throw new Error('Generated output must not be collected');");
  try {
    const result = spawnSync(
      process.execPath,
      [
        resolve(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
        "list",
        "--project",
        "@vera/shared",
        "--filesOnly",
      ],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const files = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.includes(".test."))
      .map((line) => line.slice(line.indexOf("src/libraries/shared/")).replaceAll("\\", "/"))
      .sort();
    const expected = readdirSync(resolve(shared, "src"), { recursive: true })
      .map(String)
      .filter((path) => path.endsWith(".test.ts"))
      .map((path) => `src/libraries/shared/src/${path.replaceAll("\\", "/")}`)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(files).toEqual(expected);
  } finally {
    unlinkSync(generated);
    if (!hadDist) rmdirSync(dist);
  }
}, 30_000);
