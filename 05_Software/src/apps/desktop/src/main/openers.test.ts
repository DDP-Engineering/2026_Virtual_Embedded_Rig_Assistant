// REQ-FUNC-fe252a3c REQ-FUNC-593428f6 REQ-FUNC-aad416b5 REQ-FUNC-62ed1c20 REQ-FUNC-ad5254e8 REQ-FUNC-6bf664d7
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateEntry } from "@vera/core";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

let openers: typeof import("./openers.js");
beforeAll(async () => {
  expect(existsSync(new URL("./openers.ts", import.meta.url)), "openers module exists").toBe(true);
  openers = await import("./openers.js");
});
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function bench() {
  const root = await mkdtemp(join(tmpdir(), "vera-openers-"));
  const outside = await mkdtemp(join(tmpdir(), "vera-openers-out-"));
  roots.push(root, outside);
  await mkdir(join(root, "firmware"), { recursive: true });
  await writeFile(join(root, "firmware", "main.c"), "int main(void);");
  await writeFile(join(root, "photo.png"), "png");
  // Windows Terminal reads ';' in an argument as the start of another command.
  await mkdir(join(root, "a;b"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "config"), "[core]");
  let linked = false;
  try {
    await symlink(outside, join(root, "link"), process.platform === "win32" ? "junction" : "dir");
    linked = true;
  } catch {
    // Links may be unavailable; the other cases still run.
  }
  const locate = (path: string) => () => locateEntry(root, path);
  return { root, linked, locate };
}
const local = "C:\\Users\\u\\AppData\\Local";
const winEnv = {
  LOCALAPPDATA: local,
  ProgramFiles: "C:\\Program Files",
  "ProgramFiles(x86)": "C:\\Program Files (x86)",
  SystemRoot: "C:\\Windows",
  PATH: "C:\\Tools\\VS Code\\bin;C:\\Windows\\System32",
};
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const cmd = "C:\\Windows\\System32\\cmd.exe";
const wt = `${local}\\Microsoft\\WindowsApps\\wt.exe`;

it("detects installed editors and the terminal on Windows from install folders and PATH", () => {
  const files = new Set([
    "C:\\Tools\\VS Code\\bin\\code.cmd",
    "C:\\Tools\\VS Code\\Code.exe",
    "C:\\Program Files\\Notepad++\\notepad++.exe",
    wt,
    powershell,
    cmd,
  ]);
  const found = openers.detectOpeners({ platform: "win32", env: winEnv, exists: (path) => files.has(path) });
  // code.cmd on PATH leads to the Code.exe beside its bin folder; Cursor is not installed.
  expect([...found.keys()]).toEqual(["vscode", "notepadpp", "terminal"]);
  expect(found.get("vscode")).toEqual({ command: "C:\\Tools\\VS Code\\Code.exe", style: "path" });
  expect(found.get("notepadpp")).toEqual({
    command: "C:\\Program Files\\Notepad++\\notepad++.exe",
    style: "path",
  });
  expect(found.get("terminal")).toEqual({ command: wt, style: "wt" });
  // Without Windows Terminal, PowerShell started by cmd.exe; a per-user VS Code is found without PATH.
  const other = openers.detectOpeners({
    platform: "win32",
    env: { ...winEnv, PATH: "" },
    exists: (path) =>
      path === powershell ||
      path === cmd ||
      path === `${local}\\Programs\\Microsoft VS Code\\Code.exe` ||
      path === `${local}\\Programs\\cursor\\Cursor.exe`,
  });
  expect([...other.keys()]).toEqual(["vscode", "cursor", "terminal"]);
  expect(other.get("terminal")).toEqual({ command: powershell, style: "powershell", host: cmd });
  // Cursor from Program Files, or from the cursor.cmd its installer puts on PATH.
  const machine = openers.detectOpeners({
    platform: "win32",
    env: { ...winEnv, PATH: "" },
    exists: (path) => path === "C:\\Program Files\\cursor\\Cursor.exe",
  });
  expect(machine.get("cursor")?.command).toBe("C:\\Program Files\\cursor\\Cursor.exe");
  const bin = "D:\\Apps\\cursor\\resources\\app\\bin";
  const viaPath = openers.detectOpeners({
    platform: "win32",
    env: { ...winEnv, PATH: bin },
    exists: (path) => path === `${bin}\\cursor.cmd` || path === "D:\\Apps\\cursor\\Cursor.exe",
  });
  expect(viaPath.get("cursor")?.command).toBe("D:\\Apps\\cursor\\Cursor.exe");
  expect(openers.detectOpeners({ platform: "win32", env: winEnv, exists: () => false }).size).toBe(0);
});

