import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginSettings } from "@vera/shared";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";
import { FakeHost, type FakeProcess } from "./fake-process-host.test-support.js";
import { Provisioner, pluginPlatform } from "./provisioning.js";
import { PluginStore } from "./store.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const ok = { code: 0, signal: null };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A FakeHost whose processes act on their own: `handle` decides what each spawned program does. */
class ScriptedHost extends FakeHost {
  running = 0;
  maxRunning = 0;
  handle: (process: FakeProcess) => void = (process) => process.finish(ok);
  override spawn(...args: Parameters<FakeHost["spawn"]>) {
    const process = super.spawn(...args);
    if (!process.exited) {
      this.running++;
      this.maxRunning = Math.max(this.maxRunning, this.running);
      void process.exit.then(() => this.running--);
      setTimeout(() => this.handle(process), 2);
    }
    return process;
  }
}

interface Setup {
  programs: Record<string, unknown>;
  platforms?: string[];
  hostPlatform?: "linux" | "win32";
  platform?: "linux-x64" | "windows-x64";
  env?: Record<string, string>;
  settings?: PluginSettings;
  uv?: boolean;
  probeMs?: number;
  installMs?: number;
}
async function setup(options: Setup) {
  const root = await mkdtemp(join(tmpdir(), "vera-provision-"));
  roots.push(root);
  const source = join(root, "src", "tools");
  await mkdir(join(source, "scripts"), { recursive: true });
  await writeFile(
    join(source, "plugin.yaml"),
    stringify({
      format: 1,
      id: "tools",
      version: "1.0.0",
      name: "Tools",
      description: "Test tools.",
      ecosystem: "general",
      platforms: options.platforms ?? ["windows-x64", "linux-x64"],
      programs: options.programs,
    }),
  );
  await writeFile(join(source, "scripts", "serial.py"), "# /// script\n# dependencies = []\n# ///\n");
  const store = new PluginStore({ root: join(root, "plugins") });
  await store.install(source);
  const windows = options.hostPlatform === "win32";
  const host = new ScriptedHost(
    windows ? "win32" : "linux",
    options.env ??
      (windows
        ? { Path: "C:\\Windows", USERPROFILE: "C:\\Users\\u" }
        : { PATH: "/usr/bin", HOME: "/home/u" }),
  );
  const served = new Map<string, () => Response | Promise<Response>>();
  const fetches: string[] = [];
  const uv = join(root, "bundled", windows ? "uv.exe" : "uv");
  const provisioner = new Provisioner({
    store,
    root: join(root, "plugins", "runtime"),
    ...(options.uv === false ? {} : { uv: { executable: uv } }),
    host,
    clock: { sleep: async () => {} },
    platform: options.platform ?? (windows ? "windows-x64" : "linux-x64"),
    fetch: async (url) => {
      fetches.push(url);
      const respond = served.get(url);
      return respond ? respond() : new Response("missing", { status: 404 });
    },
    settings: () => options.settings,
    timeouts: { probeMs: options.probeMs ?? 5000, installMs: options.installMs ?? 60_000 },
  });
  const installed = join(root, "plugins", "installed", "tools");
  const record = async () => JSON.parse(await readFile(join(installed, "install.json"), "utf8"));
  return { root, store, host, provisioner, served, fetches, uv, installed, record, source };
}
const pip = (requirement: string, version: Record<string, unknown> = {}) => ({
  install: { pip: requirement },
  version: { args: ["version"], match: "v(\\d+\\.\\d+\\.\\d+)", ...version },
});
/** uv tool install creates the entry point; every other program prints `text`. */
function uvActs(host: ScriptedHost, uv: string, entry: string, text = "esptool v5.6.0\n5.6.0\n") {
  host.handle = (process) => {
    if (process.executable === uv && process.args[0] === "tool") {
      const bin = process.options.env.UV_TOOL_BIN_DIR as string;
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, entry), "");
      process.print("Installed 4 executables\n");
    } else if (process.executable !== uv || process.args[0] === "run") process.print(text);
    process.finish(ok);
  };
}

