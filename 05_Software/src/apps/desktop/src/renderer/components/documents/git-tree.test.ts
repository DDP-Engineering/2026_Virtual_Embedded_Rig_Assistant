import type { GitStatusEntry } from "@vera/shared";
import { expect, it } from "vitest";
import { type FileTreeEntry, gitFolders, gitTree } from "./git-tree.js";

const entry = (path: string, virtual: boolean): GitStatusEntry => ({
  path,
  staged: virtual ? "D" : null,
  unstaged: virtual ? null : "?",
  virtual,
  conflict: false,
});
const regular = (path: string, ignored = false): FileTreeEntry => ({
  path,
  type: "file",
  name: path,
  ignored,
});

it("keeps deleted descendants and the live file occupying their former directory path", () => {
  const named = regular("old-dir");
  const git = gitTree([entry("old-dir/a/deleted.txt", true), entry("old-dir", false)]);
  const listed = new Map([["", [named]]]);
  for (const changesOnly of [false, true]) {
    const rows = gitFolders(listed, git, changesOnly, "").get("");
    expect(rows).toEqual([
      named,
      expect.objectContaining({
        path: "old-dir/a/deleted.txt",
        name: "old-dir/a/deleted.txt",
        gitVirtual: true,
      }),
    ]);
  }
  const results = gitFolders(listed, git, true, "old-dir/a").get("");
  expect(results).toEqual([expect.objectContaining({ path: "old-dir/a/deleted.txt", gitVirtual: true })]);
});

it("uses full displayed paths for search and keeps worktree actions bound to verified Files rows", () => {
  const git = gitTree([entry("vera-ignored/native.png", false)]);
  const rows = gitFolders(new Map(), git, true, "vera-ignored/").get("vera-ignored");
  expect(rows).toEqual([expect.objectContaining({ path: "vera-ignored/native.png", unverified: true })]);
  const verified = regular("vera-ignored/native.png", true);
  expect(gitFolders(new Map([["vera-ignored", [verified]]]), git, true, "").get("vera-ignored")).toEqual([
    verified,
  ]);
});
