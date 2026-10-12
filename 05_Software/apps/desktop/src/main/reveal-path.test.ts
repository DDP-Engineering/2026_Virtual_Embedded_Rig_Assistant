// REQ-SEC-18000005
import { lstat, mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { revealPath } from "./reveal-path.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat) };
});

test("reveals an existing ordinary Unicode workbench file and refuses missing/outside/ignored/redirected paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-reveal-"));
  const outside = await mkdtemp(join(tmpdir(), "vera-outside-"));
  try {
    await writeFile(join(root, "board ă.txt"), "board");
    await writeFile(join(root, ".veraignore"), "hidden.txt\n");
    await writeFile(join(root, "hidden.txt"), "hidden");
    await mkdir(join(root, ".vera"));
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
