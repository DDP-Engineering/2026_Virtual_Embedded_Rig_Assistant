// GLib short names are case-sensitive. Keep values out of the rule token stream
// except for the driver identity and the config shape needed to classify output changes.
const shortOptions: Readonly<Record<string, string>> = {
  V: "version",
  L: "list-supported",
  h: "help",
  "?": "help",
  l: "loglevel",
  d: "driver",
  c: "config",
  i: "input-file",
  I: "input-format",
  o: "output-file",
  O: "output-format",
  T: "transform-module",
  C: "channels",
  g: "channel-group",
  t: "triggers",
  w: "wait-trigger",
  P: "protocol-decoders",
  A: "protocol-decoder-annotations",
  M: "protocol-decoder-meta",
  B: "protocol-decoder-binary",
  D: "dont-scan",
};
const valueOptions = new Set([
  "loglevel",
  "driver",
  "config",
  "input-file",
  "input-format",
  "output-file",
  "output-format",
  "transform-module",
  "channels",
  "channel-group",
  "triggers",
  "protocol-decoders",
  "protocol-decoder-annotations",
  "protocol-decoder-meta",
  "protocol-decoder-binary",
  "time",
  "samples",
  "frames",
  "get",
]);
const reservedSelector = /^sigrok_key(?:=|$)/i;
const pwmGroupName = /^pwm[012]$/i;

/** Project the fork's option names for rules only. The original argv is executed unchanged. */
export function sigrokRuleArguments(args: readonly string[]): string[] {
  const flags: string[] = [];
  const configs: string[] = [];
  let driver = "<auto>";
  let pwmGroup = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string;
    if (arg === "--") break;
    const long = arg.startsWith("--");
    const equals = long ? arg.indexOf("=") : -1;
    const names = long
      ? [arg.slice(2, equals === -1 ? undefined : equals)]
      : arg.startsWith("-")
        ? [...arg.slice(1)].map((short) => shortOptions[short] ?? "")
        : [];
    for (const name of names) {
      if (!name) continue;
      const value = valueOptions.has(name)
        ? equals === -1
          ? args[++index]
          : arg.slice(equals + 1)
        : undefined;
      if (name === "driver") {
        const [id, ...options] = value?.split(":") ?? [];
        // The fork uses the same hash key for the driver id and an explicit sigrok_key option.
        if (
          id &&
          /^[a-z\d][a-z\d-]*$/i.test(id) &&
          !options.some((option) => reservedSelector.test(option))
        ) {
          driver = id.includes("usbrelay") ? "usbrelay" : id;
        }
      } else if (name === "channel-group") {
        pwmGroup ||= pwmGroupName.test(value ?? "");
      } else if (name === "config") {
        configs.push(value ?? "");
      } else if (!valueOptions.has(name) || value !== undefined) {
        flags.push(`--${name}`);
      }
    }
  }
  const result = ["--driver", driver, ...flags];
  for (const config of configs) {
    const pwm =
      pwmGroup ||
      config
        .split(":")
        .some(
          (entry) => /^(?:pwm|channel_group=pwm[012](?:$|=))/i.test(entry) || reservedSelector.test(entry),
        );
    result.push("--config", pwm ? "pwm" : "settings");
  }
  return result;
}
