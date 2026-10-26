import { lstat } from "node:fs/promises";
import { PathGuard } from "@vera/core";
import { veraError } from "@vera/shared";

export async function revealPath(
  root: string,
  path: string,
  show: (path: string) => void,
): Promise<Record<string, never>> {
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
    if (current.key !== key) throw Error("Target changed before reveal.");
  } catch {
    throw veraError("DENIED");
  }
  show(absolute);
  return {};
}
