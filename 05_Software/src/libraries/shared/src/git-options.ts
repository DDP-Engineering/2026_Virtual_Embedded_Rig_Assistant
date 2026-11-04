/** Git has case-sensitive options, per-command arity and executable aliases. Never normalise raw argv. */
const reads = new Set(
  "status log diff show blame shortlog describe rev-parse rev-list ls-files ls-tree cat-file grep reflog merge-base name-rev version help".split(
    " ",
  ),
);
const writes = new Set(
  "add commit switch merge rebase cherry-pick revert reset mv rm apply am stash init fetch pull clone ls-remote push branch tag remote gc maintenance worktree notes update-ref symbolic-ref update-index read-tree write-tree hash-object pack-objects unpack-objects index-pack multi-pack-index prune repack rerere replace sparse-checkout submodule archive bundle format-patch request-pull range-diff fsck count-objects verify-pack verify-commit verify-tag check-attr check-ignore check-mailmap for-each-ref for-each-repo show-ref prune-packed reflog".split(
    " ",
  ),
);
const forbidden =
  /^(?:config|bisect|filter-branch|filter-repo|mergetool|difftool|gui|citool|daemon|instaweb|send-email|credential.*|hook)$/;
const globals = new Set(
  "-P --no-pager --no-optional-locks --no-replace-objects --literal-pathspecs --glob-pathspecs --noglob-pathspecs --icase-pathspecs --no-lazy-fetch".split(
    " ",
  ),
);

// A descriptor is an option's name, arity and optional risk role. Unknown options require approval.
type Role = "<write>" | "<discard>" | "<execute>";
type Arity = "flag" | "value" | "optional";
interface Option {
  name: string;
  arity: Arity;
  role?: Role;
}
const descriptors = (names: string, arity: Arity = "flag", role?: Role): Option[] =>
  names
    .split(" ")
    .filter(Boolean)
    .map((name) => ({ name, arity, ...(role ? { role } : {}) }));

