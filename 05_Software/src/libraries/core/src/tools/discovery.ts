import { lstat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import picomatch from "picomatch";
import { glob } from "tinyglobby";
import { permanentIgnoreDirectories } from "../workbench/ignore.js";
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

/** Enumerate candidate names first so searches can inspect only the files they visit. */
export async function discoverFilePaths(
  guard: PathGuard,
  path: string,
  pattern: string,
  signal: AbortSignal,
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
    return [base.relative];
  }
  if (!own.isDirectory()) throw Error("Search path must be an ordinary file or directory.");
  // Runtime, VCS and dependency folders are not walked by a search of everything. In Bypass they stay
  // reachable when asked for, as the search path or by name in the pattern; walked by default they held
  // the whole result (they sort before the sources) and the whole deadline.
  const named = anywhere.toLowerCase().split(/[\\/]/);
  const skipped = permanentIgnoreDirectories.filter(
    (folder) => guard.scope !== "filesystem" || !named.includes(folder),
  );
  const paths = await glob(anywhere, {
    cwd: base.absolute,
    signal,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: skipped.flatMap((folder) => [`**/${folder}/**`, `**/${folder.toUpperCase()}/**`]),
  });
  signal.throwIfAborted();
  guard.assertAuthorized();
  return base.relative === "." ? paths : paths.map((item) => `${base.relative}/${item}`);
}

/** Inspect the actual entry before reporting it or attempting to read it. */
export async function inspectDiscoveredFile(guard: PathGuard, path: string, signal: AbortSignal) {
  signal.throwIfAborted();
  let target: GuardedPath;
  try {
    target = await guard.resolve(path);
  } catch {
    return undefined;
  }
  const info = await lstat(target.absolute).catch((error) => {
    if (entryDisappeared(error)) return undefined;
    throw error;
  });
  if (!info?.isFile()) return undefined;
  return { path: target.relative, absolute: target.absolute, mtimeMs: info.mtimeMs, size: info.size };
}

/** Validate candidates in small batches while preserving the examined-file limit and order. */
export async function discoverFiles(
  guard: PathGuard,
  path: string,
  pattern: string,
  signal: AbortSignal,
  limit = Number.POSITIVE_INFINITY,
) {
  const paths = await discoverFilePaths(guard, path, pattern, signal);
  const files: { path: string; mtimeMs: number; size: number }[] = [];
  for (let start = 0; start < paths.length && files.length < limit; ) {
    const batch = paths.slice(start, start + Math.min(16, limit - files.length));
    const inspected = await Promise.all(batch.map((item) => inspectDiscoveredFile(guard, item, signal)));
    for (const file of inspected) if (file) files.push(file);
    start += batch.length;
  }
  signal.throwIfAborted();
  guard.assertAuthorized();
  return files;
}
