import { lstat } from "node:fs/promises";
import { PathGuard } from "@vera/core";
import { opensExternally, veraError } from "@vera/shared";

/** An ordinary, non-link workbench file other than the root, re-resolved before it is used. */
async function guardedFile(root: string, path: string): Promise<string> {
  let absolute: string;
  let key: string;
  try {
    const target = await (await PathGuard.create(root)).resolve(path);
    if (target.relative === "." || target.relative === "") throw Error("Choose a file.");
    absolute = target.absolute;
    key = target.key;
  } catch {
    throw veraError("DENIED");
  }
  try {
    const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw veraError("DENIED");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw veraError("NOT_FOUND");
    throw error;
  }
  try {
    const current = await (await PathGuard.create(root)).resolve(path);
    if (current.key !== key) throw Error("Target changed before use.");
  } catch {
    throw veraError("DENIED");
  }
  return absolute;
}

export async function revealPath(
  root: string,
  path: string,
  show: (path: string) => void,
): Promise<Record<string, never>> {
  show(await guardedFile(root, path));
  return {};
}

/**
 * Opens a workbench document with the default application. The allowlist is checked before the
 * filesystem is touched, because the OS would run a script or program it is asked to open.
 */
export async function openPath(
  root: string,
  path: string,
  open: (path: string) => Promise<string>,
): Promise<Record<string, never>> {
  if (!opensExternally(path)) throw veraError("DENIED");
  // The guard returns the realpath: a link or short name may resolve to a script, so the file the
  // OS would open must itself be an allowlisted document.
  const absolute = await guardedFile(root, path);
  if (!opensExternally(absolute)) throw veraError("DENIED");
  // The OS reports a failure (such as no associated application) as a non-empty message.
  if (await open(absolute)) throw veraError("INTERNAL");
  return {};
}