// REQ-FUNC-714e26bc, REQ-SEC-e0567486
it("installs a pip program with uv inside the runtime and records its version", async () => {
  const env = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    UV_TOOL_DIR: "/home/u/.local/share/uv/tools",
    UV_INDEX_URL: "https://elsewhere.example/simple",
  };
  const s = await setup({ programs: { esptool: pip("esptool>=5,<6") }, env });
  uvActs(s.host, s.uv, "esptool");
  const statuses = await s.provisioner.install("tools");
  expect(statuses).toEqual([{ name: "esptool", kind: "pip", state: "ready", version: "5.6.0" }]);
  const [install, probe] = s.host.programs;
  expect(install?.executable).toBe(s.uv);
  expect(install?.args).toEqual(["tool", "install", "esptool>=5,<6"]);
  const runtime = join(s.root, "plugins", "runtime");
  expect(install?.options.cwd).toBe(runtime);
  expect(install?.options.env).toMatchObject({
    UV_CACHE_DIR: join(runtime, "cache"),
    UV_PYTHON_INSTALL_DIR: join(runtime, "python"),
    UV_PYTHON_BIN_DIR: join(runtime, "python", "bin"),
    UV_TOOL_DIR: join(runtime, "tools", "tools"),
    UV_TOOL_BIN_DIR: join(runtime, "tools", "tools", "bin"),
    UV_MANAGED_PYTHON: "1",
    UV_PYTHON: "3.13",
    UV_PYTHON_INSTALL_BIN: "0",
    UV_PYTHON_INSTALL_REGISTRY: "0",
    UV_NO_CONFIG: "1",
    UV_NO_PROGRESS: "1",
    HOME: "/home/u",
    PATH: "/usr/bin",
  });
  expect(install?.options.env).not.toHaveProperty("UV_INDEX_URL");
  expect(install?.options.env).not.toHaveProperty("UV_DEFAULT_INDEX");
  expect(install?.options.env).not.toHaveProperty("HTTPS_PROXY");
  const entry = join(runtime, "tools", "tools", "bin", "esptool");
  expect(probe?.executable).toBe(entry);
  expect(probe?.args).toEqual(["version"]);
  expect((await s.record()).programs).toEqual({ esptool: "5.6.0" });
  const plugin = await s.store.load("tools");
  expect(await s.provisioner.resolve(plugin, "esptool")).toEqual({ executable: entry, version: "5.6.0" });
  expect(await s.provisioner.statuses("tools")).toEqual(statuses);
});

// REQ-FUNC-714e26bc
it("takes the .exe entry point of a pip program on Windows", async () => {
  const s = await setup({ programs: { esptool: pip("esptool>=5,<6") }, hostPlatform: "win32" });
  uvActs(s.host, s.uv, "esptool.exe");
  expect((await s.provisioner.install("tools"))[0]).toMatchObject({ state: "ready", version: "5.6.0" });
  expect(s.host.programs[1]?.executable).toBe(
    join(s.root, "plugins", "runtime", "tools", "tools", "bin", "esptool.exe"),
  );
});

// REQ-FUNC-c12941f3
it("passes the package index and proxy settings to uv", async () => {
  const s = await setup({
    programs: { esptool: pip("esptool") },
    settings: { index: "https://mirror.example/simple", proxy: "http://proxy.example:3128" },
  });
  uvActs(s.host, s.uv, "esptool");
  await s.provisioner.install("tools");
  expect(s.host.programs[0]?.options.env).toMatchObject({
    UV_DEFAULT_INDEX: "https://mirror.example/simple",
    HTTPS_PROXY: "http://proxy.example:3128",
    HTTP_PROXY: "http://proxy.example:3128",
  });
});