const commonRead = [
  ...descriptors("quiet verbose color no-color abbrev no-abbrev help"),
  ...descriptors("color abbrev", "optional"),
];
const diffOptions = [
  ...descriptors(
    "patch no-patch raw patch-with-raw patch-with-stat numstat shortstat dirstat cumulative dirstat-by-file summary compact-summary name-only name-status stat-check binary full-index check cached staged merge-base exit-code silent follow relative no-relative text reverse no-renames rename-empty no-rename-empty minimal ignore-all-space ignore-space-change ignore-space-at-eol ignore-cr-at-eol ignore-blank-lines patience histogram word-diff-regex color-moved-ws no-index no-prefix no-ext-diff no-textconv no-color-moved no-color-words no-function-context function-context no-indent-heuristic indent-heuristic no-renames no-stat no-patch-with-stat",
  ),
  ...descriptors(
    "stat word-diff color-moved color-words relative find-renames find-copies break-rewrites",
    "optional",
  ),
  ...descriptors(
    "unified inter-hunk-context stat-width stat-name-width stat-graph-width stat-count src-prefix dst-prefix line-prefix output-indicator-new output-indicator-old output-indicator-context diff-algorithm anchored word-diff-regex color-moved-ws ignore-matching-lines order-file rotate-to skip-to diff-filter find-object ignore-submodules submodule",
    "value",
  ),
];
const revisionOptions = [
  ...descriptors(
    "all branches tags remotes bisect boundary no-walk do-walk first-parent exclude-first-parent-only full-history dense sparse simplify-merges simplify-by-decoration ancestry-path left-right cherry-mark cherry-pick count left-only right-only reverse date-order author-date-order topo-order objects objects-edge objects-edge-aggressive indexed-objects alternate-refs unpacked disk-usage use-bitmap-index test-bitmap no-object-names single-worktree reflog exclude-promisor-objects no-min-parents no-max-parents remove-empty merge no-merges merges no-min-parents no-max-parents regexp-ignore-case extended-regexp fixed-strings perl-regexp invert-grep all-match show-pulls pretty oneline decorate no-decorate source use-mailmap no-use-mailmap mailmap no-mailmap graph parents children timestamp header no-commit-header no-abbrev-commit abbrev-commit no-notes show-signature no-show-signature",
  ),
  ...descriptors(
    "max-count skip since after until before author committer grep grep-reflog min-parents max-parents exclude glob filter missing date format pretty encoding decorate-refs decorate-refs-exclude default stdin-encoding notes no-notes",
    "value",
  ),
  ...descriptors("branches tags remotes no-walk decorate notes", "optional"),
];
const perCommand: Readonly<Record<string, Option[]>> = {
  "for-each-ref": descriptors("format sort", "value"),
  help: descriptors("all guides config user-interfaces developer-interfaces verbose no-verbose"),
  version: descriptors("build-options"),
  status: [
    ...descriptors("short branch show-stash porcelain long verbose null no-renames"),
    ...descriptors("untracked-files ignored ignore-submodules column ahead-behind find-renames", "optional"),
    ...descriptors("renames", "flag"),
  ],
  log: [...diffOptions, ...revisionOptions],
  show: [...diffOptions, ...revisionOptions],
  diff: diffOptions,
  "rev-list": [...revisionOptions, ...diffOptions],
  blame: [
    ...descriptors(
      "root show-stats progress no-progress line-porcelain porcelain incremental score-debug contents show-name show-number show-email ignore-revs-file ignore-rev blank-boundary abbrev",
    ),
    ...descriptors("contents ignore-rev ignore-revs-file date encoding abbrev", "value"),
  ],
  shortlog: [
    ...revisionOptions,
    ...descriptors("numbered summary email no-merges group", "flag"),
    ...descriptors("group format", "value"),
  ],
  describe: [
    ...descriptors("all tags contains exact-match long always first-parent"),
    ...descriptors("dirty broken", "optional"),
    ...descriptors("abbrev candidates match exclude", "value"),
  ],
  "rev-parse": [
    ...descriptors(
      "verify quiet sq sq-quote not symbolic symbolic-full-name abbrev-ref all branches tags remotes show-toplevel show-prefix show-cdup show-object-format is-inside-git-dir is-inside-work-tree is-bare-repository is-shallow-repository git-dir absolute-git-dir git-common-dir local-env-vars show-superproject-working-tree shared-index-path revs-only no-revs flags no-flags shell-quote parseopt keep-dashdash stop-at-non-option stuck-long",
    ),
    ...descriptors(
      "default prefix path-format git-path resolve-git-dir disambiguate exclude glob since after before until",
      "value",
    ),
    ...descriptors("short abbrev-ref show-object-format branches tags remotes", "optional"),
  ],
  "ls-files": [
    ...descriptors(
      "cached deleted modified others ignored stage unmerged killed directory no-empty-directory error-unmatch with-tree exclude-standard full-name recurse-submodules deduplicate eol sparse debug null",
    ),
    ...descriptors("exclude exclude-from exclude-per-directory with-tree format", "value"),
  ],
  "ls-tree": [
    ...descriptors("full-name full-tree name-only name-status long object-only recurse-trees null"),
    ...descriptors("format abbrev", "value"),
  ],
  "cat-file": [
    ...descriptors("batch-all-objects unordered buffer follow-symlinks allow-unknown-type use-mailmap"),
    ...descriptors("batch batch-check batch-command", "optional"),
  ],
  grep: [
    ...descriptors(
      "cached no-index untracked no-exclude-standard recurse-submodules text binary-files textconv ignore-case invert-match word-regexp extended-regexp basic-regexp fixed-strings perl-regexp line-number column full-name files-with-matches name-only files-without-match null count only-matching heading break all-match and or not quiet no-textconv no-ext-grep ext-grep",
    ),
    ...descriptors("regexp file max-depth max-count after-context before-context context threads", "value"),
  ],
  reflog: [...revisionOptions, ...diffOptions],
  stash: [...revisionOptions, ...diffOptions],
  "merge-base": [...descriptors("all octopus independent is-ancestor fork-point")],
  "name-rev": [
    ...descriptors("name-only tags all no-undefined always annotate-stdin"),
    ...descriptors("refs exclude", "value"),
  ],
  branch: [
    ...descriptors(
      "all remotes verbose list show-current no-merged contains no-contains merged column no-column no-color no-abbrev",
    ),
    ...descriptors("contains no-contains merged no-merged", "optional"),
    ...descriptors("sort format points-at abbrev color", "value"),
    ...descriptors("delete move copy force", "flag", "<write>"),
    ...descriptors("edit-description", "flag", "<write>"),
  ],
  tag: [
    ...descriptors("list"),
    ...descriptors("lines", "optional"),
    ...descriptors("contains no-contains merged no-merged", "optional"),
    ...descriptors("sort format points-at color", "value"),
    ...descriptors("delete force", "flag", "<write>"),
  ],
  remote: descriptors("verbose"),
};

