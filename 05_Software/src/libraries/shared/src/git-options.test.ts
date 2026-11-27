import { expect, it } from "vitest";
import { gitCommitPreviewArguments, gitExecutionArguments, gitRuleArguments } from "./git-options.js";

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

it("reads what a commit records from the index, the tracked changes or the named paths", () => {
  const stat = ["diff", "--no-ext-diff", "--no-textconv", "--stat=100", "--stat-count=40"];
  expect(gitCommitPreviewArguments(["commit", "-m", "Fix"])).toEqual([...stat, "--cached"]);
  expect(gitCommitPreviewArguments(["-P", "commit", "--amend", "--no-edit"])).toEqual([...stat, "--cached"]);
  expect(gitCommitPreviewArguments(["commit", "-am", "Fix"])).toEqual([...stat, "HEAD"]);
  expect(gitCommitPreviewArguments(["commit", "--all", "-m", "Fix"])).toEqual([...stat, "HEAD"]);
  expect(gitCommitPreviewArguments(["commit", "-m", "Fix", "--", "src/a.c", "-a"])).toEqual([
    ...stat,
    "HEAD",
    "--",
    "src/a.c",
    "-a",
  ]);
  for (const other of [["status"], ["add", "--", "commit"], ["-c", "x=y", "commit", "-m", "Fix"], []])
    expect(gitCommitPreviewArguments(other)).toBeUndefined();
});