// REQ-REL-e27cda96
it("reports a failed uv install with its output and records nothing", async () => {
  const s = await setup({ programs: { esptool: pip("esptool") } });
  s.host.handle = (process) => {
    process.print(
      "Resolved 7 packages\nerror: Failed to fetch: https://pypi.org/simple/esptool/\n",
      "stderr",
    );
    process.finish({ code: 2, signal: null });
  };
  const [failed] = await s.provisioner.install("tools");
  expect(failed).toMatchObject({ name: "esptool", kind: "pip", state: "missing", problem: "install" });
  expect(failed?.detail).toContain("error: Failed to fetch");
  expect((await s.record()).programs).toEqual({});
  s.host.handle = (process) => process.finish(ok);
  expect((await s.provisioner.install("tools"))[0]).toMatchObject({ problem: "install" });
  s.host.failNext = "ENOENT";
  expect((await s.provisioner.install("tools"))[0]).toMatchObject({ problem: "install", detail: "ENOENT" });
  expect((await s.record()).programs).toEqual({});
});

// REQ-FUNC-e7cb0626, REQ-FUNC-edbe037c, REQ-SEC-e0567486
it("installs a PEP 723 script with uv sync and runs it offline through uv", async () => {
  const s = await setup({
    programs: {
      serial: {
        install: { script: "scripts/serial.py" },
        version: { args: ["version"], match: "serial (\\S+)" },
      },
    },
    env: {
      PATH: "/usr/bin",
      HOME: "/home/u",
      UV_TOOL_DIR: "/home/u/.local/share/uv/tools",
      UV_INDEX_URL: "x",
    },
  });
  uvActs(s.host, s.uv, "unused", "serial 1.4\n");
  expect(await s.provisioner.install("tools")).toEqual([
    { name: "serial", kind: "script", state: "ready", version: "1.4" },
  ]);
  const script = join(s.installed, "scripts", "serial.py");
  const [sync, probe] = s.host.programs;
  expect(sync?.args).toEqual(["sync", "--script", script]);
  expect(probe?.args).toEqual(["run", "--quiet", "--offline", "--script", script, "version"]);
  const runtime = join(s.root, "plugins", "runtime");
  const uvVariables = {
    UV_CACHE_DIR: join(runtime, "cache"),
    UV_PYTHON_INSTALL_DIR: join(runtime, "python"),
    UV_PYTHON_BIN_DIR: join(runtime, "python", "bin"),
    UV_TOOL_DIR: join(runtime, "tools", "tools"),
    UV_TOOL_BIN_DIR: join(runtime, "tools", "tools", "bin"),
    UV_MANAGED_PYTHON: "1",
    UV_PYTHON: "3.13",
    UV_PYTHON_INSTALL_BIN: "0",
    UV_PYTHON_INSTALL_REGISTRY: "0",
    UV_NO_CONFIG: "1",
    UV_NO_PROGRESS: "1",
  };
  // REQ-SEC-e0567486: the sync, the probe and the resolved run carry exactly these uv variables.
  const uvOnly = (env: Record<string, string> | undefined) =>
    Object.fromEntries(Object.entries(env ?? {}).filter(([name]) => name.startsWith("UV_")));
  expect(uvOnly(sync?.options.env)).toEqual(uvVariables);
  expect(uvOnly(probe?.options.env)).toEqual(uvVariables);
  expect((await s.record()).programs).toEqual({ serial: "1.4" });
  const resolved = await s.provisioner.resolve(await s.store.load("tools"), "serial");
  expect(resolved).toMatchObject({
    executable: s.uv,
    prefix: ["run", "--quiet", "--offline", "--script", script],
    version: "1.4",
  });
  expect(resolved?.env).toEqual(uvVariables);
});

function download(url: string, bytes: Uint8Array, extra: Record<string, unknown> = {}) {
  return {
    install: { download: { "linux-x64": { url, sha256: sha(bytes), ...extra } } },
    version: { args: ["--version"], match: "tool (\\S+)" },
  };
}

