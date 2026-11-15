import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";

test("every official plugin declares VERA's license", async () => {
  const folder = join(process.cwd(), "plugins");
  const missing: string[] = [];
  for (const id of await readdir(folder)) {
    const manifest = parse(await readFile(join(folder, id, "plugin.yaml"), "utf8").catch(() => "{}")) ?? {};
    if (manifest.id && manifest.license !== "LicenseRef-PolyForm-Noncommercial-1.0.0") missing.push(id);
  }
  expect(missing).toEqual([]);
});
