import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureDesktopTestBuild } from "./test-build.mjs";
import { e2eLanes, needsSingleE2eRun } from "./test-execution.mjs";

const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js");
const playwright = require.resolve("@playwright/test/cli");
const supplied = process.argv.slice(2);
const browserOnly = supplied.includes("--browser-only"),
  serialOnly = supplied.includes("--serial-only");
if (browserOnly && serialOnly) throw Error("Choose browser-only or serial-only");
const selected = supplied.filter((arg) => !["--browser-only", "--serial-only"].includes(arg));
function run(args, capture = false) {
  const command = [process.execPath, playwright, "test", ...args];
  const result =
    process.platform === "linux"
      ? spawnSync(
          "xvfb-run",
          [
            "-a",
            ...(process.env.VERA_E2E_SESSION_WRAPPER ? [process.env.VERA_E2E_SESSION_WRAPPER] : []),
            ...command,
          ],
          capture ? { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 } : { stdio: "inherit" },
        )
      : spawnSync(
          command[0],
          command.slice(1),
          capture ? { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 } : { stdio: "inherit" },
        );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    process.exit(result.status ?? 1);
  }
  return result;
}
const listOnly = selected.includes("--list");
if (
  selected.some((arg) => ["--help", "-h", "--version", "-V"].includes(arg)) ||
  (listOnly && !browserOnly && !serialOnly)
) {
  run(selected);
  process.exit(0);
}
// Stateful/interactive selection is left to one original Playwright run, never repartitioned.
const single = needsSingleE2eRun(selected);
if (single && (browserOnly || serialOnly))
  throw Error("Lane selection requires standard configuration, stateless filters and a text reporter");
async function prepare() {
  const state = await ensureDesktopTestBuild(process.cwd(), process.env, async () => {
    const result = spawnSync(process.execPath, [vite, "build", "src/apps/desktop"], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  });
  console.log(`Desktop test build: ${state}`);
}
if (single) {
  await prepare();
  run(selected);
  process.exit(0);
}
const report = JSON.parse(run([...selected, "--list", "--reporter=json"], true).stdout);
const lanes = e2eLanes(report);
const phases = [
  { name: "browser", tests: serialOnly ? [] : lanes.browser, workers: 2 },
  { name: "serial", tests: browserOnly ? [] : lanes.serial, workers: 1 },
].filter((phase) => phase.tests.length);
if (!phases.length) throw Error("No tests match the selected lane");
if (!listOnly && phases.some((phase) => phase.name === "serial")) await prepare();
const lists = mkdtempSync(join(tmpdir(), "vera-e2e-selection-"));
for (const phase of phases) {
  const list = join(lists, `${phase.name}.txt`);
  writeFileSync(list, phase.tests.join("\n"));
  console.log(`E2E ${phase.name}: ${phase.tests.length} selected test(s)`);
  const explicitWorkers = selected.some((arg) => /^(?:--workers|-j)(?:=|$)/.test(arg));
  const workers = phase.name === "browser" && explicitWorkers ? [] : ["--workers", String(phase.workers)];
  run([...selected, "--test-list", list, ...workers]);
}