// REQ-FUNC-aa09d82e
it("installs a zip download into downloads/<sha256> and reuses it", async () => {
  const zip = zipSync({ "tool-1.0/bin/tool": strToU8("#!/bin/sh\n"), "tool-1.0/README": strToU8("r") });
  const url = "https://h.test/tool-1.0.zip";
  const s = await setup({ programs: { tool: download(url, zip, { path: "tool-1.0/bin/tool" }) } });
  s.served.set(url, () => new Response(zip));
  s.host.handle = (process) => {
    process.print("tool 1.0\n");
    process.finish(ok);
  };
  expect(await s.provisioner.install("tools")).toEqual([
    { name: "tool", kind: "download", state: "ready", version: "1.0" },
  ]);
  const folder = join(s.root, "plugins", "runtime", "downloads", sha(zip));
  expect(await readFile(join(folder, "tool-1.0", "bin", "tool"), "utf8")).toBe("#!/bin/sh\n");
  expect(s.host.programs[0]?.executable).toBe(join(folder, "tool-1.0", "bin", "tool"));
  expect(await readdir(join(s.root, "plugins", "runtime", "downloads", ".staging"))).toEqual([]);
  // A reinstall resets the record; the verified folder is reused without downloading again.
  await s.store.install(s.source);
  expect((await s.provisioner.install("tools"))[0]).toMatchObject({ state: "ready" });
  expect(s.fetches).toEqual([url]);
});

// REQ-FUNC-d30d568c
it("stores a single-file download as is, executable, with its prefix", async () => {
  const image = strToU8("\x7fELF appimage");
  const url = "https://h.test/r/PulseView-x86_64.AppImage";
  const s = await setup({ programs: { "sigrok-cli": download(url, image, { prefix: ["--cli"] }) } });
  s.served.set(url, () => new Response(image));
  s.host.handle = (process) => {
    process.print("tool 0.6.0\n");
    process.finish(ok);
  };
  expect((await s.provisioner.install("tools"))[0]).toMatchObject({ state: "ready", version: "0.6.0" });
  const file = join(s.root, "plugins", "runtime", "downloads", sha(image), "PulseView-x86_64.AppImage");
  expect(s.host.programs[0]?.args).toEqual(["--cli", "--version"]);
  expect(await s.provisioner.resolve(await s.store.load("tools"), "sigrok-cli")).toEqual({
    executable: file,
    prefix: ["--cli"],
    version: "0.6.0",
  });
  // Execute bits exist only where the file system keeps POSIX modes.
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o755);
});

// REQ-SEC-cde8b481
it("refuses a download with another hash and keeps nothing", async () => {
  const url = "https://h.test/tool.AppImage";
  const s = await setup({ programs: { tool: download(url, strToU8("expected")) } });
  s.served.set(url, () => new Response(strToU8("tampered")));
  expect(await s.provisioner.install("tools")).toEqual([
    { name: "tool", kind: "download", state: "missing", problem: "sha256" },
  ]);
  const downloads = join(s.root, "plugins", "runtime", "downloads");
  expect(await readdir(downloads)).toEqual([".staging"]);
  expect(await readdir(join(downloads, ".staging"))).toEqual([]);
  expect((await s.record()).programs).toEqual({});
  expect(s.host.programs).toEqual([]);
});

// REQ-SEC-e51bc0d8
it("refuses a zip that writes outside its folder and keeps nothing", async () => {
  const zip = zipSync({ "bin/tool": strToU8("x"), "../escape": strToU8("evil") });
  const url = "https://h.test/tool.zip";
  const s = await setup({ programs: { tool: download(url, zip, { path: "bin/tool" }) } });
  s.served.set(url, () => new Response(zip));
  expect((await s.provisioner.install("tools"))[0]).toMatchObject({ state: "missing", problem: "archive" });
  const downloads = join(s.root, "plugins", "runtime", "downloads");
  expect(await readdir(downloads)).toEqual([".staging"]);
  expect(await readdir(join(downloads, ".staging"))).toEqual([]);
  expect(existsSync(join(downloads, ".staging", "escape"))).toBe(false);
});

