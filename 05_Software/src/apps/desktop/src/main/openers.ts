// REQ-FUNC-fe252a3c REQ-FUNC-593428f6 REQ-FUNC-aad416b5 REQ-FUNC-62ed1c20 REQ-FUNC-ad5254e8 REQ-FUNC-6bf664d7
import { execFile, spawn } from "node:child_process";
import { lstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { type DocsOpener, veraError } from "@vera/shared";

export type OpenerId = DocsOpener;
/**
 * A detected program and how it receives an entry: editors by a path argument; terminals start
 * in the folder as their working directory, so no path text reaches a command-line parser.
 * PowerShell, a console program, is started through `host` (cmd.exe) `start` to get a window.
 */
export interface Opener {
  command: string;
  style: "path" | "wt" | "powershell" | "rundll" | "cwd";
  host?: string;
}
export interface EntryLocation {
  absolute: string;
  type: "folder" | "file";
}
/** Resolves a workbench entry through the Docs tree's confinement; refusals arrive as errors. */
type Locate = () => Promise<EntryLocation>;
export interface LaunchOptions {
  cwd?: string;
  /**
   * The arguments go on the command line exactly as given, without the quotes Node would add:
   * cmd.exe `start` gets one fixed line, and rundll32 hands the rest of its line to
   * OpenAs_RunDLL, which refuses a quoted path.
   */
  verbatim?: boolean;
  /** Hides the started program's own window (cmd.exe that only relays `start`). */
  hide?: boolean;
}
export type Launch = (command: string, args: string[], options: LaunchOptions) => Promise<void>;

/** The kinds of entries each program takes. */
const takes: Record<OpenerId, { file: boolean; folder: boolean }> = {
  vscode: { file: true, folder: true },
  cursor: { file: true, folder: true },
  notepadpp: { file: true, folder: false },
  terminal: { file: false, folder: true },
  // The Windows Open with dialog chooses an application for one file.
  other: { file: true, folder: false },
};

/**
 * Whether a file system entry is there, links included: Windows app execution aliases such as
 * `WindowsApps\wt.exe` are reparse points that `existsSync` (which follows them) reports missing.
 */
export function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The programs VERA can hand a workbench entry to (TASK-eae3a69e): VS Code, Cursor and Notepad++
 * from their standard install folders or PATH, and on Windows a terminal, Windows Terminal when
 * installed and otherwise PowerShell, and the Open with dialog (rundll32.exe). Elsewhere `code` and
 * `cursor` on PATH, and on Linux `x-terminal-emulator` as the terminal (TASK-c49f03d5).
 */
export function detectOpeners({
  platform,
  env,
  exists,
}: {
  platform: string;
  env: Record<string, string | undefined>;
  exists: (path: string) => boolean;
}): Map<OpenerId, Opener> {
  const windows = platform === "win32";
  const path = windows ? win32 : posix;
  const dirs = (env.PATH ?? env.Path ?? "").split(windows ? ";" : ":").filter(Boolean);
  const first = (candidates: readonly (string | undefined | false)[]) =>
    candidates.find((candidate): candidate is string => !!candidate && exists(candidate));
  const onPath = (name: string) => dirs.map((dir) => path.join(dir, name));
  // A launcher script on PATH leads to the program it starts, `up` folders above it.
  const besideScript = (script: string, up: number, program: string) =>
    dirs
      .filter((dir) => exists(path.join(dir, script)))
      .map((dir) => path.join(dir, ...Array<string>(up).fill(".."), program));
  const found = new Map<OpenerId, Opener>();
  const add = (id: OpenerId, command: string | undefined, style: Opener["style"] = "path") => {
    if (command) found.set(id, { command, style });
  };
  if (!windows) {
    add("vscode", first(onPath("code")));
    add("cursor", first(onPath("cursor")));
    // Debian and Ubuntu point this alternative at the desktop's terminal.
    if (platform === "linux") add("terminal", first(onPath("x-terminal-emulator")), "cwd");
    return found;
  }
  const local = env.LOCALAPPDATA;
  const programs = env.ProgramFiles;
  const programs86 = env["ProgramFiles(x86)"];
  // The batch launchers themselves (code.cmd, cursor.cmd) would need a shell to run.
  add(
    "vscode",
    first([
      local && path.join(local, "Programs", "Microsoft VS Code", "Code.exe"),
      programs && path.join(programs, "Microsoft VS Code", "Code.exe"),
      ...besideScript("code.cmd", 1, "Code.exe"),
    ]),
  );
  add(
    "cursor",
    first([
      local && path.join(local, "Programs", "cursor", "Cursor.exe"),
      programs && path.join(programs, "cursor", "Cursor.exe"),
      ...besideScript("cursor.cmd", 3, "Cursor.exe"),
      ...onPath("Cursor.exe"),
    ]),
  );
  add(
    "notepadpp",
    first([
      programs && path.join(programs, "Notepad++", "notepad++.exe"),
      programs86 && path.join(programs86, "Notepad++", "notepad++.exe"),
      ...onPath("notepad++.exe"),
    ]),
  );
  const terminal = first([
    local && path.join(local, "Microsoft", "WindowsApps", "wt.exe"),
    ...onPath("wt.exe"),
  ]);
  const system = env.SystemRoot && path.join(env.SystemRoot, "System32");
  if (terminal) add("terminal", terminal, "wt");
  else {
    const powershell = first([system && path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe")]);
    const host = first([system && path.join(system, "cmd.exe")]);
    if (powershell && host) found.set("terminal", { command: powershell, style: "powershell", host });
  }
  add("other", first([system && path.join(system, "rundll32.exe")]), "rundll");
  return found;
}

/** The environment for a started program, without the variables that steer VERA's own Electron. */
export function programEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !entry[0].toUpperCase().startsWith("ELECTRON_"),
    ),
  );
}

