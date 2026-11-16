import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import type { ProcessHost } from "../ports.js";
import { hostVariable } from "./process-tree.js";

export interface CommandShell {
  executable: string;
  kind: "powershell" | "bash" | "sh";
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

/** Resolve a shell without invoking it; an explicit unavailable selection never falls back. */
export async function resolveCommandShell(
  host: Pick<ProcessHost, "platform" | "env">,
  configured = "",
  exists: (path: string) => Promise<boolean> = (path) => executable(path, host.platform === "win32"),
): Promise<CommandShell> {
  const windows = host.platform === "win32";
  const paths = windows ? win32 : posix;
  const variable = (name: string) => hostVariable(host as ProcessHost, name);
  const find = async (name: string): Promise<string | undefined> => {
    if (paths.isAbsolute(name)) return (await exists(name)) ? name : undefined;
    if (/[\\/]/.test(name)) throw Error("The shell must be an executable name or an absolute path.");
    for (const directory of (variable("PATH") ?? "").split(windows ? ";" : ":")) {
      const folder = directory.replace(/^"(.*)"$/, "$1");
      if (!paths.isAbsolute(folder)) continue;
      const path = paths.join(folder, windows && !/\.exe$/i.test(name) ? `${name}.exe` : name);
      if (await exists(path)) return path;
    }
    return undefined;
  };
  let resolved: string | undefined;
  if (configured) resolved = await find(configured);
  else if (windows)
    resolved =
      (await find("pwsh")) ??
      (await find(
        win32.join(variable("ProgramFiles") ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
      )) ??
      (await find(
        win32.join(
          variable("SystemRoot") ?? "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
      ));
  else
    resolved =
      (await find("bash")) ?? (await find("/bin/bash")) ?? (await find("sh")) ?? (await find("/bin/sh"));
  if (!resolved) throw Error("No command shell is available. Select an installed shell in Settings.");
  const name = paths
    .basename(resolved)
    .replace(/\.exe$/i, "")
    .toLowerCase();
  if (windows && !["pwsh", "powershell"].includes(name))
    throw Error("Select pwsh.exe or powershell.exe on Windows.");
  return { executable: resolved, kind: windows ? "powershell" : name === "bash" ? "bash" : "sh" };
}

/** Pass literal shell syntax as one argv item; PowerShell's wrapper preserves native exit status. */
export function shellArguments(shell: CommandShell, command: string): string[] {
  if (shell.kind !== "powershell") return [shell.kind === "bash" ? "-lc" : "-c", command];
  const literal =
    `${command}\nif ($?) { exit 0 }; if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1`.replaceAll("'", "''");
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $global:LASTEXITCODE = 0; & ([scriptblock]::Create('${literal}'))`,
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
