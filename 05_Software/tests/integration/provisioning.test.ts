import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { NodeProcessHost, PluginStore, Provisioner, pluginPlatform } from "@vera/core";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";

const windows = process.platform === "win32";
const platform = pluginPlatform(process.platform, process.arch);
const tar = windows ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** A small real executable that prints one word: `hostname` on Windows, `uname` elsewhere. */
const probeExecutable = windows
  ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "HOSTNAME.EXE")
  : "/bin/uname";
const exe = windows ? "tool.exe" : "tool";

async function setup(programs: Record<string, unknown>, served: Map<string, Uint8Array>) {
  const root = await mkdtemp(join(tmpdir(), "vera-provision-it-"));
  roots.push(root);
  const source = join(root, "src", "tools");
  await mkdir(source, { recursive: true });
  await writeFile(
    join(source, "plugin.yaml"),
    stringify({
      format: 1,
      id: "tools",
      version: "1.0.0",
      name: "Tools",
      description: "Integration tools.",
      ecosystem: "general",
      platforms: ["windows-x64", "linux-x64"],
      programs,
    }),
  );
  const store = new PluginStore({ root: join(root, "plugins") });
  await store.install(source);
  const fetches: string[] = [];
  const provisioner = new Provisioner({
    store,
    root: join(root, "plugins", "runtime"),
    host: new NodeProcessHost(spawn),
    clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
    platform,
    // Local fixtures only: no test reaches the network.
    fetch: async (url) => {
      fetches.push(url);
      const bytes = served.get(url);
      return bytes ? new Response(new Uint8Array(bytes)) : new Response("missing", { status: 404 });
    },
    settings: () => undefined,
  });
  return { root, store, provisioner, fetches };
}
const download = (url: string, bytes: Uint8Array, path: string) => ({
  install: { download: { [platform as string]: { url, sha256: sha(bytes), path } } },
  version: { args: [], match: "(\\S+)" },
});

// REQ-FUNC-aa09d82e
it("installs .tar.gz and .tar.xz downloads through the system tar", async () => {
  const work = await mkdtemp(join(tmpdir(), "vera-tar-"));
  roots.push(work);
  await mkdir(join(work, "pkg", "tool-1.0", "bin"), { recursive: true });
  copyFileSync(probeExecutable, join(work, "pkg", "tool-1.0", "bin", exe));
  await writeFile(join(work, "pkg", "tool-1.0", "README"), "readme");
  for (const [flag, name] of [
    ["-czf", "tool.tar.gz"],
    ["-cJf", "tool.tar.xz"],
  ] as const)
    expect(spawnSync(tar, [flag, join(work, name), "-C", join(work, "pkg"), "tool-1.0"]).status).toBe(0);
  const gz = await readFile(join(work, "tool.tar.gz"));
  const xz = await readFile(join(work, "tool.tar.xz"));
  const served = new Map([
    ["https://h.test/tool.tar.gz", gz],
    ["https://h.test/tool.tar.xz", xz],
  ]);
  const s = await setup(
    {
      gz: download("https://h.test/tool.tar.gz", gz, `tool-1.0/bin/${exe}`),
      xz: download("https://h.test/tool.tar.xz", xz, `tool-1.0/bin/${exe}`),
    },
    served,
  );
  const statuses = await s.provisioner.install("tools");
  expect(statuses.map((status) => [status.name, status.state])).toEqual([
    ["gz", "ready"],
    ["xz", "ready"],
  ]);
  const downloads = join(s.root, "plugins", "runtime", "downloads");
  for (const bytes of [gz, xz])
    expect(await readFile(join(downloads, sha(bytes), "tool-1.0", "README"), "utf8")).toBe("readme");
  const resolved = await s.provisioner.resolve(await s.store.load("tools"), "xz");
  expect(resolved?.executable).toBe(join(downloads, sha(xz), "tool-1.0", "bin", exe));
  expect(await readdir(join(downloads, ".staging"))).toEqual([]);
});

/** One ustar header block; `type` "0" is a file, "2" a symbolic link. */
function tarHeader(name: string, type: "0" | "2", size: number, link = ""): Buffer {
  const header = Buffer.alloc(512);
  const put = (value: string, offset: number, length: number) => header.write(value, offset, length, "utf8");
  put(name, 0, 100);
  put("0000755\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(`${size.toString(8).padStart(11, "0")}\0`, 124, 12);
  put("00000000000\0", 136, 12);
  put("        ", 148, 8);
  put(type, 156, 1);
  put(link, 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  const sum = header.reduce((total, byte) => total + byte, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

// REQ-SEC-e51bc0d8
it("refuses a tar archive whose link points outside its folder and keeps nothing", async () => {
  const body = Buffer.from("tool");
  const archive = gzipSync(
    Buffer.concat([
      tarHeader("tool/bin/tool", "0", body.length),
      body,
      Buffer.alloc(512 - body.length),
      tarHeader("tool/escape", "2", 0, "../../../../outside"),
      Buffer.alloc(1024),
    ]),
  );
  const s = await setup(
    { tool: download("https://h.test/evil.tar.gz", archive, "tool/bin/tool") },
    new Map([["https://h.test/evil.tar.gz", archive]]),
  );
  // GNU tar creates the link and the tree check refuses it; Windows tar may refuse to create it at all.
  expect((await s.provisioner.install("tools"))[0]).toMatchObject({ state: "missing", problem: "archive" });
  const downloads = join(s.root, "plugins", "runtime", "downloads");
  expect(await readdir(downloads)).toEqual([".staging"]);
  expect(await readdir(join(downloads, ".staging"))).toEqual([]);
});

// REQ-FUNC-c9dde429, REQ-FUNC-514708b5, REQ-SEC-ba78d876
it("finds and probes a real program and checks its range", async () => {
  const entry = process.execPath.replaceAll("\\", "/");
  const version = () => ({ args: ["--version"], match: "v(\\d+\\.\\d+\\.\\d+)" });
  // A fresh object per program: a shared one would become a YAML alias, which manifests refuse.
  const lists = () => (windows ? { windows: [entry] } : { linux: [entry] });
  const s = await setup(
    {
      node: { install: { find: lists() }, version: { ...version(), range: ">=20" } },
      old: { install: { find: lists() }, version: { ...version(), range: "<1" } },
    },
    new Map(),
  );
  expect(await s.provisioner.statuses("tools")).toEqual([
    { name: "node", kind: "find", state: "ready", version: process.versions.node, range: ">=20" },
    {
      name: "old",
      kind: "find",
      state: "unavailable",
      problem: "range",
      version: process.versions.node,
      range: "<1",
    },
  ]);
  expect(existsSync(join(s.root, "plugins", "runtime"))).toBe(true);
  expect(s.fetches).toEqual([]);
});
