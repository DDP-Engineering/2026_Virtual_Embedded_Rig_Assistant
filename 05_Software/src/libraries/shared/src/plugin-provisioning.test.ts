import { expect, it } from "vitest";
import { channels } from "./ipc.js";
import {
  downloadForm,
  downloadName,
  pluginProgramStatusSchema,
  validatePluginManifest,
  versionInRange,
} from "./plugins.js";
import { settingsPatchSchema, settingsSchema } from "./settings.js";

const manifest = (install: unknown, version: Record<string, unknown> = {}) => ({
  format: 1,
  id: "tools",
  version: "1.0.0",
  name: "Tools",
  description: "Test tools.",
  ecosystem: "general",
  platforms: ["windows-x64", "linux-x64"],
  programs: { tool: { install, version: { args: ["--version"], match: "(\\d+\\.\\d+)", ...version } } },
});
const paths = (data: unknown) => [...new Set(validatePluginManifest(data).issues.map((issue) => issue.path))];
const sha256 = "b".repeat(64);

// REQ-DATA-4d4471f9
it("accepts a strict find with pinned download fallback in format 1", () => {
  const download = { "linux-x64": { url: "https://h.test/t.zip", sha256, path: "bin/tool" } };
  const install = { find: { linux: ["$PATH"] }, download, hint: "Install from Plugins." };
  expect(paths(manifest(install))).toEqual([]);
  expect(paths(manifest({ ...install, pip: "tool" }))).toEqual(["programs.tool.install"]);
  expect(paths(manifest({ ...install, download: {} }))).not.toEqual([]);
  expect(
    paths(manifest({ ...install, download: { "linux-x64": { ...download["linux-x64"], sha256: "bad" } } })),
  ).not.toEqual([]);
  const data = manifest(install);
  expect(
    paths({
      ...data,
      programs: { tool: { ...data.programs.tool, launcher: ["tool"], launcherMode: "argv" } },
    }),
  ).toContain("programs.tool.install");
});

// REQ-DATA-4d4471f9
it("validates supported ranges, pip requirements, find patterns and archive paths", () => {
  expect(paths(manifest({ pip: "esptool>=5,<6" }, { range: ">=5,<6" }))).toEqual([]);
  expect(paths(manifest({ pip: "esptool" }, { range: ">= 2.40 , != 2.41.1" }))).toEqual([]);
  for (const range of [">=x", "5", ">=5,", "~=5", "", "> =5"])
    expect(paths(manifest({ pip: "esptool" }, { range })), range).toEqual(["programs.tool.version.range"]);
  for (const pip of ["-e x", "--index-url=https://evil", "./local", " "])
    expect(paths(manifest({ pip })), pip).toEqual(["programs.tool.install.pip"]);
  expect(paths(manifest({ find: { windows: ["C:/Program Files/Git/cmd/git.exe", "%PATH%"] } }))).toEqual([]);
  expect(paths(manifest({ find: { linux: ["~/x-*/bin", "$PATH"] } }))).toEqual([]);
  expect(paths(manifest({ find: { windows: ["C:/**/git.exe"] } }))).toEqual([
    "programs.tool.install.find.windows.0",
  ]);
  // At most two segments with *: more would enumerate whole drives.
  expect(paths(manifest({ find: { linux: ["/*/*/*/x"] } }))).toEqual(["programs.tool.install.find.linux.0"]);
  expect(paths(manifest({ find: { windows: ["C:\\a*\\b*\\c*"] } }))).toEqual([
    "programs.tool.install.find.windows.0",
  ]);
  expect(paths(manifest({ find: { linux: ["/opt/tool-*/lib-*/bin"] } }))).toEqual([]);
  expect(paths(manifest({ find: { linux: ["/opt/a\tb"] } }))).toEqual(["programs.tool.install.find.linux.0"]);
  for (const entry of ["node.exe", "bin/tool", "//server/share/tool", "\\\\server\\share\\tool.exe"])
    expect(paths(manifest({ find: { windows: [entry] } })), entry).toEqual([
      "programs.tool.install.find.windows.0",
    ]);
  for (const entry of [
    "%LOCALAPPDATA%/Programs/Git/cmd",
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "~",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a find entry naming a variable.
    "${HOME}/x",
    "/usr/bin/git",
  ])
    expect(paths(manifest({ find: { windows: [entry] } })), entry).toEqual([]);
  const entry = (url: string, path?: string) =>
    manifest({ download: { "linux-x64": { url, sha256, ...(path ? { path } : {}) } } });
  expect(paths(entry("https://h.test/tool.tar.xz", "tool/bin/tool"))).toEqual([]);
  expect(paths(entry("https://h.test/PulseView-x86_64.AppImage"))).toEqual([]);
  expect(paths(entry("https://h.test/download?id=3", "tool"))).toEqual([]);
  for (const url of [
    "https://h.test/tool.tar.xz",
    "https://h.test/t.ZIP",
    "https://h.test/t.tgz",
    "https://h.test/t.tar.gz",
  ])
    expect(paths(entry(url)), url).toEqual(["programs.tool.install.download.linux-x64.path"]);
  for (const url of ["https://h.test/", "https://h.test/a/..%2F..%2Fx", "https://h.test/con"])
    expect(paths(entry(url)), url).toEqual(["programs.tool.install.download.linux-x64.path"]);
});

