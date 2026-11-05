import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vite = join(dirname(require.resolve("electron-vite/package.json")), "bin/electron-vite.js");
const playwright = require.resolve("@playwright/test/cli");
const build = spawnSync(process.execPath, [vite, "build", "src/apps/desktop"], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const args = [process.execPath, playwright, "test", ...process.argv.slice(2)];
const result =
  process.platform === "linux"
    ? spawnSync(
        "xvfb-run",
        [
          "-a",
          ...(process.env.VERA_E2E_SESSION_WRAPPER ? [process.env.VERA_E2E_SESSION_WRAPPER] : []),
          ...args,
        ],
        { stdio: "inherit" },
      )
    : spawnSync(args[0], args.slice(1), { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
