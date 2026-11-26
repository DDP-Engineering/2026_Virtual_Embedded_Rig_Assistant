import { lstat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import picomatch from "picomatch";
import { glob } from "tinyglobby";
import { type GuardedPath, type PathGuard, validateRelativePath } from "../workbench/path-guard.js";

export function validateGlob(pattern: string): void {
  validateRelativePath(pattern);
  if (pattern.replaceAll("\\", "/").split("/").includes(".."))
    throw Error("Glob must stay inside the workbench.");
}

/** An entry can disappear or lose its directory parent while search is in progress. */
export function entryDisappeared(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** Explicit base paths must exist, even when the search would return no results. */
export async function resolveDiscoveryPath(guard: PathGuard, path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  try {
    const target = await guard.resolve(path);
    const info = await lstat(target.absolute);
    signal.throwIfAborted();
    return { target, info };
  } catch (error) {
    if (entryDisappeared(error))
      throw Error("Search path does not exist. Choose an existing file or directory.");
    throw error;
  }
}

/** Files matching a glob; with `limit`, collection stops there and a result of that length is incomplete. */
export async function discoverFiles(
  guard: PathGuard,
  path: string,
  pattern: string,
  signal: AbortSignal,
  limit = Number.POSITIVE_INFINITY,
) {
  validateGlob(pattern);
  const { target: base, info: own } = await resolveDiscoveryPath(guard, path, signal);
  // A bare name pattern such as *.log means any depth, as in ripgrep and .gitignore.
  const anywhere = /[\\/]/.test(pattern) ? pattern : `**/${pattern}`;
  if (own.isFile()) {
    const name = isAbsolute(base.relative) ? basename(base.relative) : base.relative;
    const negated = anywhere.startsWith("!") && !anywhere.startsWith("!(");
    guard.assertAuthorized();
    if (negated || !picomatch(anywhere, { dot: true, posix: true })(name)) return [];
    return [{ path: base.relative, mtimeMs: own.mtimeMs, size: own.size }];
  }
  if (!own.isDirectory()) throw Error("Search path must be an ordinary file or directory.");
  const paths = await glob(anywhere, {
    cwd: base.absolute,
    signal,
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
  signal.throwIfAborted();
  const files: { path: string; mtimeMs: number; size: number }[] = [];
  for (const item of paths) {
    if (files.length >= limit) break;
    signal.throwIfAborted();
    const relative = base.relative === "." ? item : `${base.relative}/${item}`;
    let target: GuardedPath;
    try {
      target = await guard.resolve(relative);
    } catch {
      continue;
    }
    const info = await lstat(target.absolute).catch((error) => {
      if (entryDisappeared(error)) return undefined;
      throw error;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) continue;
    files.push({ path: target.relative, mtimeMs: info.mtimeMs, size: info.size });
  }
  signal.throwIfAborted();
  guard.assertAuthorized();
  return files;
}