// REQ-REL-e068dcd7
it("reports failed transfers and archives without the declared path", async () => {
  const zip = zipSync({ "bin/other": strToU8("x") });
  const s = await setup({
    programs: {
      a: download("https://h.test/a.bin", strToU8("a")),
      b: download("https://h.test/b.bin", strToU8("b")),
      c: download("https://h.test/c.bin", strToU8("c")),
      d: download("https://h.test/d.zip", zip, { path: "bin/tool" }),
    },
  });
  s.served.set("https://h.test/a.bin", () => Promise.reject(new TypeError("fetch failed")));
  s.served.set(
    "https://h.test/c.bin",
    () => new Response(strToU8("c"), { headers: { "content-length": String(3 * 1024 ** 3) } }),
  );
  s.served.set("https://h.test/d.zip", () => new Response(zip));
  const statuses = await s.provisioner.install("tools");
  expect(statuses.map((status) => [status.name, status.state, status.problem])).toEqual([
    ["a", "missing", "download"],
    ["b", "missing", "download"],
    ["c", "missing", "download"],
    ["d", "missing", "archive"],
  ]);
  const downloads = join(s.root, "plugins", "runtime", "downloads");
  expect(await readdir(downloads)).toEqual([".staging"]);
  expect(await readdir(join(downloads, ".staging"))).toEqual([]);
});

async function executable(path: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "");
}
const find = (lists: Record<string, string[]>, extra: Record<string, unknown> = {}) => ({
  install: { find: lists, ...extra },
  version: { args: ["--version"], match: "git version (\\d+\\.\\d+\\.\\d+)" },
});

// REQ-FUNC-c9dde429
it("finds programs on PATH and through globs, highest name first", async () => {
  // PATH separators and executable names follow the running system, so this case runs natively.
  const windows = process.platform === "win32";
  const exe = (name: string) => (windows ? `${name}.exe` : name);
  const base = await mkdtemp(join(tmpdir(), "vera-find-"));
  roots.push(base);
  await mkdir(join(base, "empty"));
  await executable(join(base, "second", exe("git")));
  await executable(join(base, "home", "tools", "tool-1.2", "bin", exe("tool")));
  await executable(join(base, "home", "tools", "tool-1.10", "bin", exe("tool")));
  await executable(join(base, "opt", exe("exact")));
  const list = (entries: string[]) => (windows ? { windows: entries } : { linux: entries });
  const s = await setup({
    programs: {
      git: find(list([windows ? "%PATH%" : "$PATH"])),
      tool: find(list([windows ? "%UNSET_VARIABLE%/bin" : "$UNSET_VARIABLE/bin", "~/tools/tool-*/bin"])),
      exact: find(list([`${base}/opt/${exe("exact")}`])),
    },
    hostPlatform: windows ? "win32" : "linux",
    env: {
      PATH: [join(base, "empty"), join(base, "second")].join(windows ? ";" : ":"),
      [windows ? "USERPROFILE" : "HOME"]: join(base, "home"),
    },
  });
  s.host.handle = (process) => {
    process.print("git version 2.44.0\n");
    process.finish(ok);
  };
  const plugin = await s.store.load("tools");
  expect((await s.provisioner.resolve(plugin, "git"))?.executable).toBe(join(base, "second", exe("git")));
  expect((await s.provisioner.resolve(plugin, "tool"))?.executable).toBe(
    join(base, "home", "tools", "tool-1.10", "bin", exe("tool")),
  );
  expect((await s.provisioner.resolve(plugin, "exact"))?.executable).toBe(join(base, "opt", exe("exact")));
  // Resolutions are cached until an install or an invalidation.
  const spawned = s.host.programs.length;
  await s.provisioner.resolve(plugin, "git");
  expect(s.host.programs.length).toBe(spawned);
  s.provisioner.invalidate();
  await s.provisioner.resolve(plugin, "git");
  expect(s.host.programs.length).toBe(spawned + 1);
});

// REQ-FUNC-c9dde429
it("expands %NAME% and accepts only .exe files on Windows", async () => {
  const base = await mkdtemp(join(tmpdir(), "vera-find-"));
  roots.push(base);
  await executable(join(base, "local", "Programs", "Git", "cmd", "git"));
  await executable(join(base, "local", "Programs", "Git2", "cmd", "git.exe"));
  const s = await setup({
    programs: {
      git: find({ windows: ["%LOCALAPPDATA%/Programs/Git/cmd", "%LOCALAPPDATA%/Programs/Git*/cmd"] }),
    },
    hostPlatform: "win32",
    env: { Path: "C:\\Windows", LocalAppData: join(base, "local") },
  });
  s.host.handle = (process) => {
    process.print("git version 2.47.1.windows.1\n");
    process.finish(ok);
  };
  expect(await s.provisioner.statuses("tools")).toEqual([
    { name: "git", kind: "find", state: "ready", version: "2.47.1" },
  ]);
  expect(s.host.programs[0]?.executable).toBe(join(base, "local", "Programs", "Git2", "cmd", "git.exe"));
});

