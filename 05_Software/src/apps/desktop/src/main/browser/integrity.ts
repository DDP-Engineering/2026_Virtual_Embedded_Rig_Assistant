import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { BrowserError } from "./failure.js";
import type { BrowserRelease } from "./release.js";

// Both current platform archives contain fewer than 320 entries and expand to under 460 MB.
export const browserTreeLimits = { bytes: 600 * 1024 ** 2, entries: 1024 };

export function fileMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Hash file names, lengths and content in canonical path order. Links and special files are invalid. */
export async function verifyBrowserTree(
  root: string,
  release: BrowserRelease,
  signal: AbortSignal,
): Promise<string> {
  const files = new Map<string, { bytes: number; sha256: string }>();
  let entries = 0;
  let bytes = 0;
  const walk = async (relative: string): Promise<void> => {
    signal.throwIfAborted();
    const path = join(root, relative);
    const info = await lstat(path);
    if (++entries > browserTreeLimits.entries) throw new BrowserError("integrity");
    if (info.isDirectory()) {
      for (const name of await readdir(path, { encoding: "utf8" })) {
        await walk(relative ? `${relative}/${name}` : name);
      }
      return;
    }
    bytes += info.size;
    if (!relative || !info.isFile() || bytes > browserTreeLimits.bytes) throw new BrowserError("integrity");
    const hash = createHash("sha256");
    let read = 0;
    for await (const chunk of createReadStream(path, { signal })) {
      read += chunk.length;
      if (read > info.size) throw new BrowserError("integrity");
      hash.update(chunk);
    }
    if (read !== info.size) throw new BrowserError("integrity");
    files.set(relative, { bytes: read, sha256: hash.digest("hex") });
  };

  signal.throwIfAborted();
  try {
    if (!(await lstat(root)).isDirectory()) throw new BrowserError("integrity");
  } catch (error) {
    if (fileMissing(error)) throw new BrowserError("runtime-missing");
    throw error;
  }
  try {
    await walk("");
    const tree = createHash("sha256");
    for (const name of Array.from(files.keys()).sort()) {
      const entry = files.get(name);
      if (entry) tree.update(`${name}\0${entry.bytes}\0${entry.sha256}\n`);
    }
    if (!files.has(release.executable) || tree.digest("hex") !== release.treeSha256)
      throw new BrowserError("integrity");
    for (const name of release.executables) await access(join(root, name), constants.X_OK);
    return join(root, release.executable);
  } catch (error) {
    signal.throwIfAborted();
    throw new BrowserError("integrity", { cause: error });
  }
}