it("detects code and cursor on PATH elsewhere and no terminal without x-terminal-emulator", () => {
  const found = openers.detectOpeners({
    platform: "linux",
    env: { PATH: "/usr/bin:/opt/cursor" },
    exists: (path) => path === "/usr/bin/code" || path === "/opt/cursor/cursor" || path === "/usr/bin/bash",
  });
  expect([...found.entries()]).toEqual([
    ["vscode", { command: "/usr/bin/code", style: "path" }],
    ["cursor", { command: "/opt/cursor/cursor", style: "path" }],
  ]);
});

it("starts a detected program without passing the path through a parser and refuses the rest", async () => {
  const b = await bench();
  const launch = vi.fn<import("./openers.js").Launch>(async () => {});
  const found = new Map<import("./openers.js").OpenerId, import("./openers.js").Opener>([
    ["vscode", { command: "C:\\VS\\Code.exe", style: "path" }],
    ["notepadpp", { command: "C:\\NPP\\notepad++.exe", style: "path" }],
    ["terminal", { command: wt, style: "wt" }],
  ]);
  const file = join(b.root, "firmware", "main.c");
  const folder = join(b.root, "firmware");
  await openers.openWith(b.locate("firmware/main.c"), "vscode", found, launch);
  expect(launch).toHaveBeenLastCalledWith("C:\\VS\\Code.exe", [file], {});
  await openers.openWith(b.locate(".git/config"), "notepadpp", found, launch);
  expect(launch).toHaveBeenLastCalledWith("C:\\NPP\\notepad++.exe", [join(b.root, ".git", "config")], {});
  // The folder is the working directory, never an argument.
  await openers.openWith(b.locate("firmware"), "terminal", found, launch);
  expect(launch).toHaveBeenLastCalledWith(wt, ["-d", "."], { cwd: folder });
  await openers.openWith(b.locate("a;b"), "terminal", found, launch);
  expect(launch).toHaveBeenLastCalledWith(wt, ["-d", "."], { cwd: join(b.root, "a;b") });
  const shell = new Map([["terminal", { command: powershell, style: "powershell", host: cmd }]] as const);
  await openers.openWith(b.locate("a;b"), "terminal", new Map(shell), launch);
  expect(launch).toHaveBeenLastCalledWith(cmd, ["/d", "/s", "/c", `start "" "${powershell}" -NoExit`], {
    cwd: join(b.root, "a;b"),
    verbatim: true,
    hide: true,
  });
  launch.mockClear();
  for (const [path, app] of [
    ["firmware", "notepadpp"],
    ["firmware/main.c", "terminal"],
    ["firmware/main.c", "cursor"],
  ] as const)
    await expect(
      openers.openWith(b.locate(path), app, found, launch),
      `${path} ${app}`,
    ).rejects.toMatchObject({
      code: "INVALID",
    });
  await expect(openers.openWith(b.locate("../x"), "vscode", found, launch)).rejects.toMatchObject({
    code: "DENIED",
  });
  if (b.linked)
    await expect(openers.openWith(b.locate("link"), "vscode", found, launch)).rejects.toMatchObject({
      code: "DENIED",
    });
  expect(launch).not.toHaveBeenCalled();
  const failing = vi.fn<import("./openers.js").Launch>(async () => {
    throw Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  });
  await expect(openers.openWith(b.locate("firmware/main.c"), "vscode", found, failing)).rejects.toMatchObject(
    {
      code: "INTERNAL",
    },
  );
});

it("starts programs without VERA's own Electron variables", () => {
  expect(
    openers.programEnv({ PATH: "C:\\x", ELECTRON_RUN_AS_NODE: "1", ELECTRON_ENABLE_LOGGING: "1", HOME: "h" }),
  ).toEqual({ PATH: "C:\\x", HOME: "h" });
});

