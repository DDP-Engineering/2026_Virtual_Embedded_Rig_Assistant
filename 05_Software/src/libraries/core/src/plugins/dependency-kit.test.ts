import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { buildDependencyKit, type DependencyKitTools, dependencyKitFile } from "./dependency-kit.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const version = { args: ["--version"], match: "(\\S+)" };
const zip = "zip bytes";
const elf = "linux bytes";
const python = "python archive";
const urls = {
  zip: "https://h.test/r/tool_1.0_Windows_64bit.zip",
  elf: "https://h.test/r/tool-linux",
  python:
    "https://releases.test/20261026/cpython-3.13.18%2B20261026-x86_64-pc-windows-msvc-install_only.tar.gz",
};
const served: Record<string, string> = { [urls.zip]: zip, [urls.elf]: elf, [urls.python]: python };
const tool = (download: Record<string, unknown>) => ({ install: { download }, version });
const plugin = (id: string, programs: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
  format: 1,
  id,
  version: "0.2.0",
  name: `Plugin ${id}`,
  summary: `Test plugin ${id}.`,
  description: "A test plugin.",
  ecosystem: "test",
  platforms: ["windows-x64", "linux-x64"],
  programs,
  rules: Object.keys(programs).map((name) => ({ match: `${name} *`, risk: "device-write" })),
  ...more,
});
const windowsZip = {
  "windows-x64": { url: urls.zip, sha256: sha(zip), bytes: zip.length, path: "tool.exe" },
};

async function source(plugins: Record<string, unknown>, official: string[]) {
  const root = await mkdtemp(join(tmpdir(), "vera-kit-source-"));
  roots.push(root);
  for (const [id, manifest] of Object.entries(plugins)) {
    await mkdir(join(root, id, "scripts"), { recursive: true });
    // Manifests refuse YAML aliases, which stringify would write for shared fixture objects.
    await writeFile(join(root, id, "plugin.yaml"), stringify(manifest, { aliasDuplicateObjects: false }));
    await writeFile(
      join(root, id, "scripts", "tool.py"),
      '# /// script\n# dependencies = ["pyserial==3.5"]\n# ///\n',
    );
  }
  await writeFile(join(root, "packs.yaml"), stringify([]));
  await writeFile(join(root, "catalog.yaml"), stringify({ format: 1, official }));
  return root;
}
function tools(overrides: Partial<DependencyKitTools> = {}) {
  const fetched: string[] = [];
  const resolved: unknown[] = [];
  const fake: DependencyKitTools = {
    fetch: async (url) => {
      fetched.push(url);
      return url in served ? new Response(served[url]) : new Response("missing", { status: 404 });
    },
    wheels: async (platform, input, folder) => {
      resolved.push([platform, "requirement" in input ? input.requirement : basename(input.script)]);
      await writeFile(join(folder, "pyserial-3.5-py2.py3-none-any.whl"), "wheel");
    },
    python: async () => urls.python,
    ...overrides,
  };
  return { fake, fetched, resolved };
}
async function output() {
  const root = await mkdtemp(join(tmpdir(), "vera-kit-out-"));
  roots.push(root);
  return join(root, "kit-windows-x64");
}

// REQ-DATA-532b02f5
it("builds a platform kit of the official plugins' pinned files, wheels and CPython with an index and README", async () => {
  const shared = { ...windowsZip, "linux-x64": { url: urls.elf, sha256: sha(elf), bytes: elf.length } };
  const root = await source(
    {
      alpha: plugin("alpha", {
        tool: tool(shared),
        twin: tool(shared),
        cantools: { install: { pip: "cantools>=45,<46" }, version },
        helper: { install: { script: "scripts/tool.py" }, version },
        vendor: {
          install: {
            find: { windows: ["C:/V/*/bin"] },
            hint: "Install Vendor 9 from https://vendor.test/download.",
          },
          version,
        },
      }),
      community: plugin("community", {
        other: tool({ "windows-x64": { url: "https://h.test/x.zip", sha256: sha("x"), path: "x.exe" } }),
      }),
      linuxonly: plugin(
        "linuxonly",
        { elf: tool({ "linux-x64": { url: urls.elf, sha256: sha(elf) } }) },
        { platforms: ["linux-x64"] },
      ),
    },
    ["alpha", "linuxonly"],
  );
  const out = await output();
  const { fake, fetched, resolved } = tools();
  const { issues, kit } = await buildDependencyKit(root, "windows-x64", out, fake);
  expect(issues).toEqual([]);
  // One download shared by two programs is fetched and stored once; other platforms and community plugins are left out.
  expect(fetched).toEqual([urls.zip, urls.python]);
  expect(resolved).toEqual([
    ["windows-x64", "cantools>=45,<46"],
    ["windows-x64", "tool.py"],
  ]);
  const file = dependencyKitFile({ url: urls.zip, sha256: sha(zip) });
  expect(file).toBe(`files/${sha(zip)}/tool_1.0_Windows_64bit.zip`);
  expect(await readFile(join(out, ...file.split("/")), "utf8")).toBe(zip);
  const pythonFile = "python/20261026/cpython-3.13.18+20261026-x86_64-pc-windows-msvc-install_only.tar.gz";
  expect(await readFile(join(out, ...pythonFile.split("/")), "utf8")).toBe(python);
  const index = JSON.parse(await readFile(join(out, "kit.json"), "utf8"));
  expect(index).toEqual(kit);
  expect(index).toEqual({
    format: 1,
    platform: "windows-x64",
    plugins: [{ id: "alpha", version: "0.2.0" }],
    downloads: [
      { file, sha256: sha(zip), bytes: zip.length, url: urls.zip, programs: ["alpha/tool", "alpha/twin"] },
    ],
    programs: [
      { program: "alpha/cantools", kind: "pip" },
      { program: "alpha/helper", kind: "script" },
    ],
    wheels: [{ file: "wheels/pyserial-3.5-py2.py3-none-any.whl", sha256: sha("wheel"), bytes: 5 }],
    python: { file: pythonFile, bytes: python.length },
    vendor: [
      {
        program: "alpha/vendor",
        guide: "Install Vendor 9 from https://vendor.test/download.",
        link: "https://vendor.test/download",
      },
    ],
    bytes: zip.length + 5 + python.length,
  });
  const readme = await readFile(join(out, "README.md"), "utf8");
  expect(readme).toContain("| alpha/vendor | https://vendor.test/download |");
  expect(readme).toContain(`${index.bytes} bytes`);
  expect((await readdir(dirname(out))).sort()).toEqual(["kit-windows-x64"]);
});