// REQ-FUNC-aa09d82e, REQ-FUNC-d30d568c
it("tells archives from single files and names the stored file", () => {
  expect(downloadForm("https://h.test/a/probe-rs.tar.xz")).toBe("tar");
  expect(downloadForm("https://h.test/a/x.TGZ?sig=1")).toBe("tar");
  expect(downloadForm("https://h.test/a/x.tar.gz#f")).toBe("tar");
  expect(downloadForm("https://h.test/a/x.Zip")).toBe("zip");
  expect(downloadForm("https://h.test/a/PulseView.AppImage")).toBe("file");
  expect(downloadForm("https://h.test/a/x.zip.sig")).toBe("file");
  expect(downloadName({ url: "https://h.test/r/PulseView-x86_64.AppImage?x=1" })).toBe(
    "PulseView-x86_64.AppImage",
  );
  expect(downloadName({ url: "https://h.test/r/a%20b.bin" })).toBe("a b.bin");
  expect(downloadName({ url: "https://h.test/r/tool", path: "bin/tool" })).toBe("bin/tool");
  expect(downloadName({ url: "https://h.test/r/" })).toBeUndefined();
});

// REQ-FUNC-514708b5, REQ-SEC-ba78d876
it("compares dotted versions numerically against every comparator of a range", () => {
  expect(versionInRange("2.44.0", ">=2.40")).toBe(true);
  expect(versionInRange("2.39.1", ">=2.40")).toBe(false);
  expect(versionInRange("2.10", ">2.9")).toBe(true);
  expect(versionInRange("5.6.0", ">=5,<6")).toBe(true);
  expect(versionInRange("6.0", ">=5,<6")).toBe(false);
  expect(versionInRange("5", "==5.0.0")).toBe(true);
  expect(versionInRange("5.0.1", "!=5.0.1")).toBe(false);
  expect(versionInRange("4.7.0", "<=4.7")).toBe(true);
  expect(versionInRange("1.2.3rc1", ">=1.2")).toBe(true);
  expect(versionInRange("v1.2", ">=1")).toBe(false);
  expect(versionInRange("dev", ">=0")).toBe(false);
});

// REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060
it("validates program statuses and the programs and provision channels", () => {
  const statuses = [
    { name: "esptool", kind: "pip", state: "ready", version: "5.6.0" },
    { name: "git", kind: "find", state: "unavailable", problem: "range", version: "2.39.1", range: ">=2.40" },
    {
      name: "tshark",
      kind: "find",
      state: "missing",
      problem: "notFound",
      hint: "Install Wireshark from https://www.wireshark.org/.",
      link: "https://www.wireshark.org/",
    },
    { name: "probe", kind: "download", state: "missing", problem: "sha256" },
    { name: "serial", kind: "script", state: "missing", problem: "install", detail: "error: no network" },
  ];
  for (const status of statuses) expect(pluginProgramStatusSchema.parse(status)).toEqual(status);
  for (const bad of [
    { name: "x", kind: "pip", state: "broken" },
    { name: "x", kind: "apt", state: "ready" },
    { name: "x", kind: "pip", state: "ready", extra: 1 },
    { name: "x", kind: "pip", state: "missing", problem: "other" },
  ])
    expect(pluginProgramStatusSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  for (const name of ["plugins.programs", "plugins.provision"] as const) {
    const channel = channels[name];
    expect(channel.request.parse({ id: "esp32-esptool" })).toEqual({ id: "esp32-esptool" });
    expect(channel.request.safeParse({ id: "../x" }).success).toBe(false);
    expect(channel.request.safeParse({ id: "x", extra: 1 }).success).toBe(false);
    expect(channel.response.parse(statuses)).toEqual(statuses);
  }
});

// REQ-FUNC-c12941f3, REQ-SEC-0bc97768
it("accepts http and https index and proxy settings without credentials", () => {
  const plugins = { index: "https://mirror.example/simple", proxy: "http://proxy.example:3128" };
  expect(settingsPatchSchema.parse({ plugins })).toEqual({ plugins });
  expect(settingsPatchSchema.parse({ plugins: {} })).toEqual({ plugins: {} });
  expect(settingsSchema.shape.plugins.parse(undefined)).toBeUndefined();
  for (const bad of [
    { index: "ftp://mirror.example/simple" },
    { proxy: "http://user:pw@proxy.example:3128" },
    { index: "https://u@mirror.example/simple" },
    { proxy: "socks5://proxy.example:1080" },
    { index: "not a url" },
    { other: "x" },
  ])
    expect(settingsPatchSchema.safeParse({ plugins: bad }).success, JSON.stringify(bad)).toBe(false);
});

// REQ-FUNC-12ee8b64, REQ-DATA-fcbcb9dc
it("reads .7z downloads as their own form, for windows-x64 only, with a named executable", () => {
  expect(downloadForm("https://h.test/r/ngspice-47_64.7z")).toBe("7z");
  expect(downloadForm("https://h.test/r/x.7Z?mirror=1")).toBe("7z");
  expect(downloadForm("https://h.test/r/x.7z.sig")).toBe("file");
  const seven = (platform: string, path?: string) =>
    manifest({
      download: { [platform]: { url: "https://h.test/r/n.7z", sha256, ...(path ? { path } : {}) } },
    });
  expect(paths(seven("windows-x64", "Spice64/bin/ngspice_con.exe"))).toEqual([]);
  expect(paths(seven("windows-x64"))).toEqual(["programs.tool.install.download.windows-x64.path"]);
  expect(paths(seven("linux-x64", "bin/ngspice"))).toEqual(["programs.tool.install.download.linux-x64.url"]);
});

// REQ-FUNC-38f964da, REQ-DATA-fcbcb9dc
it("accepts uses only for find or download programs of the same plugin, once each, never itself", () => {
  const version = { args: ["--version"], match: "(d+)" };
  const plugin = (uses: unknown, engine: unknown = { find: { linux: ["$PATH"] } }) => ({
    ...manifest({ script: "helper.py" }),
    programs: {
      engine: { install: engine, version },
      helper: { install: { script: "helper.py" }, version, uses },
    },
  });
  expect(paths(plugin(["engine"]))).toEqual([]);
  expect(
    paths(
      plugin(["engine"], { download: { "linux-x64": { url: "https://h.test/e.zip", sha256, path: "e" } } }),
    ),
  ).toEqual([]);
  expect(paths(plugin(["missing"]))).toEqual(["programs.helper.uses"]);
  expect(paths(plugin(["helper"]))).toEqual(["programs.helper.uses"]);
  expect(paths(plugin(["engine", "engine"]))).toEqual(["programs.helper.uses"]);
  expect(paths(plugin(["engine"], { script: "engine.py" }))).toEqual(["programs.helper.uses"]);
  expect(paths(plugin([]))).toEqual(["programs.helper.uses"]);
  const twins = {
    ...manifest({ script: "helper.py" }),
    programs: {
      "a-b": { install: { find: { linux: ["$PATH"] } }, version },
      "a.b": { install: { find: { linux: ["$PATH"] } }, version },
      helper: { install: { script: "helper.py" }, version, uses: ["a-b", "a.b"] },
    },
  };
  expect(paths(twins)).toEqual(["programs.helper.uses"]);
});