// REQ-UX-46085ddf
it("reports a missing find program with its hint and link", async () => {
  const s = await setup({
    programs: {
      tshark: find(
        { linux: ["$PATH", "/nonexistent/wireshark/tshark"] },
        { hint: "Install Wireshark from https://www.wireshark.org/download.html." },
      ),
    },
  });
  expect(await s.provisioner.install("tools")).toEqual([
    {
      name: "tshark",
      kind: "find",
      state: "missing",
      problem: "notFound",
      hint: "Install Wireshark from https://www.wireshark.org/download.html.",
      link: "https://www.wireshark.org/download.html",
    },
  ]);
  expect(s.host.programs).toEqual([]);
});

// REQ-FUNC-514708b5, REQ-SEC-ba78d876
it("checks the probed version against the supported range", async () => {
  const base = await mkdtemp(join(tmpdir(), "vera-find-"));
  roots.push(base);
  await executable(join(base, "git"));
  const programs = {
    ranged: find({ linux: [`${base}/git`] }, {}),
    plain: find({ linux: [`${base}/git`] }),
  };
  (programs.ranged.version as Record<string, unknown>).range = ">=2.40";
  const s = await setup({ programs });
  let text = "git version 2.44.0\n";
  let code = 0;
  s.host.handle = (process) => {
    process.print(text);
    process.finish({ code, signal: null });
  };
  expect(await s.provisioner.statuses("tools")).toEqual([
    { name: "plain", kind: "find", state: "ready", version: "2.44.0" },
    { name: "ranged", kind: "find", state: "ready", version: "2.44.0", range: ">=2.40" },
  ]);
  s.provisioner.invalidate();
  text = "git version 2.39.1\n";
  code = 1;
  const plugin = await s.store.load("tools");
  expect((await s.provisioner.statuses("tools"))[1]).toEqual({
    name: "ranged",
    kind: "find",
    state: "unavailable",
    problem: "range",
    version: "2.39.1",
    range: ">=2.40",
  });
  expect(await s.provisioner.resolve(plugin, "ranged")).toBeUndefined();
  // A matching probe counts whatever its exit code.
  expect(await s.provisioner.resolve(plugin, "plain")).toMatchObject({ version: "2.39.1" });
});

// REQ-SEC-ba78d876
it("makes programs with unreadable versions unavailable", async () => {
  const base = await mkdtemp(join(tmpdir(), "vera-find-"));
  roots.push(base);
  await executable(join(base, "git"));
  const s = await setup({ programs: { git: find({ linux: [`${base}/git`] }) }, probeMs: 30 });
  const plugin = await s.store.load("tools");
  const unavailable = { name: "git", kind: "find", state: "unavailable", problem: "version" };
  s.host.handle = (process) => {
    process.print("usage: git [--version]\n");
    process.finish(ok);
  };
  expect(await s.provisioner.statuses("tools")).toEqual([unavailable]);
  expect(await s.provisioner.resolve(plugin, "git")).toBeUndefined();
  s.provisioner.invalidate();
  s.host.handle = () => {};
  expect(await s.provisioner.statuses("tools")).toEqual([unavailable]);
  expect(s.host.signals.some(([pid, signal]) => pid < 0 && signal === "SIGTERM")).toBe(true);
  s.provisioner.invalidate();
  s.host.failNext = "EACCES";
  expect(await s.provisioner.statuses("tools")).toEqual([unavailable]);
});

