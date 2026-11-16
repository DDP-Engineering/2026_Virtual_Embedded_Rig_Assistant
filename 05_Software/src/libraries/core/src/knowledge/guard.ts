import type { DocumentGuard } from "@vera/shared";

/**
 * The number of selected documents a workbench indexes without stopping: docs.maxFiles, or 120 %
 * of the count approved with "Index anyway" when that is larger (TASK-4321c06b). The margin lets a
 * selection grow a little after an approval; a much larger one stops again.
 */
export function fileLimit(maxFiles: number, approved: number | null): number {
  // Integer arithmetic: 12,000 x 1.2 must be exactly 14,400.
  return approved === null ? maxFiles : Math.max(maxFiles, Math.floor((approved * 6) / 5));
}

/**
 * The ten folders holding the most of the selected paths, files in subfolders included, largest
 * first and then by path. The workbench root is not a folder here, and a folder whose parent holds
 * the same number is left out, so a chain such as .venv/lib/site is listed once, as .venv.
 */
export function topFolders(paths: readonly string[]): DocumentGuard["folders"] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let n = 1; n < parts.length; n++) {
      const folder = parts.slice(0, n).join("/");
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  const parent = (folder: string) => folder.slice(0, Math.max(0, folder.lastIndexOf("/")));
  return [...counts]
    .filter(([folder, files]) => counts.get(parent(folder)) !== files)
    .map(([path, files]) => ({ path, files }))
    .sort((a, b) => b.files - a.files || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, 10);
}

/** The guard for a selection: null when it indexes, otherwise its count, limit and top folders. */
export function documentGuard(
  paths: readonly string[],
  maxFiles: number,
  approved: number | null,
): DocumentGuard | null {
  const limit = fileLimit(maxFiles, approved);
  return paths.length > limit ? { files: paths.length, limit, folders: topFolders(paths) } : null;
}