it("counts links and app execution aliases as present and starts real programs detached", async () => {
  const b = await bench();
  expect(openers.pathExists(join(b.root, "firmware", "main.c"))).toBe(true);
  expect(openers.pathExists(join(b.root, "missing.exe"))).toBe(false);
  // A dangling link stands in for an app execution alias, which existsSync reports missing.
  let dangling = false;
  try {
    await symlink(join(b.root, "nowhere.exe"), join(b.root, "alias.exe"));
    dangling = true;
  } catch {
    // Creating file links needs a privilege on Windows; the other cases still run.
  }
  if (dangling) {
    expect(existsSync(join(b.root, "alias.exe"))).toBe(false);
    expect(openers.pathExists(join(b.root, "alias.exe"))).toBe(true);
  }
  await expect(openers.launchDetached(process.execPath, ["-e", "0"], {})).resolves.toBeUndefined();
  await expect(openers.launchDetached(join(b.root, "missing.exe"), [], {})).rejects.toBeDefined();
});

it("reveals an entry, ignored or not, and refuses links and outside paths", async () => {
  const b = await bench();
  const show = vi.fn();
  await expect(openers.revealEntry(b.locate("firmware/main.c"), show)).resolves.toEqual({});
  expect(show).toHaveBeenLastCalledWith(join(b.root, "firmware", "main.c"));
  await openers.revealEntry(b.locate(".git"), show);
  expect(show).toHaveBeenLastCalledWith(join(b.root, ".git"));
  show.mockClear();
  await expect(openers.revealEntry(b.locate("../x"), show)).rejects.toMatchObject({ code: "DENIED" });
  if (b.linked)
    await expect(openers.revealEntry(b.locate("link"), show)).rejects.toMatchObject({ code: "DENIED" });
  expect(show).not.toHaveBeenCalled();
});

it("copies an entry's absolute path, relative path or name with the platform separator", async () => {
  const b = await bench();
  const write = vi.fn();
  const copy = (path: string, form: "absolute" | "relative" | "name", sep: "\\" | "/") =>
    openers.copyEntry(b.locate(path), path, form, write, sep);
  await copy("firmware/main.c", "absolute", "\\");
  expect(write).toHaveBeenLastCalledWith(join(b.root, "firmware", "main.c"));
  await copy("firmware/main.c", "relative", "\\");
  expect(write).toHaveBeenLastCalledWith("firmware\\main.c");
  await copy("firmware/main.c", "relative", "/");
  expect(write).toHaveBeenLastCalledWith("firmware/main.c");
  await copy("firmware/main.c", "name", "\\");
  expect(write).toHaveBeenLastCalledWith("main.c");
  await copy(".git/config", "relative", "\\");
  expect(write).toHaveBeenLastCalledWith(".git\\config");
  write.mockClear();
  await expect(copy("../x", "name", "\\")).rejects.toMatchObject({ code: "DENIED" });
  if (b.linked) await expect(copy("link", "absolute", "\\")).rejects.toMatchObject({ code: "DENIED" });
  expect(write).not.toHaveBeenCalled();
});

it("adds the Windows Open with dialog and the Linux terminal when they are present", () => {
  const rundll = "C:\\Windows\\System32\\rundll32.exe";
  const windows = openers.detectOpeners({
    platform: "win32",
    env: { ...winEnv, PATH: "" },
    exists: (path) => path === rundll,
  });
  expect([...windows.entries()]).toEqual([["other", { command: rundll, style: "rundll" }]]);
  const linux = openers.detectOpeners({
    platform: "linux",
    env: { PATH: "/usr/local/bin:/usr/bin" },
    exists: (path) => path === "/usr/bin/x-terminal-emulator",
  });
  expect([...linux.entries()]).toEqual([
    ["terminal", { command: "/usr/bin/x-terminal-emulator", style: "cwd" }],
  ]);
});

