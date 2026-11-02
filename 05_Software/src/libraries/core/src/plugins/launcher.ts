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
 * In `string` mode each token is wrapped in double quotes and trailing backslashes are doubled, so a
 * closing quote is never escaped. Refuses (INVALID, `params.index`) any token with a character of UNSAFE.
 */
export function launcherArgs(
  launcher: readonly string[],
  command: readonly string[],
  mode: LauncherMode,
): string[] {
  if (mode === "argv") return [...launcher, ...command];
  const quoted = command.map((token, index) => {
    if (UNSAFE.test(token)) throw { ...veraError("INVALID"), params: { index } };
    return `"${token.replace(/\\+$/, (tail) => tail + tail)}"`;
  });
  return [...launcher, quoted.join(" ")];
}
