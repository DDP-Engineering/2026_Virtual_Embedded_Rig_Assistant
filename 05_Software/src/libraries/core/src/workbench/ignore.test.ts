// REQ-FUNC-eade110e REQ-FUNC-2336bfd2
import { expect, it } from "vitest";
import { createGitignoreRules, createIgnoreRules } from "./ignore.js";

/** A policy over in-memory .gitignore files keyed by their folder ("" is the root). */
function policy(veraignore: string, gitignores?: Record<string, string>) {
  return createIgnoreRules(veraignore, gitignores && createGitignoreRules((folder) => gitignores[folder]));
}

it("applies the root and nested .gitignore files as Git does", () => {
  const ignored = policy("", {
    "": ".venv/\nhtmlcov/\nbuild/html/\n*.log\n",
    docs: "gen.md\n!keep.log\n",
  });
  expect(ignored(".venv/")).toBe(true);
  expect(ignored(".venv/lib/readme.md")).toBe(true);
  expect(ignored("htmlcov/index.html")).toBe(true);
  expect(ignored("build/html/index.html")).toBe(true);
  expect(ignored("build/manual.pdf")).toBe(false);
  expect(ignored("run.log")).toBe(true);
  // A nested file applies only below its own folder, and its negation outranks the root file.
  expect(ignored("docs/gen.md")).toBe(true);
  expect(ignored("docs/sub/gen.md")).toBe(true);
  expect(ignored("gen.md")).toBe(false);
  expect(ignored("other/gen.md")).toBe(false);
  expect(ignored("docs/keep.log")).toBe(false);
});

it("never enters a folder .gitignore excludes, whatever the files below it say", () => {
  const ignored = policy("", { "": "out/\n!out/keep.md\n", out: "!*\n" });
  expect(ignored("out/")).toBe(true);
  expect(ignored("out/keep.md")).toBe(true);
});

it("ignores nothing more than .veraignore and the permanent folders when .gitignore is off", () => {
  const ignored = policy("drafts/\n");
  expect(ignored(".venv/lib/readme.md")).toBe(false);
  expect(ignored("drafts/a.md")).toBe(true);
  expect(ignored(".git/notes.md")).toBe(true);
});

it("decides the permanent rules first, then .veraignore with its negations, then .gitignore", () => {
  const ignored = policy("!docs/gen.md\n!build/\ndrafts/\n", {
    "": "docs/gen.md\nbuild/\n!drafts/\n!.git/\n!node_modules/\n!.vera/\n",
  });
  expect(ignored("docs/gen.md")).toBe(false);
  expect(ignored("build/")).toBe(false);
  expect(ignored("build/html/index.html")).toBe(false);
  expect(ignored("drafts/a.md")).toBe(true);
  expect(ignored(".git/notes.md")).toBe(true);
  expect(ignored("node_modules/pkg/readme.md")).toBe(true);
  expect(ignored(".vera/notes.md")).toBe(true);
});

it("keeps .gitignore rules below a folder that .veraignore re-includes but .gitignore never dropped", () => {
  const ignored = policy("*\n!*/\n!*.md\n", { "": "*.tmp.md\n", docs: "gen/\n" });
  expect(ignored("docs/a.md")).toBe(false);
  expect(ignored("docs/a.tmp.md")).toBe(false);
  expect(ignored("docs/notes.txt")).toBe(true);
  const kept = policy("!docs/\n", { "": "*.tmp\n", docs: "gen/\n" });
  expect(kept("docs/a.tmp")).toBe(true);
  expect(kept("docs/gen/b.md")).toBe(true);
});