// Case-sensitive aliases and their value roles. An attached value consumes the remainder of a bundle.
const short: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  status: { s: "short", b: "branch", v: "verbose", z: "null", u: "untracked-files", h: "help" },
  log: {
    n: "max-count",
    p: "patch",
    s: "no-patch",
    c: "patch",
    m: "patch",
    r: "patch",
    t: "patch",
    U: "unified",
    S: "pickaxe-string",
    G: "pickaxe-regex",
    L: "line-range",
    M: "find-renames",
    C: "find-copies",
    B: "break-rewrites",
    O: "order-file",
    w: "ignore-all-space",
    b: "ignore-space-change",
    i: "regexp-ignore-case",
    E: "extended-regexp",
    F: "fixed-strings",
    P: "perl-regexp",
    z: "null",
    h: "help",
  },
  diff: {
    p: "patch",
    s: "no-patch",
    u: "patch",
    U: "unified",
    R: "reverse",
    S: "pickaxe-string",
    G: "pickaxe-regex",
    M: "find-renames",
    C: "find-copies",
    B: "break-rewrites",
    D: "irreversible-delete",
    O: "order-file",
    w: "ignore-all-space",
    b: "ignore-space-change",
    a: "text",
    z: "null",
    h: "help",
  },
  blame: {
    L: "line-range",
    M: "find-renames",
    C: "find-copies",
    w: "ignore-all-space",
    b: "blank-boundary",
    l: "long",
    t: "raw-time",
    s: "suppress-author",
    e: "show-email",
    p: "porcelain",
    f: "show-name",
    n: "show-number",
    h: "help",
  },
  branch: {
    a: "all",
    r: "remotes",
    v: "verbose",
    l: "list",
    d: "delete",
    D: "delete",
    m: "move",
    M: "move",
    c: "copy",
    C: "copy",
    f: "force",
    h: "help",
  },
  help: { a: "all", g: "guides", c: "config" },
  shortlog: { n: "numbered", s: "summary", e: "email", w: "wrap", h: "help" },
  tag: {
    l: "list",
    n: "lines",
    d: "delete",
    f: "force",
    s: "sign",
    v: "verify",
    u: "local-user",
    a: "annotate",
    m: "message",
    F: "file",
    h: "help",
  },
  remote: { v: "verbose", h: "help" },
  grep: {
    O: "open-files-in-pager",
    o: "only-matching",
    n: "line-number",
    e: "regexp",
    f: "file",
    v: "invert-match",
    i: "ignore-case",
    w: "word-regexp",
    E: "extended-regexp",
    G: "basic-regexp",
    F: "fixed-strings",
    P: "perl-regexp",
    a: "text",
    I: "binary-files",
    l: "files-with-matches",
    L: "files-without-match",
    z: "null",
    c: "count",
    q: "quiet",
    A: "after-context",
    B: "before-context",
    C: "context",
    W: "function-context",
    h: "no-filename",
    H: "with-filename",
  },
  add: {
    i: "interactive",
    p: "patch",
    e: "edit",
    N: "intent-to-add",
    A: "all",
    f: "force",
    u: "update",
    v: "verbose",
  },
  rebase: {
    i: "interactive",
    x: "exec",
    q: "quiet",
    v: "verbose",
    S: "gpg-sign",
    s: "strategy",
    X: "strategy-option",
  },
  push: {
    f: "force",
    d: "delete",
    v: "verbose",
    q: "quiet",
    n: "dry-run",
    o: "push-option",
    u: "set-upstream",
  },
  switch: { f: "force", q: "quiet", c: "create", C: "force-create", m: "merge", d: "detach", t: "track" },
  am: { i: "interactive", q: "quiet" },
  clone: { u: "upload-pack", q: "quiet", v: "verbose", o: "origin", b: "branch", c: "config" },
  "ls-remote": { u: "upload-pack", q: "quiet" },
  reset: { p: "patch", q: "quiet" },
  stash: { p: "patch", q: "quiet" },
  checkout: { p: "patch", f: "force" },
  restore: { p: "patch" },
  commit: {
    p: "patch",
    i: "include",
    m: "message",
    F: "file",
    C: "reuse-message",
    c: "reedit-message",
    S: "gpg-sign",
    e: "edit",
    a: "all",
    q: "quiet",
    v: "verbose",
  },
  merge: {
    m: "message",
    F: "file",
    S: "gpg-sign",
    s: "strategy",
    X: "strategy-option",
    e: "edit",
    q: "quiet",
    v: "verbose",
  },
  fetch: { o: "server-option", q: "quiet", v: "verbose" },
  pull: {
    r: "rebase",
    o: "server-option",
    q: "quiet",
    v: "verbose",
    S: "gpg-sign",
    s: "strategy",
    X: "strategy-option",
  },
};

