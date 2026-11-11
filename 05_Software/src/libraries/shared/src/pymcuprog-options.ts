// pymcuprog 3.19.4.61 arguments (pymcuprog.py): argparse with abbreviations, attached (`-mfuses`, `-m=fuses`) and
// grouped short options, the action positional anywhere, `-m` defaulting to `all` and `-l` taking one or more values.
const shortValues: Readonly<Record<string, string>> = {
  d: "device",
  p: "packpath",
  t: "tool",
  s: "serialnumber",
  m: "memory",
  o: "offset",
  b: "bytes",
  f: "filename",
  c: "clk",
  u: "uart",
  i: "interface",
  v: "verbose",
  H: "high-voltage",
  l: "literal",
};
const shortFlags: Readonly<Record<string, string>> = {
  h: "help",
  V: "version",
  R: "release-info",
  x: "timing",
  U: "user-row-locked-device",
  C: "chip-erase-locked-device",
};
/** Long options and whether they take a value. */
const longOptions: Readonly<Record<string, boolean>> = {
  device: true,
  packpath: true,
  tool: true,
  serialnumber: true,
  memory: true,
  offset: true,
  bytes: true,
  literal: true,
  filename: true,
  clk: true,
  uart: true,
  "uart-timeout": true,
  interface: true,
  verbose: true,
  "high-voltage": true,
  uf2file: true,
  help: false,
  version: false,
  "release-info": false,
  erase: false,
  verify: false,
  timing: false,
  "user-row-locked-device": false,
  "chip-erase-locked-device": false,
};
const actions = new Set([
  "ping",
  "erase",
  "read",
  "write",
  "verify",
  "getvoltage",
  "getsupplyvoltage",
  "reboot-debugger",
  "setsupplyvoltage",
  "getusbvoltage",
  "reset",
  "makeuf2",
]);
/** Memories whose writes set fuses, configuration or code protection; `all` includes them. */
const protectedMemories = new Set(["fuses", "lockbits", "config_words", "all"]);
const roles = ["<info>", "<protect>", "<high-voltage>", "<locked>", "<unknown>"] as const;
type Role = (typeof roles)[number];

/** argparse treats a word as an option unless it is `-` or a negative number (pymcuprog has no such options). */
const looksLikeOption = (arg: string) => arg.startsWith("-") && arg !== "-" && !/^-\d|^-\.\d/.test(arg);

/** argparse long-option resolution: an exact name, else the only name it abbreviates. */
function longName(name: string): string | undefined {
  if (Object.hasOwn(longOptions, name)) return name;
  const matches = Object.keys(longOptions).filter((option) => option.startsWith(name));
  return name && matches.length === 1 ? matches[0] : undefined;
}

/**
 * Project pymcuprog's parsed arguments for rules only; the original argv is executed unchanged. The result is the
 * action (or `<none>`) followed by role tokens, so irreversible rules can name the action as the typed word.
 */
export function pymcuprogRuleArguments(args: readonly string[]): string[] {
  const found = new Set<Role>();
  const positionals: string[] = [];
  const values: Record<string, string | undefined> = {};
  const set = (name: string, value?: string) => {
    if (name === "version" || name === "release-info" || name === "help") found.add("<info>");
    else if (name === "high-voltage") found.add("<high-voltage>");
    else if (name === "user-row-locked-device" || name === "chip-erase-locked-device") found.add("<locked>");
    values[name] = value;
  };
  let index = 0;
  /** The value of an option that takes one: the attached text, else the next word unless it is an option. */
  const value = (attached: string | undefined, name: string): string | undefined => {
    // An attached or `=` value is the only literal (measured: `-l0x01 write` writes); a separate list runs to the
    // next option, so `-l 0x01 write` swallows the action.
    if (name === "literal" && attached === undefined) {
      const literals: string[] = [];
      while (
        index + 1 < args.length &&
        !looksLikeOption(args[index + 1] as string) &&
        args[index + 1] !== "--"
      )
        literals.push(args[++index] as string);
      return literals.length ? literals.join(" ") : undefined;
    }
    if (attached !== undefined) return attached;
    const next = args[index + 1];
    if (next === undefined || looksLikeOption(next) || next === "--") return undefined;
    index++;
    return next;
  };
  let rest = false;
  for (; index < args.length; index++) {
    const arg = args[index] as string;
    if (rest || !looksLikeOption(arg)) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      rest = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = longName(arg.slice(2, equals === -1 ? undefined : equals));
      if (name === undefined || (!longOptions[name] && equals !== -1)) {
        found.add("<unknown>");
        continue;
      }
      if (!longOptions[name]) set(name);
      else {
        const given = value(equals === -1 ? undefined : arg.slice(equals + 1), name);
        if (given === undefined) found.add("<unknown>");
        else set(name, given);
      }
      continue;
    }
    for (let at = 1; at < arg.length; at++) {
      const letter = arg[at] as string;
      const flag = shortFlags[letter];
      if (flag) {
        set(flag);
        continue;
      }
      const name = shortValues[letter];
      if (!name) {
        found.add("<unknown>");
        break;
      }
      // argparse 3.12+ splits `-m=fuses` (also after grouped flags) at the first `=`; older versions keep it, which
      // pymcuprog then rejects, so dropping one `=` can only raise the classification.
      const attached = at + 1 < arg.length ? arg.slice(at + 1).replace(/^=/, "") : undefined;
      const given = value(attached, name);
      if (given === undefined) found.add("<unknown>");
      else set(name, given);
      break;
    }
  }
  const action = positionals[0];
  if (positionals.length > 1 || (action !== undefined && !actions.has(action))) found.add("<unknown>");
  const memory = values.memory?.toLowerCase();
  if (action === "write") {
    const hex = values.filename?.toLowerCase().endsWith(".hex") ?? false;
    if (hex || protectedMemories.has(memory ?? "all")) found.add("<protect>");
  } else if (
    action === "erase" &&
    memory !== undefined &&
    memory !== "all" &&
    protectedMemories.has(memory)
  ) {
    found.add("<protect>");
  }
  return [
    action !== undefined && actions.has(action) ? action : "<none>",
    ...roles.filter((role) => found.has(role)),
  ];
}