// REQ-SEC-49ff111b, REQ-FUNC-13ef1c0c
it("resolves and lists programs without installing anything", async () => {
  const s = await setup({
    programs: {
      esptool: pip("esptool"),
      serial: { install: { script: "scripts/serial.py" }, version: { args: ["v"], match: "(\\S+)" } },
      tool: download("https://h.test/t.AppImage", strToU8("t")),
    },
  });
  const plugin = await s.store.load("tools");
  for (const name of ["esptool", "serial", "tool"])
    expect(await s.provisioner.resolve(plugin, name)).toBeUndefined();
  expect(await s.provisioner.statuses("tools")).toEqual([
    { name: "esptool", kind: "pip", state: "missing" },
    { name: "serial", kind: "script", state: "missing" },
    { name: "tool", kind: "download", state: "missing" },
  ]);
  expect(s.host.processes).toEqual([]);
  expect(s.fetches).toEqual([]);
});

// REQ-FUNC-5491d410, REQ-FUNC-06eaa9a5
it("reports programs this platform cannot run and launcher programs as unavailable", async () => {
  const s = await setup({
    programs: {
      a: {
        ...download("https://h.test/a.AppImage", strToU8("a")),
        install: { download: { "windows-x64": { url: "https://h.test/a.exe", sha256: "a".repeat(64) } } },
      },
      b: find({ windows: ["%PATH%"] }),
      c: { ...find({ linux: ["$PATH"] }), launcher: ["eim", "run"] },
    },
  });
  expect(await s.provisioner.install("tools")).toEqual([
    { name: "a", kind: "download", state: "unavailable", problem: "platform" },
    { name: "b", kind: "find", state: "unavailable", problem: "platform" },
    { name: "c", kind: "find", state: "unavailable", problem: "launcher" },
  ]);
  const other = await setup({ programs: { esptool: pip("esptool") }, platforms: ["windows-x64"] });
  expect(await other.provisioner.install("tools")).toEqual([
    { name: "esptool", kind: "pip", state: "unavailable", problem: "platform" },
  ]);
  const noUv = await setup({ programs: { esptool: pip("esptool") }, uv: false });
  expect(await noUv.provisioner.install("tools")).toEqual([
    { name: "esptool", kind: "pip", state: "unavailable", problem: "uv" },
  ]);
  for (const each of [s, other, noUv]) {
    expect(each.host.processes).toEqual([]);
    expect(each.fetches).toEqual([]);
  }
});

// REQ-FUNC-86daf060
it("installs one program at a time and refuses unknown or changed plugins", async () => {
  const s = await setup({ programs: { b: pip("b-tool"), a: pip("a-tool") } });
  s.host.handle = (process) => {
    if (process.args[0] === "tool") {
      const bin = process.options.env.UV_TOOL_BIN_DIR as string;
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, process.args[2] === "a-tool" ? "a" : "b"), "");
    } else process.print("v1.0.0\n");
    process.finish(ok);
  };
  const [first, second] = await Promise.all([s.provisioner.install("tools"), s.provisioner.install("tools")]);
  expect(first?.map((status) => [status.name, status.state])).toEqual([
    ["a", "ready"],
    ["b", "ready"],
  ]);
  expect(second).toEqual(first);
  expect(s.host.maxRunning).toBe(1);
  expect(s.host.programs.filter((process) => process.args[0] === "tool")).toHaveLength(2);
  expect((await s.record()).programs).toEqual({ a: "1.0.0", b: "1.0.0" });
  await expect(s.provisioner.install("other")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await appendFile(join(s.installed, "scripts", "serial.py"), "# edited\n");
  await expect(s.provisioner.install("tools")).rejects.toMatchObject({ code: "INVALID" });
  await expect(s.provisioner.statuses("tools")).rejects.toMatchObject({ code: "INVALID" });
});

it("names the platform of a host", () => {
  expect(pluginPlatform("win32", "x64")).toBe("windows-x64");
  expect(pluginPlatform("linux", "x64")).toBe("linux-x64");
  expect(pluginPlatform("linux", "arm64")).toBe("linux-arm64");
  expect(pluginPlatform("darwin", "arm64")).toBeUndefined();
  expect(pluginPlatform("win32", "arm64")).toBeUndefined();
});