const extraValues =
  "message file reuse-message reedit-message exec gpg-sign local-user strategy strategy-option upload-pack receive-pack config-env push-option server-option repo create force-create track pickaxe-string pickaxe-regex line-range";
const extraOptional = "find-renames find-copies break-rewrites";
const executes =
  "config-env exec-path git-dir work-tree namespace super-prefix config interactive patch edit reedit-message exec open-files-in-pager ext-diff textconv filters gpg-sign sign show-signature verify edit-todo edit-description local-user strategy upload-pack receive-pack";

// Pretty verifies as soon as it sees G, even for an unknown following letter. Ref-filter
// can verify both peeled signature atoms and signature sort keys (including version sorts).
const signatureFormat = (value: string) => /%[+ -]?G|%\(\*?signature(?::|\))/.test(value);
const signatureSort = (value: string) => /^-?(?:(?:version|v):)?\*?signature(?::|$)/.test(value);

function options(command: string, read = reads.has(command)): Option[] {
  const result = [...commonRead, ...(perCommand[command] ?? [])];
  // Command-specific helper flags: e.g. diff --patch is safe, add --patch is interactive.
  const blocked = executes
    .split(" ")
    .filter(
      (name) =>
        (name !== "config" || command !== "help") &&
        (!["interactive", "patch", "edit", "exec", "reedit-message"].includes(name) || !read),
    );
  result.push(...descriptors(blocked.join(" "), "value", "<execute>"));
  for (const name of extraValues.split(" "))
    if (!result.some((item) => item.name === name)) result.push({ name, arity: "value" });
  for (const name of extraOptional.split(" "))
    if (!result.some((item) => item.name === name)) result.push({ name, arity: "optional" });
  result.push(...descriptors("color abbrev", "optional"));
  if (["log", "show", "rev-list", "reflog", "stash"].includes(command))
    result.push(...descriptors("format pretty", "optional"));
  result.push(...descriptors("output output-file", "value", "<write>"));
  if (["commit", "merge", "cherry-pick", "revert", "pull"].includes(command))
    result.push(...descriptors("no-edit"));
  if (command === "pull") result.push(...descriptors("rebase", "optional"));
  if (command === "reset") result.push(...descriptors("hard", "optional", "<discard>"));
  if (command === "switch") result.push(...descriptors("force discard-changes", "flag", "<discard>"));
  if (command === "push")
    result.push(
      ...descriptors("force force-with-lease force-if-includes delete mirror prune", "optional", "<discard>"),
    );
  if (command === "gc") result.push(...descriptors("prune", "optional", "<discard>"));
  return result;
}

