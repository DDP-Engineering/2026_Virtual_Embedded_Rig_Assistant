import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8"));

describe("workspace build skeleton", () => {
  it("provides desktop development, build and Electron acceptance commands", () => {
    expect(readJson("package.json").scripts).toMatchObject({
      dev: expect.any(String),
      build: expect.any(String),
      "test:e2e": expect.any(String),
    });
  });
  it.each([
    ["packages/shared", "@vera/shared"],
    ["packages/core", "@vera/core"],
    ["apps/desktop", "@vera/desktop"],
    ["apps/cli", "@vera/cli"],
  ])("integrates %s with the strict ESM solution", (path, name) => {
    expect(existsSync(join(root, path, "package.json"))).toBe(true);
    const manifest = readJson(`${path}/package.json`);
    expect(manifest.name).toBe(name);
    expect(manifest.type).toBe("module");
    const config = readJson(`${path}/tsconfig.json`);
    expect(config.extends).toBe("../../tsconfig.base.json");
    expect(readJson("tsconfig.json").references).toContainEqual({ path: `./${path}` });
    for (const version of Object.values({ ...manifest.dependencies, ...manifest.devDependencies })) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
