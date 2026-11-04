import { expect, it } from "vitest";
import { gitExecutionArguments, gitRuleArguments } from "./git-options.js";

it("places fixed diff guards at actual command boundaries, preserving raw values and delimiters", () => {
  const cases = [
    [
      ["diff", "--staged", "--", "file"],
      ["diff", "--no-ext-diff", "--staged", "--", "file"],
    ],
    [
      ["-P", "--literal-pathspecs", "show", "HEAD", "--", "file"],
      ["-P", "--literal-pathspecs", "show", "--no-ext-diff", "HEAD", "--", "file"],
    ],
    [
      ["--no-pager", "log", "-p"],
      ["--no-pager", "log", "--no-ext-diff", "-p"],
    ],
    [
      ["stash", "show", "--stat", "stash@{0}"],
      ["stash", "show", "--no-ext-diff", "--stat", "stash@{0}"],
    ],
    [
      ["stash", "list", "-p"],
      ["stash", "list", "--no-ext-diff", "-p"],
    ],
    [
      ["reflog", "show", "-p"],
      ["reflog", "show", "--no-ext-diff", "-p"],
    ],
    [
      ["reflog", "-p"],
      ["reflog", "--no-ext-diff", "-p"],
    ],
  ];
  for (const [raw, expected] of cases) {
    const original = [...(raw ?? [])];
    expect(gitExecutionArguments(raw ?? [])).toEqual(expected);
    expect(raw).toEqual(original);
  }
  for (const raw of [
    ["status"],
    ["commit", "-m", "diff"],
    ["--version", "diff"],
    ["-v", "show"],
    ["--help", "diff"],
    ["-c", "diff.external=x", "diff"],
    ["-Celsewhere", "diff"],
    ["--", "diff"],
    ["stash"],
    ["stash", "push"],
    ["stash", "--", "show"],
    ["stash", "-q", "list"],
    ...["exists", "list", "expire", "delete", "drop", "write"].map((sub) => ["reflog", sub]),
  ])
    expect(gitExecutionArguments(raw)).toEqual(raw);
});

it("does not turn stash push path operands into safe listing subcommands", () => {
  for (const raw of [
    ["stash", "--", "list"],
    ["stash", "--", "show"],
    ["stash", "-q", "list"],
    ["stash", "--keep-index", "show"],
  ])
    expect(gitRuleArguments(raw)).not.toContain("<list>");
  for (const raw of [
    ["stash", "list"],
    ["-P", "stash", "show", "--", "list"],
  ])
    expect(gitRuleArguments(raw)).toContain("<list>");
});
