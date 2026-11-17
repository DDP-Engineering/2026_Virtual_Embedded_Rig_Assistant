import { lstat, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { veraError, veraErrorSchema } from "@vera/shared";

const missing = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

/** Sums ordinary file lengths inside .vera without following links or reading file contents. */
export async function workbenchStorageBytes(folder: string, check: () => void): Promise<number> {
  const root = join(folder, ".vera");
  try {
    check();
    const initial = await lstat(root);
    if (!initial.isDirectory() || initial.isSymbolicLink()) throw veraError("DENIED");
    const canonical = await realpath(root);
    const pending = [root];
    let bytes = 0;
    while (pending.length) {
      check();
      const directory = pending.pop() as string;
      try {
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) continue;
        const path = relative(canonical, await realpath(directory));
        if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw veraError("DENIED");
        for await (const entry of await opendir(directory)) {
          check();
          if (entry.isSymbolicLink()) continue;
          const child = join(directory, entry.name);
          try {
            const stat = await lstat(child);
            if (stat.isSymbolicLink()) continue;
            if (stat.isDirectory()) pending.push(child);
            else if (stat.isFile()) bytes += stat.size;
          } catch (error) {
            if (!missing(error)) throw error;
          }
        }
      } catch (error) {
        // Temporary files and cache folders may disappear during normal indexing.
        if (!missing(error)) throw error;
      }
    }
    check();
    const final = await lstat(root);
    if (
      !final.isDirectory() ||
      final.isSymbolicLink() ||
      final.ino !== initial.ino ||
      final.dev !== initial.dev
    )
      throw veraError("CONFLICT");
    if (!Number.isSafeInteger(bytes)) throw veraError("INVALID");
    return bytes;
  } catch (error) {
    if (missing(error)) throw veraError("NOT_FOUND");
    if (["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw veraError("DENIED");
    const known = veraErrorSchema.safeParse(error);
    throw known.success ? known.data : veraError("INTERNAL");
  }
}
