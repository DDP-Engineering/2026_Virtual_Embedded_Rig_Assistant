import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HelpLibrary } from "./library.js";

let root: string;
let outside: string;
beforeEach(async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vera-help-"));
  root = join(temporary, "help");
  outside = join(temporary, "outside");
  const pages: Record<string, string> = {
    "en/index.md": "# VERA help\n\n- [Shortcuts](shortcuts.md)\n- [Permissions](permissions.md#modes)\n",
    "en/permissions.md": "# Permissions\n\nRead-only, Ask.\n",
    "en/shortcuts.md": "# Keyboard shortcuts\n",
    "en/about-files.md": "No heading here.\n",
    "en/workbenches.md": "# Workbenches\n",
    "de/index.md": "# VERA-Hilfe\n\n[Kürzel](shortcuts.md) [Berechtigungen](permissions.md)\n",
    "de/permissions.md": "# Berechtigungen\n",
    "de/shortcuts.md": "# Tastenkürzel\n",
    "de/only-german.md": "# Nur Deutsch\n",
    "fr/permissions.md": "# Autorisations\n\nLecture seule.\n",
  };
  for (const [path, text] of Object.entries(pages)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "secret.md"), "# Secret\n");
  await symlink(outside, join(root, "ro"), process.platform === "win32" ? "junction" : "dir");
});
afterEach(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

it("lists pages in the language, English gaps filled, ordered by the index links (REQ-FUNC-2e84bc58)", async () => {
  expect(await new HelpLibrary(root).list("de")).toEqual([
    { page: "index", title: "VERA-Hilfe", language: "de" },
    { page: "shortcuts", title: "Tastenkürzel", language: "de" },
    { page: "permissions", title: "Berechtigungen", language: "de" },
    { page: "about-files", title: "about-files", language: "en" },
    { page: "only-german", title: "Nur Deutsch", language: "de" },
    { page: "workbenches", title: "Workbenches", language: "en" },
  ]);
});

it("reads a page in its language, else the English page (REQ-FUNC-a2db3ddc)", async () => {
  const help = new HelpLibrary(root);
  expect(await help.read("permissions", "fr")).toEqual({
    page: "permissions",
    title: "Autorisations",
    language: "fr",
    content: "# Autorisations\n\nLecture seule.\n",
  });
  expect(await help.read("shortcuts", "fr")).toMatchObject({ title: "Keyboard shortcuts", language: "en" });
});

it("fails NOT_FOUND for a page in neither the language nor English (REQ-REL-e038060c)", async () => {
  const help = new HelpLibrary(root);
  await expect(help.read("only-german", "fr")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(help.read("missing", "en")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("never reads a file that resolves outside the help root (REQ-SEC-8e27b5ca)", async () => {
  const help = new HelpLibrary(root);
  await expect(help.read("secret", "ro")).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await help.list("ro")).map((page) => page.page)).not.toContain("secret");
  await expect(help.read("../outside/secret" as string, "en")).rejects.toMatchObject({ code: "INVALID" });
});
