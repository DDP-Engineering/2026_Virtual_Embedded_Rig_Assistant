import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PluginStore, SettingsService } from "@vera/core";
import type { PluginOptions, ScopedPluginOptions } from "./args.js";
import { type ConsoleLogger, createNodeFiles, createPaths, nodeClock } from "./host-ports.js";
import { createCliProvisioner } from "./provisioning.js";

/**
 * `vera plugin install`: installs the plugin into `<data>/plugins`, then its programs, and prints one
 * JSON status per program. Exit 0 when every program is ready, 1 otherwise.
 */
export async function runPluginInstall(
  options: PluginOptions,
  logger: ConsoleLogger,
  signal: AbortSignal,
): Promise<number> {
  const location = await createPaths(options.data);
  const settings = new SettingsService({
    files: createNodeFiles(nodeClock),
    paths: location.paths,
    uuid: randomUUID,
    changed: () => {},
  });
  try {
    await settings.load();
    const store = new PluginStore({ root: join(location.paths.userData, "plugins") });
    const installed = await store.install(options.path);
    signal.throwIfAborted();
    const provisioner = createCliProvisioner(
      store,
      location.paths.userData,
      () => settings.get().settings.plugins,
    );
    const statuses = await provisioner.install(installed.id, signal);
    for (const status of statuses) process.stdout.write(`${logger.scrub(JSON.stringify(status))}\n`);
    return statuses.every((status) => status.state === "ready") ? 0 : 1;
  } finally {
    await settings.close();
    await location.close();
  }
}

/** User commands: portable source discovery/review and explicit hash acceptance; never auto provision. */
export async function runScopedPlugin(
  options: ScopedPluginOptions,
  logger: ConsoleLogger,
  signal: AbortSignal,
): Promise<number> {
  const location = await createPaths(options.data);
  try {
    signal.throwIfAborted();
    const store = new PluginStore({
      root: join(location.paths.userData, "plugins"),
      workbench: options.workbench,
    });
    if (options.kind === "plugin-provision") {
      const settings = new SettingsService({
        files: createNodeFiles(nodeClock),
        paths: location.paths,
        uuid: randomUUID,
        changed: () => {},
      });
      let host: ReturnType<typeof createCliProvisioner> | undefined;
      try {
        await settings.load();
        host = createCliProvisioner(store, location.paths.userData, () => settings.get().settings.plugins);
        const statuses = await host.install(options.id ?? "", signal);
        process.stdout.write(`${logger.scrub(JSON.stringify(statuses))}\n`);
        return statuses.every((status) => status.state === "ready") ? 0 : 1;
      } finally {
        await host?.drain();
        await settings.close();
      }
    }
    const result =
      options.kind === "plugin-list"
        ? await store.list()
        : options.kind === "plugin-review"
          ? await store.reviewScoped(options.id ?? "")
          : await store.trustScoped(options.id ?? "", options.sha256 ?? "");
    process.stdout.write(`${logger.scrub(JSON.stringify(result))}\n`);
    return 0;
  } finally {
    await location.close();
  }
}
