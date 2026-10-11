import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const provider = args[args.indexOf("--provider") + 1];
const dataIndex = args.indexOf("--data");
const data = dataIndex >= 0 ? args[dataIndex + 1] : undefined;
const allowed =
  args.length === (data ? 4 : 2) &&
  args.includes("--provider") &&
  provider &&
  /^(openai|custom:[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(provider);
if (!allowed) {
  console.error("Usage: npm run smoke:live -- --provider <openai|custom:slug> [--data <userData>]");
  process.exit(2);
}
const vite = join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js");
// Smoke uses an ordinary release build and the same main-process safeStorage/provider host.
const environment = { ...process.env, VERA_TEST: "0" };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VERA_REPLAY_DIR;
const build = spawnSync(process.execPath, [vite, "build", "apps/desktop"], {
  env: environment,
  stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const electron = require("electron");
const result = spawnSync(
  electron,
  [
    "apps/desktop",
    `--vera-smoke-provider=${provider}`,
    ...(data ? [`--user-data-dir=${resolve(data)}`] : []),
  ],
  { env: environment, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
