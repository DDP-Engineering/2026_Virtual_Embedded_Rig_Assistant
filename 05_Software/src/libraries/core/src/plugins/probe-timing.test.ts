import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { stringify } from "yaml";
import type { ProcessHost } from "../ports.js";
import { NodeProcessHost } from "./node-process-host.js";
import { Provisioner, pluginPlatform } from "./provisioning.js";
import { PluginStore } from "./store.js";

// Opt-in timing (PERF-10, #258): VERA_PROBE_TIMING=1 npx vitest run probe-timing --silent=false
// Two plugins with three found programs each; every probe is a real Node.js process that answers after
// VERA_PROBE_DELAY_MS (default 300). Reports a cold pass and a second provisioner on the same runtime
// folder (an app restart), with the slowest single probe.
const enabled = process.env.VERA_PROBE_TIMING === "1";
const delay = Number(process.env.VERA_PROBE_DELAY_MS ?? 300);
const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function plugin(root: string, id: string) {
  const source = join(root, "src", id);
  await mkdir(source, { recursive: true });
  const programs = Object.fromEntries(
    [1, 2, 3].map((n) => [
      `${id}-p${n}`,
      {
        install: { find: { windows: [process.execPath], linux: [process.execPath] } },
        version: {
          args: ["-e", `setTimeout(() => console.log("v${n}.0.0"), ${delay})`],
          match: "v(\\d+\\.\\d+\\.\\d+)",
        },
      },
    ]),
  );
  await writeFile(
    join(source, "plugin.yaml"),
    stringify({
      format: 1,
      id,
      version: "1.0.0",
      name: id,
      description: "Timing fixture.",
      ecosystem: "general",
      platforms: ["windows-x64", "linux-x64"],
      programs,
    }),
  );
  return source;
}

it.skipIf(!enabled)("times a full probe pass", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-probe-timing-"));
  roots.push(root);
  const store = new PluginStore({ root: join(root, "plugins") });
  for (const id of ["alpha", "beta"]) await store.install(await plugin(root, id));
  const real = new NodeProcessHost(spawn);
  const durations: number[] = [];
  const host: ProcessHost = {
    platform: real.platform,
    env: real.env,
    signal: (pid, signal) => real.signal(pid, signal),
    spawn(executable, args, options) {
      const started = performance.now();
      const child = real.spawn(executable, args, options);
      void child.exit.then(() => durations.push(performance.now() - started));
      return child;
    },
  };
  const create = () =>
    new Provisioner({
      store,
      root: join(root, "plugins", "runtime"),
      host,
      clock: { sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) },
      platform: pluginPlatform(process.platform, process.arch),
      fetch: async () => new Response("", { status: 404 }),
      settings: () => undefined,
    });
  const pass = async (label: string) => {
    durations.length = 0;
    const provisioner = create();
    const started = performance.now();
    const statuses = await Promise.all(["alpha", "beta"].map((id) => provisioner.statuses(id)));
    const total = performance.now() - started;
    await provisioner.drain();
    expect(statuses.flat().every((status) => status.state === "ready")).toBe(true);
    const slowest = durations.length ? Math.max(...durations) : 0;
    console.log(
      `${label}: ${total.toFixed(0)} ms, ${durations.length} probes, slowest probe ${slowest.toFixed(0)} ms`,
    );
  };
  await pass("cold");
  await pass("restart");
});