/** Starts a program detached and without a shell, so a path is never read as a command line. */
export const launchDetached: Launch = (command, args, { cwd, verbatim, hide }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: !!hide,
      windowsVerbatimArguments: !!verbatim,
      env: programEnv(process.env),
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

/**
 * Opens a workbench entry with a detected program: editors take its absolute path, a terminal
 * starts with the folder as its working directory. Windows Terminal splits its arguments on `;`,
 * so it gets `-d .` rather than the path; PowerShell, a console program that has no window when
 * started detached, is started by cmd.exe `start` with a fixed command line. A program that is not
 * detected or does not take the entry's kind is INVALID; a launch failure is INTERNAL.
 */
export async function openWith(
  locate: Locate,
  app: OpenerId,
  openers: ReadonlyMap<OpenerId, Opener>,
  launch: Launch,
): Promise<Record<string, never>> {
  const entry = await locate();
  const opener = openers.get(app);
  if (!opener || !takes[app][entry.type]) throw veraError("INVALID");
  const [command, args, options]: [string, string[], LaunchOptions] =
    opener.style === "wt"
      ? [opener.command, ["-d", "."], { cwd: entry.absolute }]
      : opener.style === "powershell"
        ? [
            opener.host ?? "cmd.exe",
            ["/d", "/s", "/c", `start "" "${opener.command}" -NoExit`],
            // cmd.exe only relays `start`; its own console stays hidden while PowerShell's shows.
            { cwd: entry.absolute, verbatim: true, hide: true },
          ]
        : opener.style === "rundll"
          ? // A Windows path holds no quotes and no shell reads this line.
            [opener.command, ["shell32.dll,OpenAs_RunDLL", entry.absolute], { verbatim: true }]
          : opener.style === "cwd"
            ? [opener.command, [], { cwd: entry.absolute }]
            : [opener.command, [entry.absolute], {}];
  try {
    await launch(command, args, options);
  } catch {
    throw veraError("INTERNAL");
  }
  return {};
}

/** Shows a workbench entry selected in the system file manager. */
export async function revealEntry(
  locate: Locate,
  show: (absolute: string) => void,
): Promise<Record<string, never>> {
  show((await locate()).absolute);
  return {};
}

/** Writes a workbench entry's absolute path, relative path or name, with the platform separator. */
export async function copyEntry(
  locate: Locate,
  path: string,
  form: "absolute" | "relative" | "name",
  write: (text: string) => void,
  sep: string,
): Promise<Record<string, never>> {
  const entry = await locate();
  const parts = path.split("/");
  write(
    form === "absolute" ? entry.absolute : form === "relative" ? parts.join(sep) : (parts.at(-1) as string),
  );
  return {};
}

/** An application Linux registers for a file's type, from its .desktop file (TASK-c49f03d5). */
export interface SystemApp {
  id: string;
  name: string;
  desktop: string;
}
export interface SystemAppDeps {
  platform: string;
  /** Runs a system tool and returns its standard output; rejects when it fails or is missing. */
  run: (command: string, args: string[]) => Promise<string>;
  /** XDG data directories, each holding an applications folder. */
  dataDirs: readonly string[];
  readText: (path: string) => Promise<string | undefined>;
  /** The UI language that picks a localized `Name[lang]`. */
  lang: string;
  openers: ReadonlyMap<OpenerId, Opener>;
}
/** Desktop ids of the editors Open in already lists when they are detected. */
const editorIds: [OpenerId, RegExp][] = [
  ["vscode", /^(code|code_code|visual-studio-code)\.desktop$/],
  ["cursor", /^(cursor|cursor_cursor)\.desktop$/],
];

/** The `Name` (or `Name[lang]`) of a .desktop file's main group, unless the entry is hidden. */
function desktopName(text: string, lang: string): string | undefined {
  const values = new Map<string, string>();
  let main = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      main = line === "[Desktop Entry]";
      continue;
    }
    const eq = line.indexOf("=");
    if (!main || line.startsWith("#") || eq < 0) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  // Desktop entry booleans are true or 1; hidden entries stay out like in the system's own menus.
  const on = (key: string) => ["true", "1"].includes(values.get(key) ?? "");
  if (on("NoDisplay") || on("Hidden")) return undefined;
  return values.get(`Name[${lang}]`) || values.get("Name") || undefined;
}

