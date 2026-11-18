import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tool = await import(pathToFileURL(join(root, "../02_Tools/release/third-party.mjs")).href);

it("lists the dependencies of the desktop, core and shared workspaces with version and license", () => {
  const components: { name: string; version: string; license: string }[] = tool.thirdPartyComponents(root);
  const names = components.map((item) => item.name);
  // react: desktop only; mammoth: core only; zod: core and shared.
  for (const name of ["react", "mammoth", "zod"]) expect(names).toContain(name);
  expect(names.filter((name) => name === "zod")).toHaveLength(1);
  expect(names.some((name) => name.startsWith("@vera/"))).toBe(false);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  const mammoth = components.find((item) => item.name === "mammoth");
  expect(mammoth?.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(mammoth?.license).not.toBe("");
  expect(tool.thirdPartyNotices(root)).toContain(`mammoth  ${mammoth?.version}  ${mammoth?.license}`);
});

it("takes a workspace's own copy before the hoisted one and keeps two versions apart", async () => {
  const software = await mkdtemp(join(tmpdir(), "vera-third-party-"));
  try {
    const manifests = {
      "src/apps/desktop": { dependencies: { "@vera/core": "1.0.0", semver: "7.0.0", yaml: "2.0.0" } },
      "src/libraries/core": { dependencies: { semver: "6.0.0", yaml: "2.0.0" } },
      "src/libraries/shared": {},
    };
    for (const [workspace, manifest] of Object.entries(manifests)) {
      await mkdir(join(software, workspace), { recursive: true });
      await writeFile(join(software, workspace, "package.json"), JSON.stringify(manifest));
    }
    await writeFile(
      join(software, "package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/semver": { version: "6.0.0", license: "ISC" },
          "node_modules/yaml": { version: "2.0.0" },
          "src/apps/desktop/node_modules/semver": { version: "7.0.0", license: "ISC" },
        },
      }),
    );
    expect(tool.thirdPartyComponents(software)).toEqual([
      { name: "semver", version: "6.0.0", license: "ISC" },
      { name: "semver", version: "7.0.0", license: "ISC" },
      { name: "yaml", version: "2.0.0", license: "" },
    ]);
  } finally {
    await rm(software, { recursive: true, force: true });
  }
});
