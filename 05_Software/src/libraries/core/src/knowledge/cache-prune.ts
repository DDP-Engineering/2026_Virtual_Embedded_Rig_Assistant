import { lstat, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * Removes the extraction cache files (`.vera/cache/extract/<sha256>.json`) whose hash is not in
 * `keep`. A redirected cache folder is left alone and no other file name is touched; a file that
 * cannot be removed stays for the next run.
 */
export async function pruneExtractionCache(root: string, keep: ReadonlySet<string>): Promise<void> {
  let directory = root;
  for (const segment of [".vera", "cache", "extract"]) {
    directory = join(directory, segment);
    const info = await lstat(directory).catch(() => undefined);
    if (!info?.isDirectory() || info.isSymbolicLink()) return;
  }
  for (const name of await readdir(directory)) {
    const hash = /^([a-f0-9]{64})\.json$/.exec(name)?.[1];
    if (hash && !keep.has(hash)) await unlink(join(directory, name)).catch(() => {});
  }
}