// REQ-DATA-532b02f5
it("builds a Linux kit without Windows-only plugins and without CPython when no program needs it", async () => {
  const root = await source(
    {
      win: plugin("win", { tool: tool(windowsZip) }, { platforms: ["windows-x64"] }),
      linuxonly: plugin("linuxonly", { elf: tool({ "linux-x64": { url: urls.elf, sha256: sha(elf) } }) }),
    },
    ["win", "linuxonly"],
  );
  const out = await output();
  const { fake, fetched } = tools();
  const { kit } = await buildDependencyKit(root, "linux-x64", out, fake);
  expect(fetched).toEqual([urls.elf]);
  expect(kit?.plugins).toEqual([{ id: "linuxonly", version: "0.2.0" }]);
  expect(kit?.python).toBeUndefined();
  expect(kit?.downloads[0]?.file).toBe(`files/${sha(elf)}/tool-linux`);
});

// REQ-REL-7d6dc443
it("names a download that does not match its pin and leaves no kit or staging folder", async () => {
  const root = await source(
    {
      alpha: plugin("alpha", {
        tool: tool({ "windows-x64": { url: urls.zip, sha256: sha("other"), path: "t.exe" } }),
      }),
    },
    ["alpha"],
  );
  const out = await output();
  await expect(buildDependencyKit(root, "windows-x64", out, tools().fake)).rejects.toThrow(/alpha\/tool/);
  expect(await readdir(dirname(out))).toEqual([]);
});

// REQ-REL-7d6dc443
it("names a program whose wheels cannot be resolved and leaves no kit", async () => {
  const root = await source(
    { alpha: plugin("alpha", { cantools: { install: { pip: "cantools" }, version } }) },
    ["alpha"],
  );
  const out = await output();
  const { fake } = tools({
    wheels: async () => {
      throw new Error("no wheel for win_amd64");
    },
  });
  await expect(buildDependencyKit(root, "windows-x64", out, fake)).rejects.toThrow(
    "alpha/cantools: no wheel for win_amd64",
  );
  expect(await readdir(dirname(out))).toEqual([]);
});

// REQ-REL-7d6dc443
it("refuses a non-empty output folder before fetching anything", async () => {
  const root = await source({ alpha: plugin("alpha", { tool: tool(windowsZip) }) }, ["alpha"]);
  const out = await output();
  await mkdir(out);
  await writeFile(join(out, "old.txt"), "keep");
  const { fake, fetched } = tools();
  await expect(buildDependencyKit(root, "windows-x64", out, fake)).rejects.toThrow(/not empty/);
  expect(fetched).toEqual([]);
  expect(await readdir(out)).toEqual(["old.txt"]);
  expect(existsSync(`${out}.staging`)).toBe(false);
});

// REQ-DATA-532b02f5
it("reports catalog source issues and builds nothing", async () => {
  const root = await source({ alpha: plugin("alpha", { tool: tool(windowsZip) }) }, ["missing"]);
  const out = await output();
  const { issues, kit } = await buildDependencyKit(root, "windows-x64", out, tools().fake);
  expect(issues.map((issue) => issue.code)).toEqual(["reference"]);
  expect(kit).toBeUndefined();
  expect(existsSync(out)).toBe(false);
});

// REQ-DATA-532b02f5
it("leaves skipped official plugins out, lists them, and refuses an unknown skipped id", async () => {
  const root = await source(
    {
      alpha: plugin("alpha", { tool: tool(windowsZip) }),
      beta: plugin("beta", { cantools: { install: { pip: "cantools" }, version } }),
    },
    ["alpha", "beta"],
  );
  const out = await output();
  const { fake, fetched, resolved } = tools();
  const { kit } = await buildDependencyKit(root, "windows-x64", out, fake, { skip: ["alpha"] });
  expect(fetched).toEqual([urls.python]);
  expect(resolved).toEqual([["windows-x64", "cantools"]]);
  expect(kit?.plugins).toEqual([{ id: "beta", version: "0.2.0" }]);
  expect(kit?.skipped).toEqual(["alpha"]);
  expect(await readFile(join(out, "README.md"), "utf8")).toContain(
    "Not in this kit (skipped at build): alpha.",
  );
  const other = await output();
  const second = tools();
  await expect(
    buildDependencyKit(root, "windows-x64", other, second.fake, { skip: ["gamma"] }),
  ).rejects.toThrow(/gamma/);
  expect(second.fetched).toEqual([]);
  expect(existsSync(other)).toBe(false);
});
