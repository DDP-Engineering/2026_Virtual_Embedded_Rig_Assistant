import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DOCS_BYTE_CONTEXT_LIMIT, docsByteWindowSchema, veraError, veraErrorSchema } from "@vera/shared";
import { locateEntry } from "./tree.js";

/** Raw host-only bytes include matching context; never transport this object to the renderer. */
export interface ByteReadSource {
  path: string;
  offset: number;
  size: number;
  start: number;
  bytes: Buffer;
}
const identity = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
const sameFile = (a: Stats, b: Stats) =>
  b.isFile() &&
  !b.isSymbolicLink() &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

/** Bounded positional bytes of an ordinary workbench file, with fixed secret-matching context. */
export async function readBytes(
  root: string,
  path: string,
  offset: number,
  length: number,
): Promise<ByteReadSource> {
  if (!docsByteWindowSchema.safeParse({ path: path || "_", offset, length }).success)
    throw veraError("INVALID");
  let validated = false;
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw veraError("DENIED");
    const located = await locateEntry(root, path);
    if (located.type !== "file") throw veraError("DENIED");
    const canonicalRoot = await realpath(root);
    if (identity(canonicalRoot) !== identity(resolve(root))) throw veraError("DENIED");
    const absolute = join(canonicalRoot, path);
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw veraError("DENIED");
    if (!Number.isSafeInteger(info.size) || info.size < 0) throw veraError("INVALID");
    validated = true;
    const checkPath = async () => {
      const currentRoot = await lstat(root);
      const current = await locateEntry(root, path);
      if (
        !currentRoot.isDirectory() ||
        currentRoot.isSymbolicLink() ||
        currentRoot.ino !== rootInfo.ino ||
        currentRoot.dev !== rootInfo.dev ||
        current.type !== "file" ||
        identity(await realpath(root)) !== identity(canonicalRoot) ||
        identity(await realpath(current.absolute)) !== identity(resolve(absolute)) ||
        !sameFile(info, await lstat(current.absolute))
      )
        throw veraError("CONFLICT");
    };
    await checkPath();
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(
        absolute,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      );
    } catch (error) {
      await checkPath();
      throw error;
    }
    try {
      if (!sameFile(info, await handle.stat())) throw veraError("CONFLICT");
      await checkPath();
      const count = Math.min(length, Math.max(0, info.size - offset));
      const start = count ? Math.max(0, offset - DOCS_BYTE_CONTEXT_LIMIT) : offset;
      const end = count
        ? offset + count + Math.min(DOCS_BYTE_CONTEXT_LIMIT, info.size - offset - count)
        : offset;
      const bytes = Buffer.alloc(end - start);
      let filled = 0;
      while (filled < bytes.length) {
        const { bytesRead } = await handle.read({
          buffer: bytes,
          offset: filled,
          length: bytes.length - filled,
          position: start + filled,
        });
        if (!bytesRead) throw veraError("CONFLICT");
        filled += bytesRead;
      }
      if (!sameFile(info, await handle.stat())) throw veraError("CONFLICT");
      await checkPath();
      return { path, offset, size: info.size, start, bytes };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const known = veraErrorSchema.safeParse(error);
    if (known.success) throw validated && known.data.code === "DENIED" ? veraError("CONFLICT") : known.data;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") throw veraError("NOT_FOUND");
    if (code === "ELOOP") throw veraError("CONFLICT");
    if (code === "EACCES" || code === "EPERM") throw veraError("DENIED");
    throw veraError("INTERNAL");
  }
}
