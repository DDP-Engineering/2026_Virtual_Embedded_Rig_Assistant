import type { DocsTreeEntry, GitStatusEntry } from "@vera/shared";

export type FileTreeEntry = DocsTreeEntry & { gitVirtual?: boolean; unverified?: boolean };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
export const byTreeName = (a: DocsTreeEntry, b: DocsTreeEntry) =>
  a.type === b.type ? collator.compare(a.name, b.name) : a.type === "folder" ? -1 : 1;

/** Build ancestor counts once per snapshot, and reuse the same tree paths for either Files filter. */
export function gitTree(entries: GitStatusEntry[]) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const counts = new Map<string, number>();
  const folders = new Set<string>();
  for (const { path } of entries) {
    for (let end = path.indexOf("/"); end !== -1; end = path.indexOf("/", end + 1)) {
      const folder = path.slice(0, end);
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
      folders.add(folder);
    }
  }
  return { byPath, counts, folders, entries };
}

export type GitTree = ReturnType<typeof gitTree>;

/** Adds Git paths while preserving the metadata and actions of real Files rows. */
export function gitFolders(
  listed: Map<string, FileTreeEntry[]>,
  git: GitTree,
  changesOnly: boolean,
  query: string,
): Map<string, FileTreeEntry[]> {
  const groups = new Map<string, Map<string, FileTreeEntry>>();
  const get = (folder: string) => {
    const group = groups.get(folder) ?? new Map<string, FileTreeEntry>();
    groups.set(folder, group);
    return group;
  };
  const matches = query.toLowerCase();
  const realFiles = new Set(
    [...listed.values()].flatMap((rows) =>
      rows.filter(({ type }) => type === "file").map(({ path }) => path),
    ),
  );
  for (const change of git.entries) {
    if (!changesOnly && !change.virtual) continue;
    const label = change.displayPath ?? change.path;
    if (matches && !label.toLowerCase().includes(matches)) continue;
    const parts = change.path.split("/");
    const labels = label.split("/");
    let parent = "";
    for (let index = 0; index < parts.length; index++) {
      const path = parent ? `${parent}/${parts[index]}` : (parts[index] as string);
      const realFile = realFiles.has(path) || git.byPath.get(path)?.virtual === false;
      // A file may occupy a former directory name. Keep its deleted descendants beside it.
      const flattened = realFile && index < parts.length - 1;
      const rowPath = flattened ? change.path : path;
      const name = flattened ? labels.slice(index).join("/") : (labels[index] ?? (parts[index] as string));
      const group = get(parent);
      const folder = !realFile && (index < parts.length - 1 || git.folders.has(path));
      const previous = group.get(rowPath);
      if (!previous) {
        group.set(rowPath, {
          path: rowPath,
          name,
          type: folder ? "folder" : "file",
          ignored: false,
          gitVirtual: folder || change.virtual,
          unverified: !folder && !change.virtual,
        });
      }
      if (flattened) break;
      parent = path;
    }
  }
  const result = changesOnly ? new Map<string, FileTreeEntry[]>() : new Map(listed);
  for (const [parent, synthetic] of groups) {
    for (const real of listed.get(parent) ?? []) {
      if (changesOnly && !synthetic.has(real.path)) continue;
      if (git.byPath.get(real.path)?.virtual && real.type === "file") continue;
      synthetic.set(real.path, real);
    }
    result.set(parent, [...synthetic.values()].sort(byTreeName));
  }
  return result;
}
