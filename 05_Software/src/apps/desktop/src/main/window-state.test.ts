import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

let state: typeof import("./window-state.js");
const folders: string[] = [];
const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
const bounds = { x: 50, y: 60, width: 1100, height: 700 };

beforeAll(async () => {
  expect(
    existsSync(join(dirname(fileURLToPath(import.meta.url)), "window-state.ts")),
    "window state service",
  ).toBe(true);
  state = await import("./window-state.js");
});

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function file(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "vera-window-state-"));
  folders.push(folder);
  return join(folder, "window-state.json");
}

describe("window geometry storage", () => {
  it("persists versioned bounds and restores them", async () => {
    const path = await file();
    await state.saveWindowState(path, bounds);
    expect(await state.loadWindowState(path, displays)).toEqual({ bounds });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1, bounds });
  });

  it.each([
    "{broken",
    JSON.stringify({ schemaVersion: 1, bounds: { ...bounds, width: 10 } }),
    JSON.stringify({ schemaVersion: 1, bounds: { ...bounds, x: 9000 } }),
    JSON.stringify({ schemaVersion: 1, bounds: { ...bounds, y: null } }),
    // Version 1 is the only window-state format during development (AGENTS.md).
    JSON.stringify({ schemaVersion: 2, bounds }),
  ])("falls back to visible minimum bounds for invalid state %s", async (contents) => {
    const path = await file();
    await writeFile(path, contents);
    expect(await state.loadWindowState(path, displays)).toEqual({
      bounds: { width: 1200, height: 800 },
    });
  });

  it("uses defaults for missing state", async () => {
    expect((await state.loadWindowState(await file(), displays)).bounds).toEqual({
      width: 1200,
      height: 800,
    });
  });

  it("accepts bounds on a monitor left of the primary display", async () => {
    const path = await file();
    const left = { ...bounds, x: -1200 };
    await state.saveWindowState(path, left);
    expect(
      (await state.loadWindowState(path, [{ x: -1920, y: 0, width: 1920, height: 1080 }])).bounds,
    ).toEqual(left);
  });
});
