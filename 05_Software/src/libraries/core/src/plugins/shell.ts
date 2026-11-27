import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import type { CommandShellOption } from "@vera/shared";
import type { ProcessHost } from "../ports.js";
import { hostVariable } from "./process-tree.js";

export interface CommandShell {
  executable: string;
  kind: "powershell" | "cmd" | "bash" | "sh";
}
export interface CommandShellHost {
  resolve(signal?: AbortSignal): Promise<CommandShell>;
  environment(): Record<string, string>;
}

/** Inherit user configuration, excluding VERA state and credential-bearing variables or values. */
export function commandEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  scrub: (value: string) => string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !/^(?:VERA(?:_|$)|ELECTRON_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$)/i.test(entry[0]) &&
        !/(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTHORIZATION|PRIVATE[_-]?KEY)/i.test(
          entry[0],
        ) &&
        scrub(entry[1]) === entry[1],
    ),
  );
}

async function executable(path: string, windows: boolean): Promise<boolean> {
  try {
    await access(path, windows ? constants.F_OK : constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

type ShellPlatform = Pick<ProcessHost, "platform" | "env">;
type Exists = (path: string) => Promise<boolean>;

function shellFinder(host: ShellPlatform, exists: Exists) {
  const windows = host.platform === "win32";
  const paths = windows ? win32 : posix;
  const variable = (name: string) => hostVariable(host as ProcessHost, name);
  const wslBash = win32.join(variable("SystemRoot") ?? "C:\\Windows", "System32", "bash.exe").toLowerCase();
  return async (name: string): Promise<string | undefined> => {
    const candidates = paths.isAbsolute(name)
      ? [name]
      : /[\\/]/.test(name)
        ? []
        : (variable("PATH") ?? "")
            .split(windows ? ";" : ":")
            .map((directory) => directory.replace(/^"(.*)"$/, "$1"))
            .filter((directory) => paths.isAbsolute(directory))
            .map((directory) =>
              paths.join(directory, windows && !/\.exe$/i.test(name) ? `${name}.exe` : name),
            );
    if (!candidates.length && /[\\/]/.test(name) && !paths.isAbsolute(name))
      throw Error("The shell must be an executable name or an absolute path.");
    for (const path of candidates) {
      // System32/bash.exe is a WSL launcher, not a native Bash with the current Windows cwd/environment.
      if (windows && win32.normalize(path).toLowerCase() === wslBash) continue;
      if (await exists(path)) return path;
    }
    return undefined;
  };
}

const shellFamilies = ["pwsh", "powershell", "cmd", "bash"] as const;

function shellNames(host: ShellPlatform, id: CommandShellOption["id"]): string[] {
  const windows = host.platform === "win32";
  const variable = (name: string) => hostVariable(host as ProcessHost, name);
  const programFiles = variable("ProgramFiles") ?? "C:\\Program Files";
  if (id === "pwsh") {
    return [
      "pwsh",
      windows ? win32.join(programFiles, "PowerShell", "7", "pwsh.exe") : "/opt/microsoft/powershell/7/pwsh",
    ];
  }
  if (!windows) return id === "bash" ? ["bash", "/bin/bash"] : [];
  const systemRoot = variable("SystemRoot") ?? "C:\\Windows";
  if (id === "powershell") {
    return [win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), id];
  }
  if (id === "cmd") return [win32.join(systemRoot, "System32", "cmd.exe"), id];

  const localAppData = variable("LocalAppData");
  const gitFolders = [
    programFiles,
    variable("ProgramFiles(x86)"),
    localAppData && win32.join(localAppData, "Programs"),
  ]
    .filter((path): path is string => !!path && win32.isAbsolute(path))
    .map((path) => win32.join(path, "Git", "bin", "bash.exe"));
  for (const directory of (variable("PATH") ?? "").split(";")) {
    const path = directory.replace(/^"(.*)"$/, "$1");
    if (win32.isAbsolute(path) && /^(?:cmd|bin)$/i.test(win32.basename(path)))
      gitFolders.push(win32.join(win32.dirname(path), "bin", "bash.exe"));
  }
  return ["bash", ...gitFolders];
}

async function firstShell(
  find: ReturnType<typeof shellFinder>,
  names: readonly string[],
): Promise<string | undefined> {
  for (const name of names) {
    const path = await find(name);
    if (path) return path;
  }
  return undefined;
}

/** Detects supported installed shells without starting them or changing the machine. */
export async function detectCommandShells(
  host: ShellPlatform,
  exists: Exists = (path) => executable(path, host.platform === "win32"),
): Promise<CommandShellOption[]> {
  const find = shellFinder(host, exists);
  return Promise.all(
    shellFamilies.map(async (id) => ({
      id,
      executable: (await firstShell(find, shellNames(host, id))) ?? null,
    })),
  );
}

/** An explicit unavailable selection never falls back to a different shell. */
export async function resolveCommandShell(
  host: ShellPlatform,
  configured = "",
  exists: Exists = (path) => executable(path, host.platform === "win32"),
): Promise<CommandShell> {
  const windows = host.platform === "win32";
  const paths = windows ? win32 : posix;
  const find = shellFinder(host, exists);
  let resolved: string | undefined;
  if (configured) {
    resolved = await find(configured);
    if (!resolved) {
      const name = configured.replace(/\.exe$/i, "").toLowerCase();
      const family = shellFamilies.find((id) => id === name);
      if (family) {
        const names = shellNames(host, family).filter(
          (candidate) => candidate !== configured && (!windows || `${candidate}.exe` !== configured),
        );
        resolved = await firstShell(find, names);
      }
    }
  } else if (windows) {
    for (const family of ["pwsh", "powershell", "cmd"] as const) {
      resolved = await firstShell(find, shellNames(host, family));
      if (resolved) break;
    }
  } else
    resolved =
      (await find("bash")) ?? (await find("/bin/bash")) ?? (await find("sh")) ?? (await find("/bin/sh"));
  if (!resolved) throw Error("No command shell is available. Select an installed shell in Settings.");
  const name = paths
    .basename(resolved)
    .replace(/\.exe$/i, "")
    .toLowerCase();
  if (windows && !["pwsh", "powershell", "cmd", "bash", "sh"].includes(name))
    throw Error("Select PowerShell, Cmd or a native Bash/sh executable on Windows.");
  return {
    executable: resolved,
    kind:
      name === "pwsh" || name === "powershell"
        ? "powershell"
        : name === "cmd" && windows
          ? "cmd"
          : name === "bash"
            ? "bash"
            : "sh",
  };
}

/** Startup arguments for a user-owned interactive terminal. */
export function interactiveShellArguments(shell: CommandShell): string[] {
  return shell.kind === "powershell"
    ? ["-NoLogo"]
    : shell.kind === "cmd"
      ? ["/d"]
      : shell.kind === "bash"
        ? ["-il"]
        : ["-i"];
}

/** Pass literal shell syntax as one argv item; PowerShell's wrapper preserves native exit status. */
export function shellArguments(shell: CommandShell, command: string): string[] {
  if (shell.kind === "cmd") {
    if (/[\r\n]/.test(command))
      throw Error("Cmd commands must be on one line; use & or && between commands.");
    return ["/d", "/s", "/c", `"${command}"`];
  }
  if (shell.kind !== "powershell") return [shell.kind === "bash" ? "-lc" : "-c", command];
  const literal =
    `${command}\n$veraOk = $?; if ($veraOk) { exit 0 }; if ($null -eq $LASTEXITCODE) { exit 1 }; exit $LASTEXITCODE`.replaceAll(
      "'",
      "''",
    );
  // Constrained Language Mode (WDAC, AppLocker) refuses the .NET calls. There the command still runs
  // with its exit status; cmdlet text keeps the console code page, as Cmd output does.
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$veraCommand = '${literal}'; $global:LASTEXITCODE = $null; if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') { $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & ([scriptblock]::Create($veraCommand)) } else { Invoke-Expression $veraCommand }`,
  ];
}

/** Host-owned shell configuration and credential filtering, read afresh for each command. */
export function createCommandShellHost(
  host: ProcessHost,
  setting: () => string | undefined,
  scrub: (value: string) => string,
): CommandShellHost {
  return {
    resolve: async (signal) => {
      signal?.throwIfAborted();
      const shell = await resolveCommandShell(host, setting());
      signal?.throwIfAborted();
      return shell;
    },
    environment: () => commandEnvironment(host.env, scrub),
  };
}