it("opens the Windows Open with dialog for files and the Linux terminal in folders", async () => {
  const b = await bench();
  const launch = vi.fn<import("./openers.js").Launch>(async () => {});
  const found = new Map<import("./openers.js").OpenerId, import("./openers.js").Opener>([
    ["other", { command: "C:\\W\\rundll32.exe", style: "rundll" }],
    ["terminal", { command: "/usr/bin/x-terminal-emulator", style: "cwd" }],
  ]);
  await openers.openWith(b.locate("firmware/main.c"), "other", found, launch);
  expect(launch).toHaveBeenLastCalledWith(
    "C:\\W\\rundll32.exe",
    ["shell32.dll,OpenAs_RunDLL", join(b.root, "firmware", "main.c")],
    // Unquoted: OpenAs_RunDLL takes the rest of the line as the path and refuses quotes.
    { verbatim: true },
  );
  await openers.openWith(b.locate("a;b"), "terminal", found, launch);
  expect(launch).toHaveBeenLastCalledWith("/usr/bin/x-terminal-emulator", [], { cwd: join(b.root, "a;b") });
  launch.mockClear();
  await expect(openers.openWith(b.locate("firmware"), "other", found, launch)).rejects.toMatchObject({
    code: "INVALID",
  });
  expect(launch).not.toHaveBeenCalled();
});

/** A Linux desktop: recorded gio outputs and .desktop files in a temporary share folder. */
async function linuxDesktop(mime: string, version = "2.72.4", info?: string) {
  const share = await mkdtemp(join(tmpdir(), "vera-share-"));
  roots.push(share);
  const apps = join(share, "applications");
  await mkdir(apps);
  const desktop = (name: string, text: string) => writeFile(join(apps, name), text);
  await desktop(
    "org.gnome.eog.desktop",
    "[Desktop Entry]\nName=Image Viewer\nName[ro]=Vizualizator de imagini\nExec=eog %U\n",
  );
  await desktop("gimp.desktop", "[Desktop Entry]\nName=GNU Image Manipulation Program\nExec=gimp %U\n");
  await desktop("code.desktop", "[Desktop Entry]\nName=Visual Studio Code\nExec=code %F\n");
  await desktop("hidden.desktop", "[Desktop Entry]\nName=Hidden\nNoDisplay=true\n");
  await desktop("helper.desktop", "[Desktop Entry]\nName=Helper\nHidden=1\n");
  const run = vi.fn(async (command: string, args: string[]) => {
    if (command !== "gio") throw Error(command);
    if (args[0] === "version") return `${version}\n`;
    if (args[0] === "info")
      return info ?? `uri: file://${args[3]}\nattributes:\n  standard::content-type: image/png\n`;
    if (args[0] === "mime" && args[1] === "image/png") return mime;
    throw Error(args.join(" "));
  });
  const deps = {
    platform: "linux",
    run,
    dataDirs: [share],
    readText: (path: string) => readFile(path, "utf8").catch(() => undefined),
    lang: "en",
    openers: new Map<import("./openers.js").OpenerId, import("./openers.js").Opener>([
      ["vscode", { command: "/usr/bin/code", style: "path" }],
    ]),
  };
  return { apps, run, deps };
}
const registered = [
  "Default application for \u201cimage/png\u201d: org.gnome.eog.desktop",
  "Registered applications:",
  "\torg.gnome.eog.desktop",
  "\tgimp.desktop",
  "\tcode.desktop",
  "\thidden.desktop",
  "\thelper.desktop",
  "\tmissing.desktop",
  "Recommended applications:",
  "\torg.gnome.eog.desktop",
  "",
].join("\n");

