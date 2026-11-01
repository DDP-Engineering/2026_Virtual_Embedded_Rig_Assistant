// REQ-SEC-18000005
import { lstat, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathGuard } from "@vera/core";
import { expect, test, vi } from "vitest";
import { openPath, revealPath } from "./reveal-path.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

test("reveals an existing ordinary Unicode workbench file and refuses missing/outside/ignored/redirected paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-reveal-"));
  const outside = await mkdtemp(join(tmpdir(), "vera-outside-"));
  try {
    await writeFile(join(root, "board ă.txt"), "board");
    await mkdir(join(root, ".vera"));
    await writeFile(join(root, ".vera/.veraignore"), "hidden.txt\n");
    await writeFile(join(root, "hidden.txt"), "hidden");
    await writeFile(join(root, ".vera", "private.txt"), "private");
    await writeFile(join(outside, "outside.txt"), "outside");
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    const show = vi.fn();
    await expect(revealPath(root, "board ă.txt", show)).resolves.toEqual({});
    expect(show).toHaveBeenCalledExactlyOnceWith(join(root, "board ă.txt"));
    show.mockClear();
    await expect(revealPath(root, "missing.txt", show)).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const path of [
      "../outside.txt",
      join(outside, "outside.txt"),
      "hidden.txt",
      ".vera/private.txt",
      "escape/outside.txt",
      ".",
      "C:\\outside.txt",
    ])
      await expect(revealPath(root, path, show)).rejects.toMatchObject({ code: "DENIED" });
    expect(show).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("refuses a parent redirected outside after the ordinary file check", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-reveal-race-"));
  const outside = await mkdtemp(join(tmpdir(), "vera-reveal-race-outside-"));
  const parent = join(root, "board");
  const target = join(parent, "settings.txt");
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let targetChecks = 0;
  try {
    await mkdir(parent);
    await writeFile(target, "inside");
    await writeFile(join(outside, "settings.txt"), "outside");
    vi.mocked(lstat).mockImplementation(async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args);
      if (args[0] === target && ++targetChecks === 2) {
        await rename(parent, join(root, "original-board"));
        await symlink(outside, parent, process.platform === "win32" ? "junction" : "dir");
      }
      return info;
    });
    const show = vi.fn();
    await expect(revealPath(root, "board/settings.txt", show)).rejects.toMatchObject({ code: "DENIED" });
    expect(targetChecks).toBeGreaterThanOrEqual(2);
    expect(show).not.toHaveBeenCalled();
  } finally {
    vi.mocked(lstat).mockImplementation(actual.lstat);
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// REQ-FUNC-d37a2092 REQ-SEC-33b98d33 REQ-REL-85ae1f66
test("opens allowlisted workbench documents and refuses everything else before the opener runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-open-"));
  const outside = await mkdtemp(join(tmpdir(), "vera-open-outside-"));
  try {
    await mkdir(join(root, ".vera"));
    await mkdir(join(root, "docs/folder.pdf"), { recursive: true });
    for (const name of [
      "a.PDF",
      "pinout.xlsx",
      "run.bat",
      "tool.js",
      "flash.py",
      "app.exe",
      "page.html",
      "schematic.png",
      "README",
    ])
      await writeFile(join(root, "docs", name), "x");
    await writeFile(join(root, ".vera/notes.pdf"), "x");
    await writeFile(join(outside, "outside.pdf"), "x");
    await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    const open = vi.fn(async (_path: string) => "");
    for (const path of ["docs/a.PDF", "docs/pinout.xlsx"])
      await expect(openPath(root, path, open)).resolves.toEqual({});
    expect(open.mock.calls).toEqual([[join(root, "docs", "a.PDF")], [join(root, "docs", "pinout.xlsx")]]);
    open.mockClear();
    for (const path of [
      "docs/run.bat",
      "docs/tool.js",
      "docs/flash.py",
      "docs/app.exe",
      "docs/page.html",
      "docs/schematic.png",
      "docs/README",
      "../outside.pdf",
      join(outside, "outside.pdf"),
      "linked/outside.pdf",
      ".vera/notes.pdf",
      "docs/folder.pdf",
      ".",
      "C:\\outside.pdf",
    ])
      await expect(openPath(root, path, open), path).rejects.toMatchObject({ code: "DENIED" });
    await expect(openPath(root, "docs/none.pdf", open)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(open).not.toHaveBeenCalled();
    await expect(
      openPath(root, "docs/a.PDF", async () => "No application is associated"),
    ).rejects.toMatchObject({
      code: "INTERNAL",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// REQ-SEC-33b98d33
test("refuses an allowlisted file link whose target is not a document", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vera-open-link-"));
  try {
    await mkdir(join(root, ".vera"));
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "run.bat"), "echo pwned");
    try {
      await symlink(join(root, "docs", "run.bat"), join(root, "docs", "readme.pdf"), "file");
    } catch {
      context.skip(); // File links need Developer Mode or elevation on Windows.
    }
    const open = vi.fn(async (_path: string) => "");
    await expect(openPath(root, "docs/readme.pdf", open)).rejects.toMatchObject({ code: "DENIED" });
    expect(open).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// REQ-SEC-33b98d33
test("checks the allowlist again on the resolved file, which a link or short name may redirect", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-open-resolved-"));
  const real = PathGuard.prototype.resolve;
  // PathGuard returns the realpath: a link named docs/readme.pdf resolves to the script it targets.
  const resolve = vi.spyOn(PathGuard.prototype, "resolve").mockImplementation(async function (
    this: PathGuard,
    path: string,
  ) {
    return {
      ...(await real.call(this, path === "docs/readme.pdf" ? "tools/run.bat" : path)),
      relative: path,
    };
  });
  try {
    await mkdir(join(root, ".vera"));
    await mkdir(join(root, "tools"));
    await writeFile(join(root, "tools", "run.bat"), "echo pwned");
    const open = vi.fn(async (_path: string) => "");
    await expect(openPath(root, "docs/readme.pdf", open)).rejects.toMatchObject({ code: "DENIED" });
    expect(open).not.toHaveBeenCalled();
  } finally {
    resolve.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
