// tshark 4.6.8 option arity, measured with `tshark -r <file> -<letter>` and `--<name>`. Short letters are
// case-sensitive (-x hex dump, -X extension options), so roles are projected before the matcher lowercases.
const shortValues = new Set("abcdefijorstuwyzABCEFGHJKMNORSTUWXY");
const shortFlags = new Set("ghlnpqvxDILPQV2");
const longOptions: Readonly<Record<string, boolean>> = {
  interface: true,
  source: true,
  "list-sources": false,
  "print-timers": false,
  "selected-frame": true,
  "compress-type": true,
  "log-domain": true,
  "log-fatal-domain": true,
  "snapshot-length": true,
  "no-promiscuous-mode": false,
  "monitor-mode": false,
  "buffer-size": true,
  linktype: true,
  "time-stamp-type": true,
  "list-interfaces": false,
  "list-data-link-types": false,
  "list-time-stamp-types": false,
  "update-interval": true,
  autostop: true,
  "ring-buffer": true,
  "read-file": true,
  "read-filter": true,
  "display-filter": true,
  "enable-protocol": true,
  "disable-protocol": true,
  "only-protocols": true,
  "disable-all-protocols": false,
  "enable-heuristic": true,
  "disable-heuristic": true,
  "capture-comment": true,
  "global-profile": false,
  print: false,
  hexdump: true,
  color: false,
  "no-duplicate-keys": false,
  "elastic-mapping-filter": true,
  "temp-dir": true,
  compress: true,
  "export-objects": true,
  "export-tls-session-keys": true,
  "log-level": true,
  "log-fatal": true,
  "log-domains": true,
  "log-fatal-domains": true,
  "log-debug": true,
  "log-noisy": true,
  "log-file": true,
  help: false,
  version: false,
};
const shortLong: Readonly<Record<string, string>> = {
  h: "help",
  v: "version",
  D: "list-interfaces",
  G: "report",
  i: "interface",
  I: "monitor-mode",
  L: "list-data-link-types",
  r: "read-file",
  A: "rpcap-auth",
  X: "extension",
};
const info = new Set(["help", "version", "list-interfaces", "list-sources", "report"]);
const capture = new Set([
  "interface",
  "source",
  "monitor-mode",
  "list-data-link-types",
  "list-time-stamp-types",
]);
const roles = ["<info>", "<file>", "<capture>", "<unknown>", "<execute>", "<credentials>"] as const;
type Role = (typeof roles)[number];

/** getopt_long resolution: an exact name, else the only name it abbreviates. */
function longName(name: string): string | undefined {
  if (Object.hasOwn(longOptions, name)) return name;
  const matches = Object.keys(longOptions).filter((option) => option.startsWith(name));
  return name && matches.length === 1 ? matches[0] : undefined;
}

/**
 * Project tshark's option roles for rules only; the original argv is executed unchanged. tshark stops
 * parsing at the first non-option or `--` and treats the rest as filter text. The rest is still read as
 * options for roles that raise risk, never for `<info>` or `<file>`, so a filter cannot lower a command.
 */
export function tsharkRuleArguments(args: readonly string[]): string[] {
  const found = new Set<Role>();
  let tail = false;
  const see = (name: string, value: string | undefined) => {
    if (name === "extension" && /^lua_script/i.test(value ?? "")) found.add("<execute>");
    else if (name === "rpcap-auth") found.add("<credentials>");
    else if (capture.has(name)) found.add("<capture>");
    else if (tail) return;
    else if (info.has(name)) found.add("<info>");
    else if (name === "read-file") found.add("<file>");
  };
  // A leading -G may stand alone (default report); what follows it is only checked for raised roles.
  if (args[0] === "-G") {
    found.add("<info>");
    tail = true;
  }
  for (let index = tail ? 1 : 0; index < args.length; index++) {
    const arg = args[index] as string;
    if (arg === "--" || !arg.startsWith("-") || arg === "-") {
      tail = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = longName(arg.slice(2, equals === -1 ? undefined : equals));
      if (name === undefined) {
        if (!tail) found.add("<unknown>");
        continue;
      }
      const value = longOptions[name] ? (equals === -1 ? args[++index] : arg.slice(equals + 1)) : undefined;
      see(name, value);
      continue;
    }
    for (let at = 1; at < arg.length; at++) {
      const letter = arg[at] as string;
      if (shortValues.has(letter)) {
        const value = at + 1 < arg.length ? arg.slice(at + 1) : args[++index];
        see(shortLong[letter] ?? letter, value);
        break;
      }
      if (shortFlags.has(letter)) see(shortLong[letter] ?? letter, undefined);
      else if (!tail) found.add("<unknown>");
    }
  }
  if (!found.has("<file>") && !found.has("<info>")) found.add("<capture>");
  return roles.filter((role) => found.has(role));
}