it("lists the applications Linux registers for a file by their desktop names", async () => {
  const b = await bench();
  const linux = await linuxDesktop(registered);
  expect(await openers.systemApps(b.locate("photo.png"), linux.deps)).toEqual([
    { id: "org.gnome.eog.desktop", name: "Image Viewer", desktop: join(linux.apps, "org.gnome.eog.desktop") },
    { id: "gimp.desktop", name: "GNU Image Manipulation Program", desktop: join(linux.apps, "gimp.desktop") },
  ]);
  expect(linux.run).toHaveBeenCalledWith("gio", ["mime", "image/png"]);
  expect(linux.run).toHaveBeenCalledWith("gio", [
    "info",
    "-a",
    "standard::content-type",
    join(b.root, "photo.png"),
  ]);
  // The UI language picks a localized name; without VS Code detected, its own entry stays.
  expect((await openers.systemApps(b.locate("photo.png"), { ...linux.deps, lang: "ro" }))[0]?.name).toBe(
    "Vizualizator de imagini",
  );
  expect(
    (await openers.systemApps(b.locate("photo.png"), { ...linux.deps, openers: new Map() })).map(
      (app) => app.id,
    ),
  ).toContain("code.desktop");
  // Nothing where the platform cannot: no default, an old GLib, no gio, Windows.
  const none = await linuxDesktop("No default applications for \u201cimage/png\u201d\n");
  expect(await openers.systemApps(b.locate("photo.png"), none.deps)).toEqual([]);
  const old = await linuxDesktop(registered, "2.64.6");
  expect(await openers.systemApps(b.locate("photo.png"), old.deps)).toEqual([]);
  const missing = {
    ...linux.deps,
    run: vi.fn(async () => Promise.reject(Object.assign(Error("gio"), { code: "ENOENT" }))),
  };
  expect(await openers.systemApps(b.locate("photo.png"), missing)).toEqual([]);
  expect(await openers.systemApps(b.locate("photo.png"), { ...linux.deps, platform: "win32" })).toEqual([]);
  await expect(openers.systemApps(b.locate("firmware"), linux.deps)).rejects.toMatchObject({
    code: "INVALID",
  });
  await expect(openers.systemApps(b.locate("../x"), linux.deps)).rejects.toMatchObject({ code: "DENIED" });
  if (b.linked)
    await expect(openers.systemApps(b.locate("link"), linux.deps)).rejects.toMatchObject({ code: "DENIED" });
  // A file name cannot pose as the content type: only the attributes block is read.
  const crafted = await linuxDesktop(
    registered,
    "2.72.4",
    "uri: file:///w/standard::content-type: text/x-evil\nattributes:\n  standard::content-type: image/png\n",
  );
  expect((await openers.systemApps(b.locate("photo.png"), crafted.deps)).length).toBe(2);
  expect(crafted.run).toHaveBeenCalledWith("gio", ["mime", "image/png"]);
});

it("starts a registered Linux application with gio launch and refuses any other", async () => {
  const b = await bench();
  const linux = await linuxDesktop(registered);
  const launch = vi.fn<import("./openers.js").Launch>(async () => {});
  await openers.openSystemApp(b.locate("photo.png"), "gimp.desktop", linux.deps, launch);
  expect(launch).toHaveBeenLastCalledWith(
    "gio",
    ["launch", join(linux.apps, "gimp.desktop"), join(b.root, "photo.png")],
    {},
  );
  launch.mockClear();
  for (const app of ["evil.desktop", "hidden.desktop", "missing.desktop"])
    await expect(
      openers.openSystemApp(b.locate("photo.png"), app, linux.deps, launch),
      app,
    ).rejects.toMatchObject({
      code: "INVALID",
    });
  await expect(
    openers.openSystemApp(b.locate("firmware"), "gimp.desktop", linux.deps, launch),
  ).rejects.toMatchObject({
    code: "INVALID",
  });
  await expect(
    openers.openSystemApp(b.locate("../x"), "gimp.desktop", linux.deps, launch),
  ).rejects.toMatchObject({
    code: "DENIED",
  });
  if (b.linked)
    await expect(
      openers.openSystemApp(b.locate("link"), "gimp.desktop", linux.deps, launch),
    ).rejects.toMatchObject({ code: "DENIED" });
  expect(launch).not.toHaveBeenCalled();
  const failing = vi.fn<import("./openers.js").Launch>(async () => {
    throw Error("spawn gio ENOENT");
  });
  await expect(
    openers.openSystemApp(b.locate("photo.png"), "gimp.desktop", linux.deps, failing),
  ).rejects.toMatchObject({ code: "INTERNAL" });
});

it("runs system tools in the C locale so their output can be parsed", async () => {
  await expect(
    openers.runTool(process.execPath, ["-e", "process.stdout.write(process.env.LC_ALL ?? '')"]),
  ).resolves.toBe("C");
});

it("offers only what each platform has: no Open with dialog off Windows, no terminal on macOS", () => {
  const everywhere = () => true;
  const mac = openers.detectOpeners({
    platform: "darwin",
    env: { PATH: "/usr/local/bin" },
    exists: everywhere,
  });
  expect([...mac.keys()]).toEqual(["vscode", "cursor"]);
  const linux = openers.detectOpeners({ platform: "linux", env: { PATH: "/usr/bin" }, exists: everywhere });
  expect([...linux.keys()]).toEqual(["vscode", "cursor", "terminal"]);
});
