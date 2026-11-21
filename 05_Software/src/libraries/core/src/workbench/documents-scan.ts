import { lstat, opendir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  type DocumentKind,
  type DocumentPreview,
  type DocumentScan,
  type DocumentScanKind,
  veraError,
  type WorkbenchConfig,
} from "@vera/shared";
import picomatch from "picomatch";
import { documentGuard } from "../knowledge/guard.js";
import { documentKind, documentSelection } from "../knowledge/ingest.js";
import { isOfficeOwnerFile } from "../knowledge/office-format.js";
import { selectDocuments } from "../knowledge/selection.js";

export interface ScanBounds {
  maxEntries?: number;
  maxDepth?: number;
}
const officeExtensions = new Set([
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
]);
/** Kinds that mark a folder as documentation; source code and data files do not. */
function scanKind(path: string): DocumentScanKind | undefined {
  const ext = extname(path).toLowerCase();
  if (officeExtensions.has(ext)) return isOfficeOwnerFile(path) ? undefined : "office";
  if (ext === ".txt") return "text";
  const kind = documentKind(path);
  return kind === "pdf" || kind === "markdown" || kind === "html" ? kind : undefined;
}
/** Legacy binary Office formats and RTF are recognised as documentation but not extracted. */
const isPendingOffice = (path: string, kind: DocumentKind) =>
  kind === "other" && officeExtensions.has(extname(path).toLowerCase()) && !isOfficeOwnerFile(path);
const skippable = (error: unknown) =>
  ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "");

/**
 * Bounded breadth-first walk of ordinary files below root, for the documentation-folder scan. Never follows links, never enters
 * ignored paths and skips unreadable or vanished entries; reports an incomplete walk as truncated.
 * `visit` returns a size request only for files it needs sized, so most files cost no lstat.
 */
async function walk(
  root: string,
  ignored: (path: string) => boolean,
  visit: (path: string) => ((bytes: number) => void) | undefined,
  { maxEntries = 20000, maxDepth = 8 }: ScanBounds = {},
): Promise<boolean> {
  const queue: { path: string; depth: number }[] = [{ path: "", depth: 0 }];
  let entries = 0;
  let truncated = false;
  while (queue.length) {
    const folder = queue.shift() as { path: string; depth: number };
    try {
      // Returning from for-await closes the directory handle.
      for await (const entry of await opendir(join(root, folder.path))) {
        if (++entries > maxEntries) return true;
        const path = folder.path ? `${folder.path}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (ignored(path) || ignored(`${path}/`)) continue;
          if (folder.depth + 1 > maxDepth) truncated = true;
          else queue.push({ path, depth: folder.depth + 1 });
        } else if (entry.isFile() && !ignored(path)) {
          const sized = visit(path);
          if (!sized) continue;
          try {
            sized((await lstat(join(root, path))).size);
          } catch (error) {
            if (!skippable(error)) throw error;
            truncated = true;
          }
        }
      }
    } catch (error) {
      if (!skippable(error)) throw error;
      truncated = true;
    }
  }
  return truncated;
}

/** Groups documentation files by their first-level folder of a chosen workbench folder. */
export async function scanDocuments(
  root: string,
  ignored: (path: string) => boolean,
  bounds?: ScanBounds,
): Promise<DocumentScan> {
  const folders = new Map<string, { bytes: number; kinds: Partial<Record<DocumentScanKind, number>> }>();
  const truncated = await walk(
    root,
    ignored,
    (path) => {
      const slash = path.indexOf("/");
      const kind = scanKind(path);
      if (slash < 0 || !kind) return undefined;
      return (bytes) => {
        const name = path.slice(0, slash);
        const folder = folders.get(name) ?? { bytes: 0, kinds: {} };
        folder.bytes += bytes;
        folder.kinds[kind] = (folder.kinds[kind] ?? 0) + 1;
        folders.set(name, folder);
      };
    },
    bounds,
  );
  return {
    folders: [...folders]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, value]) => ({ path, ...value })),
    truncated,
  };
}

/** The preview's only bound: past it the count stops and is reported as a lower bound. */
export const PREVIEW_TIME_LIMIT_MS = 5000;
export interface PreviewOptions {
  /** Stops the count early; the service passes a timeout of PREVIEW_TIME_LIMIT_MS. */
  signal?: AbortSignal;
  /** The workbench's "Index anyway" approval, which raises its file limit as in indexing. */
  approved?: number | null;
}

/**
 * Counts what indexing would admit for a selection by running the indexer's own document
 * selection, so the count, the size limits and the count guard match indexing (TASK-ef5fef5b).
 * Legacy Office and RTF files that the selection matches but cannot index are counted apart.
 */
export async function previewDocuments(
  root: string,
  docs: Pick<WorkbenchConfig["docs"], "include" | "exclude" | "gitignore" | "maxFileMB" | "maxFiles"> & {
    maxTextMB?: number;
  },
  { signal = new AbortController().signal, approved = null }: PreviewOptions = {},
): Promise<DocumentPreview> {
  let patterns: ReturnType<typeof documentSelection>;
  try {
    patterns = documentSelection(docs);
  } catch {
    throw veraError("INVALID");
  }
  const include = picomatch(patterns.include, { dot: true, posix: true });
  const exclude = picomatch(patterns.exclude, { dot: true, posix: true });
  let officePending = 0;
  const { paths } = await selectDocuments({
    root,
    docs,
    signal,
    unindexed: (path) => {
      if (isPendingOffice(path, documentKind(path)) && include(path) && !exclude(path)) officePending++;
    },
  });
  return {
    files: paths.length,
    bytes: paths.reduce((sum, entry) => sum + entry.size, 0),
    officePending,
    truncated: signal.aborted,
    guard: documentGuard(
      paths.map((entry) => entry.path),
      docs.maxFiles,
      approved,
    ),
  };
}

const same = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * The picked folder relative to the workbench root. The root may be reached through an alias above
 * it (a mapped drive or linked parent); inside the root, every segment must be an ordinary folder.
 */
export async function relativeFolder(root: string, picked: string): Promise<string> {
  if (!isAbsolute(picked)) throw veraError("INVALID");
  const base = await realpath(root);
  let real: string;
  try {
    real = await realpath(picked);
  } catch {
    throw veraError("NOT_FOUND");
  }
  const path = relative(base, real);
  const parts = path.split(sep);
  if (!path || parts[0] === ".." || isAbsolute(path)) throw veraError("DENIED");
  // The picked path's own last segments must name the same folders, and none of them may be a
  // link: a link inside the workbench can carry the target's name. An alias above them is allowed.
  const pickedPath = resolve(picked);
  const given = pickedPath.split(sep).filter(Boolean).slice(-parts.length);
  if (given.length !== parts.length || given.some((segment, i) => !same(segment, parts[i] as string)))
    throw veraError("DENIED");
  let current = pickedPath;
  for (let i = 0; i < parts.length; i++) {
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw veraError("DENIED");
    current = dirname(current);
  }
  // What remains must be the workbench folder itself, possibly through an alias. A genuine alias sits
  // outside the workbench, so none of its own ancestors may resolve into the workbench: that would be
  // a link inside it looping back to the root or above.
  if (!same(await realpath(current), base)) throw veraError("DENIED");
  for (let above = dirname(current); above !== current; above = dirname(above)) {
    current = above;
    let resolved: string;
    try {
      resolved = await realpath(above);
    } catch {
      continue;
    }
    const inside = relative(base, resolved);
    if (!inside.startsWith(`..${sep}`) && inside !== ".." && !isAbsolute(inside)) throw veraError("DENIED");
  }
  return parts.join("/");
}