/** Command position shared by risk projection and fixed execution guards. Unknown globals fail closed. */
function gitCommandIndex(args: readonly string[]): number | null {
  let index = 0;
  for (; index < args.length; index++) {
    const arg = args[index] as string;
    if (globals.has(arg)) continue;
    if (["--version", "-v"].includes(arg)) break;
    if (["--help", "-h"].includes(arg)) break;
    if (arg.startsWith("-")) return null;
    break;
  }
  return index;
}

/** Execution-only safeguard: an empty diff.external is fail-closed, not a usable disable sentinel. */
export function gitExecutionArguments(args: readonly string[]): string[] {
  const commandIndex = gitCommandIndex(args);
  if (commandIndex === null) return [...args];
  const command = args[commandIndex];
  const subcommand = args[commandIndex + 1];
  let insertion = commandIndex + 1;
  if (["diff", "log", "show"].includes(command ?? "")) {
    // These commands accept the shared diff options.
  } else if (command === "stash" && ["show", "list"].includes(subcommand ?? "")) {
    insertion++;
  } else if (command === "reflog") {
    if (subcommand === "show") insertion++;
    else if (["exists", "list", "expire", "delete", "drop", "write"].includes(subcommand ?? ""))
      return [...args];
  } else return [...args];
  return [...args.slice(0, insertion), "--no-ext-diff", ...args.slice(insertion)];
}