/** A response body that sends one chunk and then never ends. */
const stalled = () =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    }),
  );

// REQ-REL-e068dcd7
it("ends a stalled download at the install deadline and keeps nothing", async () => {
  const url = "https://h.test/slow.AppImage";
  const s = await setup({ programs: { tool: download(url, strToU8("x")) }, installMs: 50 });
  s.served.set(url, stalled);
  const staging = join(s.root, "plugins", "runtime", "downloads", ".staging");
  // A folder older than the deadline was left by a crash; a younger one may belong to another process.
  await mkdir(join(staging, "crashed-before"), { recursive: true });
  const hourAgo = new Date(Date.now() - 3_600_000);
  await utimes(join(staging, "crashed-before"), hourAgo, hourAgo);
  await mkdir(join(staging, "other-process"));
  const inAnHour = new Date(Date.now() + 3_600_000);
  await utimes(join(staging, "other-process"), inAnHour, inAnHour);
  expect((await s.provisioner.install("tools"))[0]).toMatchObject({ state: "missing", problem: "download" });
  expect(await readdir(staging)).toEqual(["other-process"]);
});

// REQ-FUNC-86daf060
it("stops running installs when it closes and records versions installed before a failure", async () => {
  const s = await setup({ programs: { a: pip("a-tool"), b: pip("b-tool") } });
  s.host.handle = (process) => {
    if (process.args[2] === "b-tool") return; // b's install hangs until it is stopped
    if (process.args[0] === "tool") {
      const bin = process.options.env.UV_TOOL_BIN_DIR as string;
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, "a"), "");
    } else process.print("v1.0.0\n");
    process.finish(ok);
  };
  const installing = s.provisioner.install("tools");
  for (let i = 0; i < 200 && !s.host.programs.some((p) => p.args[2] === "b-tool"); i++)
    await new Promise((done) => setTimeout(done, 5));
  s.provisioner.close();
  await expect(installing).rejects.toMatchObject({ name: "AbortError" });
  expect(s.host.signals.some(([pid, signal]) => pid < 0 && signal === "SIGTERM")).toBe(true);
  expect((await s.record()).programs).toEqual({ a: "1.0.0" });
  await expect(s.provisioner.install("tools")).rejects.toMatchObject({ name: "AbortError" });
});

// REQ-FUNC-13ef1c0c
it("keeps a shared resolution for other callers when one caller aborts", async () => {
  const base = await mkdtemp(join(tmpdir(), "vera-find-"));
  roots.push(base);
  await executable(join(base, "git"));
  const s = await setup({ programs: { git: find({ linux: [`${base}/git`] }) } });
  let release: (() => void) | undefined;
  s.host.handle = (process) => {
    release = () => {
      process.print("git version 2.44.0\n");
      process.finish(ok);
    };
  };
  const plugin = await s.store.load("tools");
  const controller = new AbortController();
  const first = s.provisioner.resolve(plugin, "git", controller.signal);
  const second = s.provisioner.statuses("tools");
  // Abort only once the shared probe is running, so the abort meets work in progress.
  for (let i = 0; i < 400 && !release; i++) await new Promise((done) => setTimeout(done, 5));
  controller.abort();
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  release?.();
  expect(await second).toEqual([{ name: "git", kind: "find", state: "ready", version: "2.44.0" }]);
});

// REQ-FUNC-c9dde429: execute bits exist only where the file system keeps POSIX modes.
it.skipIf(process.platform === "win32")("skips found files that are not executable on Linux", async () => {
  const base = await mkdtemp(join(tmpdir(), "vera-find-"));
  roots.push(base);
  await writeFile(join(base, "a-git"), "", { mode: 0o644 });
  await writeFile(join(base, "b-git"), "", { mode: 0o755 });
  const s = await setup({ programs: { git: find({ linux: [`${base}/a-git`, `${base}/b-git`] }) } });
  s.host.handle = (process) => {
    process.print("git version 2.44.0\n");
    process.finish(ok);
  };
  expect((await s.provisioner.resolve(await s.store.load("tools"), "git"))?.executable).toBe(
    join(base, "b-git"),
  );
});
