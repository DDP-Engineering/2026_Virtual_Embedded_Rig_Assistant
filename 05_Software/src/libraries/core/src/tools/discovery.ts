import { lstat } from "node:fs/promises";
import { glob } from "tinyglobby";
import { type GuardedPath, type PathGuard, validateRelativePath } from "../workbench/path-guard.js";

export function validateGlob(pattern: string): void {
  validateRelativePath(pattern);
  if (pattern.replaceAll("\\", "/").split("/").includes(".."))
    throw Error("Glob must stay inside the workbench.");
}

export async function discoverFiles(guard: PathGuard, path: string, pattern: string, signal: AbortSignal) {
  validateGlob(pattern);
  const base = await guard.resolve(path);
  const paths = await glob(pattern, {
    cwd: base.absolute,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore:
      guard.scope === "filesystem"
        ? []
        : [
            "**/.vera/**",
            "**/.git/**",
            "**/node_modules/**",
            "**/.VERA/**",
            "**/.GIT/**",
            "**/NODE_MODULES/**",
          ],
  });
  const files: { path: string; mtimeMs: number; size: number }[] = [];
  for (const item of paths) {
    signal.throwIfAborted();
    const relative = base.relative === "." ? item : `${base.relative}/${item}`;
    let target: GuardedPath;
    try {
      target = await guard.resolve(relative);
    } catch {
      continue;
    }
    const info = await lstat(target.absolute);
    if (!info.isFile() || info.isSymbolicLink()) continue;
    files.push({ path: target.relative, mtimeMs: info.mtimeMs, size: info.size });
  }
  return files;
}
