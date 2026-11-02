import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type PluginStore, Provisioner, pluginPlatform } from "@vera/core";
import type { PluginSettings } from "@vera/shared";
import { nodeClock } from "./host-ports.js";
import { createCliProcessHost } from "./process-host.js";

/**
 * The pinned uv of the source workspace (`05_Software/src/uv/<platform>/`), found from the CLI build in
 * `05_Software/src/apps/cli/dist/` and nowhere else: a uv planted in another folder is never run.
 */
export function cliUv(from = dirname(fileURLToPath(import.meta.url))): string | undefined {
  const platform = pluginPlatform(process.platform, process.arch);
  if (!platform) return undefined;
  const candidate = resolve(
    from,
    "..",
    "..",
    "..",
    "uv",
    platform,
    process.platform === "win32" ? "uv.exe" : "uv",
  );
  return existsSync(candidate) ? candidate : undefined;
}

/** The CLI's provisioner over `<userData>/plugins`; programs install only through `vera plugin install`. */
export function createCliProvisioner(
  store: PluginStore,
  userData: string,
  settings: () => PluginSettings | undefined,
): Provisioner {
  const uv = cliUv();
  return new Provisioner({
    store,
    root: join(userData, "plugins", "runtime"),
    ...(uv ? { uv: { executable: uv } } : {}),
    host: createCliProcessHost(),
    clock: nodeClock,
    platform: pluginPlatform(process.platform, process.arch),
    fetch: (url, { signal }) => fetch(url, signal ? { signal } : {}),
    settings,
  });
}
