import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Pick<Bounds, "width" | "height"> & Partial<Pick<Bounds, "x" | "y">>;
}

function validBounds(value: unknown): value is Bounds {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Record<string, unknown>;
  return (
    ["x", "y", "width", "height"].every((key) => Number.isSafeInteger(bounds[key])) &&
    typeof bounds.width === "number" &&
    bounds.width >= 1024 &&
    bounds.width <= 32768 &&
    typeof bounds.height === "number" &&
    bounds.height >= 640 &&
    bounds.height <= 32768
  );
}

function visible(bounds: Bounds, displays: Bounds[]): boolean {
  return displays.some(
    (display) =>
      Math.min(bounds.x + bounds.width, display.x + display.width) - Math.max(bounds.x, display.x) >= 100 &&
      Math.min(bounds.y + bounds.height, display.y + display.height) - Math.max(bounds.y, display.y) >= 100,
  );
}

export async function loadWindowState(path: string, displays: Bounds[]): Promise<WindowState> {
  const defaults: WindowState = {
    bounds: {
      width: Math.max(1024, Math.min(1200, displays[0]?.width ?? 1200)),
      height: Math.max(640, Math.min(800, displays[0]?.height ?? 800)),
    },
  };
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object") return defaults;
    const data = value as Record<string, unknown>;
    // The window-state format stays at version 1 during development (AGENTS.md).
    if (data.schemaVersion === 1 && validBounds(data.bounds) && visible(data.bounds, displays)) {
      return { bounds: data.bounds };
    }
  } catch {
    // Missing, corrupt, unreadable or other-format state uses centered defaults.
  }
  return defaults;
}

export async function saveWindowState(path: string, bounds: Bounds): Promise<void> {
  if (!validBounds(bounds)) throw new Error("Invalid window bounds");
  const temporary = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, bounds }), "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
