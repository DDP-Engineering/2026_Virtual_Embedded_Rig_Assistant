import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const vite = join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js");

it("compiles the test flag and ignores runtime overrides in ordinary builds", () => {
  // A fresh setup has no compiled shared entrypoint; every desktop layer must bundle from source.
  const compiledShared = join(root, "packages/shared/dist/index.js");
  const savedShared = `${compiledShared}.build-mode-backup`;
  expect(existsSync(savedShared), "no leftover generated-entry backup").toBe(false);
  const hadCompiledShared = existsSync(compiledShared);
  if (hadCompiledShared) renameSync(compiledShared, savedShared);
  try {
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
      const mainDir = join(root, "apps/desktop/out/main");
      const code = readdirSync(mainDir, { recursive: true })
        .filter((name) => String(name).endsWith(".js"))
        .map((name) => readFileSync(join(mainDir, String(name)), "utf8"))
        .join("\n");
      if (flag === "1") {
        expect(code).toContain("VERA_REPLAY_DIR");
        expect(code).toContain("replay_");
        expect(code.includes("VERA_TEST_DIALOG_PATH"), "instrumented folder override emitted").toBe(true);
        expect(code).toContain("packaging-probe");
        expect(code).toContain("I2C1_CR1");
        expect(code).toContain("allowRemoteModels");
        expect(code).toContain('import("better-sqlite3")');
        expect(code).not.toContain("Could not dynamically require");
      } else {
        for (const marker of [
          "packaging-probe",
          "I2C1_CR1",
          "allowRemoteModels",
          "embedding-worker",
          "VERA_TEST_DIALOG_PATH",
          "VERA_REPLAY_DIR",
          "replay_",
          "registerReplay",
        ]) {
          expect(code).not.toContain(marker);
        }
      }
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
  } finally {
    if (hadCompiledShared) renameSync(savedShared, compiledShared);
  }
}, 60_000);
