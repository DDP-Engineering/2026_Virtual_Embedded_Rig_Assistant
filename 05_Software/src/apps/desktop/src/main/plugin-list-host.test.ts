import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PluginStore } from "@vera/core";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { PluginListingHost } from "./plugin-list-host.js";

// REQ-NFR-2b7fe7ab: actual worker bytes, including full store validation, rather than a mocked response.
it("lists with fresh integrity off main and keeps pending scopes and shutdown independent", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-plugin-worker-"));
  const entry = join(root, "worker.mjs");
  await build({
    entryPoints: [fileURLToPath(new URL("./plugin-list-worker.ts", import.meta.url))],
    outfile: entry,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: 'import { createRequire as testRequire } from "node:module"; const require=testRequire(import.meta.url);',
    },
    alias: {
      "@vera/core": fileURLToPath(
        new URL("../../../../libraries/core/src/plugins/store.ts", import.meta.url),
      ),
      "@vera/shared": fileURLToPath(new URL("../../../../libraries/shared/src/index.ts", import.meta.url)),
    },
  });
  const storeRoot = join(root, "plugins"),
    source = join(root, "tools");
  await mkdir(source);
  await writeFile(
    join(source, "plugin.yaml"),
    "format: 1\nid: tools\nversion: 1.0.0\nname: Tools\ndescription: Test tools\necosystem: general\nplatforms: [windows-x64, linux-x64]\nprograms: {}\n",
  );
  const store = new PluginStore({ root: storeRoot });
  await store.install(source);
  const host = new PluginListingHost(storeRoot, pathToFileURL(entry));
  try {
    const first = host.list();
    expect(host.list()).toBe(first);
    let responsive = false;
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        responsive = true;
        resolve();
      }, 0),
    );
    expect(responsive).toBe(true);
    expect(await first).toEqual(await store.list());
    const workbench = join(root, "workbench");
    for (const id of ["tools", "scope-tools"]) {
      const scoped = join(workbench, ".vera/plugins", id);
      await mkdir(scoped, { recursive: true });
      await writeFile(
        join(scoped, "plugin.yaml"),
        (await readFile(join(source, "plugin.yaml"), "utf8")).replace("id: tools", `id: ${id}`),
      );
    }
    const scopedList = await host.list(workbench);
    expect(scopedList).toEqual(await new PluginStore({ root: storeRoot, workbench }).list());
    expect(scopedList.some((plugin) => plugin.issues.some((issue) => issue.code === "collision"))).toBe(true);
    expect(scopedList.some((plugin) => plugin.issues.some((issue) => issue.code === "untrusted"))).toBe(true);
    await appendFile(join(storeRoot, "installed/tools/plugin.yaml"), "# changed\n");
    expect(await host.list()).toEqual(await store.list());
    expect((await host.list())[0]?.issues.length).toBeGreaterThan(0);
    const pending = host.list();
    const other = host.list(join(root, "workbench"));
    expect(other).not.toBe(pending);
    const outcomes = Promise.allSettled([pending, other]);
    await host.close();
    expect((await outcomes).every((result) => result.status === "rejected")).toBe(true);
    await expect(host.list()).rejects.toMatchObject({ code: "BUSY" });
  } finally {
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
});
