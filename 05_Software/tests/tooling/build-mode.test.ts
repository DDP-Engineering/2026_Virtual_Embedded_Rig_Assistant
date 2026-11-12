import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const vite = join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js");

// The checkout mirrors the repository: 05_Software plus the release tooling its build config imports.
let repo: string;
let checkout: string;
beforeAll(() => {
  const cache = join(root, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  repo = mkdtempSync(join(cache, "vera-build-mode-"));
  checkout = join(repo, "05_Software");
  mkdirSync(checkout);
  copyFileSync(join(root, "package.json"), join(checkout, "package.json"));
  mkdirSync(join(repo, "02_Tools/release"), { recursive: true });
  copyFileSync(
    join(root, "../02_Tools/release/update-config.mjs"),
    join(repo, "02_Tools/release/update-config.mjs"),
  );
  for (const relative of ["src/apps/desktop", "src/libraries/core", "src/libraries/shared"]) {
    mkdirSync(join(checkout, relative), { recursive: true });
    copyFileSync(join(root, relative, "package.json"), join(checkout, relative, "package.json"));
    cpSync(join(root, relative, "src"), join(checkout, relative, "src"), {
      recursive: true,
      filter: (path) => !path.includes(".test."),
    });
  }
  copyFileSync(
    join(root, "src/apps/desktop/electron.vite.config.ts"),
    join(checkout, "src/apps/desktop/electron.vite.config.ts"),
  );
  const modules = join(checkout, "node_modules");
  mkdirSync(modules);
  for (const entry of readdirSync(join(root, "node_modules"), { withFileTypes: true })) {
    if (
      entry.name === ".cache" ||
      entry.name === "@vera" ||
      !statSync(join(root, "node_modules", entry.name)).isDirectory()
    )
      continue;
    symlinkSync(
      join(root, "node_modules", entry.name),
      join(modules, entry.name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  mkdirSync(join(modules, "@vera"));
  for (const name of ["core", "shared"])
    symlinkSync(
      join(checkout, "src/libraries", name),
      join(modules, "@vera", name),
      process.platform === "win32" ? "junction" : "dir",
    );
  expect(existsSync(join(checkout, "src/libraries/shared/dist/index.js"))).toBe(false);
});
afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

it.each([
  ["1", "true"],
  ["0", "false"],
] as const)(
  "compiles the test flag %s from a fresh source checkout independently of runtime overrides",
  (flag, expected) => {
    const output = join(checkout, `out-${flag}`);
    expect(existsSync(join(checkout, "src/libraries/shared/dist/index.js"))).toBe(false);
    const build = spawnSync(process.execPath, [vite, "build", "src/apps/desktop"], {
      cwd: checkout,
      encoding: "utf8",
      env: {
        ...process.env,
        VERA_TEST: flag,
        VERA_BUILD_ROOT: output,
        VERA_UPDATE_URL: "https://updates.example.test/fixed-build/",
      },
    });
    expect(build.status, build.stderr).toBe(0);
    const mainDir = join(output, "main");
    const code = readdirSync(mainDir, { recursive: true })
      .filter((name) => String(name).endsWith(".js"))
      .map((name) => readFileSync(join(mainDir, String(name)), "utf8"))
      .join("\n");
    expect(code, "pinned OAuth flow is statically available in desktop bundles").toContain(
      "ext_agent_host_id",
    );
    expect(code, "fixed build feed is emitted").toContain("https://updates.example.test/fixed-build/");
    expect(code, "runtime environment cannot replace the fixed update feed").not.toContain("VERA_UPDATE_URL");
    if (flag === "1") {
      expect(code).toContain("VERA Test");
      expect(code).toContain("VERA_REPLAY_DIR");
      expect(code).toContain("VERA_REPLAY_DELAY_MS");
      expect(code).toContain("VERA_TEST_ALLOW_WRITES");
      expect(code).toContain("VERA_TEST_CHATGPT");
      expect(code).toContain("fictional-native-access-WP21");
      expect(code).toContain("veraTestFileTools");
      expect(code).toContain("replay_");
      expect(code.includes("VERA_TEST_DIALOG_PATH"), "instrumented folder override emitted").toBe(true);
      expect(code).toContain("packaging-probe");
      expect(code).toContain("I2C1_CR1");
      expect(code).toContain("allowRemoteModels");
      expect(code).toContain('import("better-sqlite3")');
      expect(code).not.toContain("Could not dynamically require");
    } else {
      expect(code).not.toContain("VERA Test");
      for (const marker of [
        "packaging-probe",
        "I2C1_CR1",
        "VERA_TEST_DIALOG_PATH",
        "VERA_REPLAY_DIR",
        "VERA_REPLAY_DELAY_MS",
        "VERA_TEST_ALLOW_WRITES",
        "VERA_TEST_CHATGPT",
        "fictional-native-access-WP21",
        "fictional-native-model",
        "Unexpected scripted catalog request",
        "replay_",
        "registerReplay",
        "veraTestFileTools",
        "VERA_NETWORK_AUDIT",
      ]) {
        expect(code).not.toContain(marker);
      }
    }
    expect(code).toContain("allowRemoteModels");
    expect(existsSync(join(mainDir, "document-embedding-worker.js"))).toBe(true);
    const url = pathToFileURL(join(output, "main/build-mode.js")).href;
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
    expect(existsSync(join(checkout, "src/libraries/shared/dist/index.js"))).toBe(false);
  },
  60_000,
);
