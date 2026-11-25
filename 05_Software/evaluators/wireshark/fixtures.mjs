import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { builtinToolNames, delegatedSessionToolNames } from "@vera/shared";
import { stringify } from "yaml";
import { sha256, software } from "../shared/identity.mjs";

export const auxiliary = new Set(["list", "load_skill", "help"]);

/** Trusted checkout fixture in the disposable evaluator profile. */
export async function installFixturePlugin(id, data) {
  const [{ PluginStore }, { readCatalogSource }] = await Promise.all([
    import("../../src/libraries/core/dist/plugins/store.js"),
    import("../../src/libraries/core/dist/plugins/catalog-source.js"),
  ]);
  const source = join(software, "plugins");
  const { issues, official, packages } = await readCatalogSource(source);
  const pkg = packages.get(id);
  if (issues.length || !pkg?.manifest || !official.has(id))
    throw Error(`Invalid official fixture ${id}: ${JSON.stringify(issues)}`);
  const store = new PluginStore({ root: join(data, "plugins") });
  await store.install(join(source, id), pkg.sha256, {
    tier: "official",
    url: `https://fixture.invalid/${id}.zip`,
  });
}

/** Snapshot synthetic input bytes once, before a runner or model process starts. */
export async function freezeFixtures(cases, shared, local) {
  const files = new Map();
  for (const item of cases)
    for (const [name, hash] of Object.entries(item.expect.fixtures)) {
      const bytes =
        files.get(name) ??
        (await readFile(join(shared, name)).catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return readFile(join(local, name));
        }));
      if (sha256(bytes) !== hash) throw Error(`Fixture digest mismatch: ${name}`);
      files.set(name, bytes);
    }
  return files;
}

export async function stageFixtures(files, item, workbench) {
  const entries = Object.entries(item.expect.fixtures);
  for (const [name, hash] of entries) {
    const bytes = files.get(name);
    if (!bytes || sha256(bytes) !== hash) throw Error(`Fixture digest mismatch: ${name}`);
  }
  const captures = join(workbench, "captures");
  await mkdir(captures, { recursive: true });
  for (const [name] of entries) await writeFile(join(captures, name), files.get(name), { flag: "wx" });
  const configFolder = join(workbench, ".vera");
  await mkdir(configFolder);
  const offered = new Set([...auxiliary, "wireshark_capture", "wireshark_import"]);
  for (const step of item.expect.steps) if (step.tool) offered.add(step.tool);
  const disabled = [...builtinToolNames, ...delegatedSessionToolNames].filter((name) => !offered.has(name));
  await writeFile(
    join(configFolder, "workbench.yaml"),
    stringify({
      format: 1,
      id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y4R",
      name: "Wireshark synthetic lab",
      description: "Frozen fictional capture evidence",
      docs: { include: [], exclude: [] },
      skills: { disabled: [] },
      tools: { disabled },
      agent: { permission_mode: "ask", model: null },
    }),
    { flag: "wx" },
  );
}