/**
 * The applications Linux registers for a workbench file's type: `gio mime` (GLib 2.68 or later, so
 * that `gio launch` exists) read in the C locale, named from their .desktop files, without the
 * editors Open in already lists. Elsewhere, or when gio cannot tell, there are none.
 */
export async function systemApps(locate: Locate, deps: SystemAppDeps): Promise<SystemApp[]> {
  const entry = await locate();
  if (entry.type !== "file") throw veraError("INVALID");
  if (deps.platform !== "linux") return [];
  try {
    const [major = 0, minor = 0] = (await deps.run("gio", ["version"])).trim().split(".").map(Number);
    if (major < 2 || (major === 2 && minor < 68)) return [];
    const info = await deps.run("gio", ["info", "-a", "standard::content-type", entry.absolute]);
    // Only the attributes block counts: the uri and path lines before it hold the file's own name.
    // The last block wins, so even a file name holding a newline cannot open a block of its own.
    const blocks = info.split(/\r?\nattributes:\r?\n/);
    const attributes = blocks.length > 1 ? (blocks.at(-1) ?? "") : "";
    const type = /^\s*standard::content-type:\s*([\w.+-]+\/[\w.+-]+)\s*$/m.exec(attributes)?.[1];
    if (!type) return [];
    const lines = (await deps.run("gio", ["mime", type])).split(/\r?\n/);
    const start = lines.indexOf("Registered applications:");
    if (start < 0) return [];
    const apps: SystemApp[] = [];
    for (const line of lines.slice(start + 1)) {
      if (!line.startsWith("\t")) break;
      const id = line.trim();
      if (!/^[\w.-]+\.desktop$/.test(id)) continue;
      if (editorIds.some(([editor, pattern]) => deps.openers.has(editor) && pattern.test(id))) continue;
      for (const dir of deps.dataDirs) {
        const desktop = join(dir, "applications", id);
        const text = await deps.readText(desktop);
        if (text === undefined) continue;
        const name = desktopName(text, deps.lang);
        if (name) apps.push({ id, name: name.slice(0, 200), desktop });
        break;
      }
    }
    return apps.slice(0, 50);
  } catch {
    // gio missing or failing leaves the menu without system applications.
    return [];
  }
}

/**
 * Starts an application Linux registers for a workbench file with `gio launch`; the id must still
 * be in that file's list, so no other .desktop file can be started.
 */
export async function openSystemApp(
  locate: Locate,
  app: string,
  deps: SystemAppDeps,
  launch: Launch,
): Promise<Record<string, never>> {
  const entry = await locate();
  const chosen = (await systemApps(async () => entry, deps)).find((candidate) => candidate.id === app);
  if (!chosen) throw veraError("INVALID");
  try {
    await launch("gio", ["launch", chosen.desktop, entry.absolute], {});
  } catch {
    throw veraError("INTERNAL");
  }
  return {};
}

/** Runs a system tool without a shell, in the C locale so its output reads the same everywhere. */
export function runTool(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        env: { ...programEnv(process.env), LC_ALL: "C" },
        timeout: 5000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** A text file's content, or undefined when it cannot be read. */
export function readOptionalText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").then(
    (text) => text,
    () => undefined,
  );
}