/** Project only the roles needed by declarative rules. Approval arguments remain the original argv. */
export function gitRuleArguments(args: readonly string[]): string[] {
  const commandIndex = gitCommandIndex(args);
  if (commandIndex === null) return ["<execute>"];
  let index = commandIndex;
  let command = args[index++] ?? "help";
  const subcommand = args[index];
  if (["--version", "-v"].includes(command)) command = "version";
  if (["--help", "-h"].includes(command)) command = "help";
  if (
    forbidden.test(command) ||
    (!reads.has(command) && !writes.has(command) && !["clean", "restore", "checkout"].includes(command))
  )
    return ["<execute>"];
  const result = [command];
  const roles = new Set<Role>();
  const operands: string[] = [];
  const flags = new Set<string>();
  const stashRead = command === "stash" && ["list", "show"].includes(subcommand ?? "");
  const table = options(command, reads.has(command) || stashRead);
  let ended = false;
  const accept = (name: string, attached: string | undefined, isLong: boolean): boolean => {
    // Native parse-options permits long abbreviations. Escalate any sensitive candidate even if ambiguous.
    const candidates = table.filter((item) => item.name === name || (isLong && item.name.startsWith(name)));
    for (const item of candidates) if (item.role) roles.add(item.role);
    if (isLong && name.startsWith("no-") && !table.some((item) => item.name === name)) {
      const positive = name.replace(/^(?:no-)+/, "");
      for (const item of table) if (item.role && item.name.startsWith(positive)) roles.add(item.role);
    }
    const exact = candidates.filter((item) => item.name === name);
    const chosen = exact.length ? exact : candidates;
    if (!chosen.length) {
      roles.add("<write>");
      return false;
    }
    for (const item of chosen) flags.add(item.name);
    // The last descriptor wins arity (specific optional forms override a common flag declaration).
    const descriptor = chosen[chosen.length - 1] as Option;
    const value = attached ?? args[index + 1] ?? "";
    if (command === "pull" && descriptor.name === "rebase" && /^(?:i|interactive)$/.test(attached ?? ""))
      roles.add("<execute>");
    if (
      (["format", "pretty", "group"].includes(descriptor.name) && signatureFormat(value)) ||
      (descriptor.name === "sort" && signatureSort(value))
    )
      roles.add("<execute>");
    if (descriptor.arity === "value" && attached === undefined) {
      const next = args[index + 1];
      // Do not let an unfamiliar optional-value spelling swallow a later risk flag. These
      // literal-value options are verified to consume even a dash-leading argument in Git.
      const literal =
        (command === "grep" && ["regexp", "file"].includes(name)) ||
        (command === "commit" && ["message", "file", "reuse-message", "reedit-message"].includes(name));
      if (literal || !next?.startsWith("-")) index++;
    }
    return descriptor.arity !== "flag";
  };
  for (; index < args.length; index++) {
    const arg = args[index] as string;
    if (!ended && ["--", "--end-of-options"].includes(arg)) {
      ended = true;
      continue;
    }
    if (ended || !arg.startsWith("-") || arg === "-") {
      operands.push(arg);
      continue;
    }
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = arg.slice(2, equals < 0 ? undefined : equals);
      // Safe negative switches must be exact; repeated negation of a helper switch fails closed.
      if (/^(?:no-)+(?:textconv|ext-diff)$/.test(name) && !["no-textconv", "no-ext-diff"].includes(name))
        roles.add("<execute>");
      accept(name, equals < 0 ? undefined : arg.slice(equals + 1), true);
    } else {
      const aliases =
        short[stashRead || ["show", "rev-list", "reflog"].includes(command) ? "log" : command] ?? {};
      for (let offset = 1; offset < arg.length; offset++) {
        const name = aliases[arg[offset] as string];
        if (!name) {
          roles.add("<write>");
          continue;
        }
        if (accept(name, offset + 1 < arg.length ? arg.slice(offset + 1) : undefined, false)) break;
      }
    }
  }
  if (command !== "help" && flags.has("help") && args.includes("--help")) roles.add("<execute>");
  if (["verify-commit", "verify-tag", "for-each-repo"].includes(command)) roles.add("<execute>");
  if (
    command === "help" &&
    (operands.length ||
      roles.size ||
      [...flags].some(
        (flag) =>
          ![
            "help",
            "all",
            "guides",
            "config",
            "user-interfaces",
            "developer-interfaces",
            "verbose",
            "no-verbose",
          ].includes(flag),
      ))
  )
    roles.add("<execute>");
  if (command === "submodule" && operands.includes("foreach")) roles.add("<execute>");
  if (command === "stash") {
    if (["list", "show"].includes(subcommand ?? "")) result.push("<list>");
    if (["drop", "clear"].includes(subcommand ?? "")) roles.add("<discard>");
  }
  if (command === "reflog" && ["expire", "delete", "drop"].includes(operands[0] ?? ""))
    roles.add("<discard>");
  if (command === "reflog" && ["write"].includes(operands[0] ?? "")) roles.add("<write>");
  if (
    command === "branch" &&
    (!operands.length ||
      [
        "list",
        "all",
        "remotes",
        "verbose",
        "show-current",
        "contains",
        "no-contains",
        "merged",
        "no-merged",
      ].some((flag) => flags.has(flag)))
  )
    result.push("<list>");
  if (command === "tag" && (!operands.length || flags.has("list") || flags.has("lines")))
    result.push("<list>");
  if (command === "remote" && !operands.length) result.push("<list>");
  if (command === "push" && operands.some((operand) => operand.startsWith("+") || /^\+?:.+/.test(operand)))
    roles.add("<discard>");
  return [...result, ...roles];
}
