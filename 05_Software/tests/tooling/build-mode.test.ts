import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const vite = join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js");

it("compiles the test flag and ignores runtime overrides in ordinary builds", () => {
  for (const [flag, expected] of [
    ["1", "true"],
    ["0", "false"],
  ] as const) {
    const build = spawnSync(process.execPath, [vite, "build", "apps/desktop"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, VERA_TEST: flag },
    });
    expect(build.status, build.stderr).toBe(0);
    const url = pathToFileURL(join(root, "apps/desktop/out/main/build-mode.js")).href;
    const run = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", `console.log((await import(${JSON.stringify(url)})).testBuild)`],
      {
        env: { ...process.env, VERA_TEST: "1" },
        encoding: "utf8",
      },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(expected);
  }
}, 60_000);
