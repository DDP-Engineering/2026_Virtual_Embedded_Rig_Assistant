import { veraError } from "@vera/shared";

/**
 * How a launcher takes the program's command (plugins architecture §3.3): `argv` appends the command
 * tokens as arguments; `string` passes them as one command string that the launcher parses itself.
 */
export type LauncherMode = "argv" | "string";

/** Characters a launcher's own command parser or shell could act on; refused in `string` mode. */
const UNSAFE = /["'&|;<>^%$`\0\r\n]/;

/**
 * Arguments that follow the launcher's executable: the launcher's own arguments, then the command.
 * In `string` mode tokens are double quoted for EIM's Bash/PowerShell executor. Bash backslashes
 * are escaped; PowerShell keeps them literal and needs a generated call operator before the quoted
 * executable. Refuses (INVALID, `params.index`) any token with a character of UNSAFE.
 */
export function launcherArgs(
  launcher: readonly string[],
  command: readonly string[],
  mode: LauncherMode,
  platform: "win32" | "linux" = "linux",
): string[] {
  if (mode === "argv") return [...launcher, ...command];
  const quoted = command.map((token, index) => {
    if (UNSAFE.test(token)) throw { ...veraError("INVALID"), params: { index } };
    return `"${platform === "win32" ? token : token.replaceAll("\\", "\\\\")}"`;
  });
  return [...launcher, `${platform === "win32" ? "& " : ""}${quoted.join(" ")}`];
}

/** Build the actual argv once for both version probes and approved program runs. */
export function programInvocation(
  resolved: {
    prefix?: readonly string[] | undefined;
    launcher?: { command: string; mode: LauncherMode; platform: "win32" | "linux" } | undefined;
  },
  args: readonly string[],
): string[] {
  const { launcher } = resolved;
  return launcher
    ? launcherArgs(resolved.prefix ?? [], [launcher.command, ...args], launcher.mode, launcher.platform)
    : [...(resolved.prefix ?? []), ...args];
}
