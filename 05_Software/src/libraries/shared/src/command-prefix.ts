import { z } from "zod";

// Only literal words shared by the supported shells qualify for automatic approval.
// Shell/interpreter dispatch and destructive tools always need an exact user decision.
const dispatch =
  /^(?:bash|sh|dash|zsh|fish|ksh|pwsh|powershell|cmd|command|exec|eval|env|sudo|su|doas|xargs|busybox|wsl|ssh|source|start|invoke-expression|iex|time|nohup|nice|timeout|stdbuf|setsid|chroot|runuser)$/i;
const destructive =
  /^(?:rm|rmdir|rd|del|erase|remove-item|ri|clear-content|clear-item|format|diskpart|diskmgmt|diskutil|fsutil|chkdsk|fdisk|sfdisk|cfdisk|parted|partprobe|wipefs|mkfs(?:[.-].*)?|mkswap|dd|shred|truncate|blkdiscard|sgdisk|gdisk|mount|umount|losetup|destroy|[a-z]+-(?:disk|partition|volume))$/i;
const destructiveOptions = ["force", "hard", "delete", "recursive", "mirror", "prune"];

function destructiveOption(word: string): boolean {
  if (!word.startsWith("-")) return false;
  const option = word.replace(/^--?/, "").split(/[=:]/)[0]?.toLowerCase() ?? "";
  return (
    !!option && destructiveOptions.some((name) => name.startsWith(option) || option.startsWith(`${name}-`))
  );
}

function words(command: string): string[] | undefined {
  if (!command || command.length > 4096 || !/^[A-Za-z0-9_./=,:+ -]+$/.test(command)) return;
  if (command !== command.trim() || command.includes("  ")) return;
  const tokens = command.split(" ");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(tokens[0] ?? "")) return;
  if (
    tokens.some((word) => {
      const literal = word.split("=").at(-1) ?? "";
      const name =
        literal
          .split("/")
          .at(-1)
          ?.replace(/\.+$/, "")
          .replace(/\.(?:exe|com|cmd|bat)$/i, "") ?? "";
      return !word || dispatch.test(name) || destructive.test(name);
    })
  )
    return;
  // Force options (including abbreviated PowerShell forms), git hard reset and force refspecs.
  if (tokens.some(destructiveOption)) return;
  if (
    tokens[0]?.toLowerCase() === "git" &&
    tokens.some((word) => word === "clean" || word.startsWith(":") || word === "-d" || word === "-D")
  )
    return;
  if (tokens.some((word) => /^-[A-Za-z]*f[A-Za-z]*$/.test(word) || word.startsWith("+"))) return;
  // Code/config dispatch can reinterpret otherwise literal suffixes as shell code.
  if (tokens.some((word) => /^(?:-c|-e|--eval|--execute|--exec|--config-env)/i.test(word))) return;
  return tokens;
}

/** Eligible plain command prefixes; unsupported shell syntax needs an exact user approval. */
export function commandPrefixes(command: string): string[] {
  const tokens = words(command);
  if (!tokens) return [];
  return tokens.map((_word, index) => tokens.slice(0, index + 1).join(" "));
}

/** Literal token-boundary matching, after both command and prefix pass conservative eligibility. */
export function commandPrefixMatches(command: string, prefix: string): boolean {
  return !!words(command) && !!words(prefix) && (command === prefix || command.startsWith(`${prefix} `));
}

export const commandPrefixSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !!words(value));
export const commandPrefixListSchema = z
  .array(commandPrefixSchema)
  .max(100)
  .refine((items) => new Set(items).size === items.length);
export const commandPrefixIdsSchema = z
  .array(z.string().regex(/^[0-9a-f]{64}$/))
  .max(100)
  .refine((items) => new Set(items).size === items.length);
export const commandPrefixDisplaySchema = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  label: z.string().min(1).max(40960),
});
export type CommandPrefixDisplay = z.infer<typeof commandPrefixDisplaySchema>;
