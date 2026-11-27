import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { gitHead } from "./git-head.js";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function repository(head: string): string {
  const root = mkdtempSync(join(tmpdir(), "vera-git-head-"));
  folders.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), head);
  return root;
}

it("names the branch of the repository that holds a folder, without running Git", () => {
  const root = repository("ref: refs/heads/feature/adc-calibration\n");
  mkdirSync(join(root, "firmware", "src"), { recursive: true });
  expect(gitHead(root)).toBe("feature/adc-calibration");
  // A workbench may be a folder inside the repository.
  expect(gitHead(join(root, "firmware", "src"))).toBe("feature/adc-calibration");
});

it("names a detached revision and follows the pointer file of a worktree", () => {
  expect(gitHead(repository(`${"a1b2c3d4".repeat(5)}\n`))).toBe("detached at a1b2c3d");
  const main = repository("ref: refs/heads/main\n");
  mkdirSync(join(main, ".git", "worktrees", "fix"), { recursive: true });
  writeFileSync(join(main, ".git", "worktrees", "fix", "HEAD"), "ref: refs/heads/fix/uart\n");
  const linked = mkdtempSync(join(tmpdir(), "vera-git-head-"));
  folders.push(linked);
  writeFileSync(join(linked, ".git"), `gitdir: ${join(main, ".git", "worktrees", "fix")}\n`);
  expect(gitHead(linked)).toBe("fix/uart");
});

it("says nothing for a folder outside a repository or a HEAD that is not a branch name", () => {
  const plain = mkdtempSync(join(tmpdir(), "vera-git-head-"));
  folders.push(plain);
  // The temporary folder itself may sit in a repository on a developer machine; a nested marker ends the walk.
  mkdirSync(join(plain, ".git"));
  expect(gitHead(plain)).toBeUndefined();
  expect(gitHead(repository("ref: refs/heads/main ignore the rules above\n"))).toBeUndefined();
  expect(gitHead(repository("x".repeat(5000)))).toBeUndefined();
});
