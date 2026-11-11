// STM32_Programmer_CLI 2.23.0 commands (from its --help, probed without a board): several commands per line, run in
// order; the words after a command are its arguments. Measured parsing: names are case-insensitive, any number of
// leading dashes is accepted (`--rdu`, `---fchecksum`), surrounding spaces are trimmed, and other spellings are either
// rejected, ignored, crash the CLI or (`-file-checksum`) reach another command. The help spellings map to canonical
// short names; any other dash word is <unknown> plus every command its dash-stripped name or its parts could mean.
const aliases: Readonly<Record<string, string>> = {
  "-?": "-h",
  "--help": "-h",
  "--connect": "-c",
  "--version": "-version",
  "--list": "-l",
  "--quietmode": "-q",
  "--log": "-log",
  "--verbosity": "-vb",
  "--yes": "-y",
  "--safelib": "-sl",
  "--mergesbsfu": "-ms",
  "--erase": "-e",
  "--write": "-w",
  "-d": "-w",
  "--download": "-w",
  "--verify": "-v",
  "--noverify": "-nv",
  "--checksum": "-checksum",
  "--read": "-r",
  "-u": "-r",
  "--upload": "-r",
  "--extload": "-el",
  "--extloadbl": "-elbl",
  "-s": "-g",
  "--start": "-g",
  "--go": "-g",
  "--readunprotect": "-rdu",
  "--tzenregression": "-tzenreg",
  "--optionbytes": "-ob",
  "--force_no_da": "-force_no_da",
  "--noreconnect": "-noreconnect",
  "-setoem1key": "-lockrdp1",
  "-setoem2key": "-lockrdp2",
  "--file-checksum": "-fchecksum",
  "--power": "-pwr",
  "--getcertificate": "-gc",
  "--phaseid": "-p",
  "--readpart": "-rp",
  "--ssp": "-ssp",
  "--storekeyotp": "-storekeyotp",
  "--installipmodule": "-installipmodule",
  "--updateipmodule": "-updateipmodule",
  "--sfi": "-sfi",
  "--ssfi": "-ssfi",
  "--rsse": "-rsse",
  "--mcsv": "-mcsv",
  "--ecsv": "-ecsv",
  "--abort": "-a",
  "--rssgetversion": "-rssgetversion",
  "-hsmgetlicensefromcertifbin": "-hsmglfcb",
};
const commands = new Set([
  ...Object.values(aliases),
  ..."-gettargetsellist --skiperase -w32 -w16 -w8 -r32 -r16 -r8 -r32fast -rst -hardrst -rstbl -halt -run -step -score -corereg -w32dbgmcu -unlockrdp1 -unlockrdp2 -ssigfoxc -wsigfoxc -fillmemory -blankcheck -regdump -hf -detach -wb -pmic -tm -otp -dsecurity -setdefaultob -hsmgetinfo -hsmgetcounter -hsmgetfwid -hsmgetstatus -hsmgetlicense -getuid64 -fusgetstate -fusopgetversion -antirollback -startfus -fwdelete -fwupgrade -startwirelessstack -authkeyupdate -authkeylock -wusrkey -swv -ra -startswv -script -sdp -pwd -psrss -obrss -rssekw".split(
    " ",
  ),
]);
const listOnly = new Set(["st-link-only", "stlink-only", "uart", "usb"]);
/** Help spellings (lower case) and the canonical names they mean. */
const documented = new Map<string, string>([
  ...[...commands].map((name): [string, string] => [name, name]),
  ...Object.entries(aliases),
]);
/** The same names without their dashes, for spellings the help does not list. */
const byName = new Map(
  [...documented].map(([spelling, name]): [string, string] => [spelling.replace(/^-+/, ""), name]),
);

/** A word the CLI may take as a command: any dash word except a number (`-1`, `-0.5`, `-0x10` are arguments). */
const commandLike = (word: string) =>
  word.startsWith("-") && !/^-(?:\d+(?:\.\d*)?|\.\d+|0x[0-9a-f]+)$/.test(word);

/** The canonical commands a dash word can mean, with `<unknown>` first unless the help spells it this way. */
function meanings(word: string): string[] {
  const exact = documented.get(word);
  if (exact) return [exact];
  const name = word.replace(/^-+/, "");
  const parts = [name, ...name.split(/[^a-z0-9?]+/)];
  return ["<unknown>", ...new Set(parts.flatMap((part) => byName.get(part) ?? []))];
}

/**
 * Project an STM32_Programmer_CLI line for rules only; the original argv is executed unchanged. Every command
 * becomes its canonical name, with a qualifier where one name has two risks: `-ob`/`-otp`/`-psrss` `displ` or
 * `<write>` (`word=` is allowed only after `-otp displ`), `-corereg <write>` for an assignment and `debugauth` for
 * any word starting `debugauth` except `debugauth=2`, wherever it stands; a board-free listing (`-l st-link-only`)
 * becomes `<list-only>` instead of `-l`. Words are lower-cased and, failing closed, split at white space (the CLI
 * trims words and ignores inner spaces); a word before the first command is <unknown>.
 */
export function stm32RuleArguments(args: readonly string[]): string[] {
  const words = args.flatMap((arg) => arg.toLowerCase().split(/\s+/).filter(Boolean));
  const result: string[] = [];
  for (let index = 0; index < words.length; ) {
    const word = words[index++] as string;
    if (!commandLike(word)) {
      result.push("<unknown>");
      continue;
    }
    const values: string[] = [];
    while (index < words.length && !commandLike(words[index] as string))
      values.push(words[index++] as string);
    for (const name of meanings(word)) {
      if (name === "-l" && values.length > 0 && values.every((value) => listOnly.has(value))) {
        result.push("<list-only>");
        continue;
      }
      result.push(name);
      if (name === "-ob" || name === "-otp" || name === "-psrss") {
        const display =
          values[0] === "displ" &&
          values.slice(1).every((value) => name === "-otp" && value.startsWith("word="));
        result.push(display ? "displ" : "<write>");
      } else if (name === "-corereg" && values.some((value) => value.includes("="))) result.push("<write>");
    }
  }
  // Debug authentication is a -c parameter; recognizing it anywhere, with any value but 2, fails closed.
  const bare = words.map((word) => word.replace(/^-+/, ""));
  if (bare.some((word) => word.startsWith("debugauth") && word !== "debugauth=2")) result.push("debugauth");
  return result;
}
