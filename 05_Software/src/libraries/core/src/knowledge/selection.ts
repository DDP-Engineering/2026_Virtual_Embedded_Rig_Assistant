import { type Dirent, lstatSync, readdir, readFileSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { veraError, type WorkbenchConfig } from "@vera/shared";
import picomatch from "picomatch";
import { glob } from "tinyglobby";
import { createIgnoreRules } from "../workbench/ignore.js";
import { PathGuard } from "../workbench/path-guard.js";
import { documentKind, documentSelection, missing } from "./kinds.js";

/**
 * The workbench .veraignore policy, read without following a redirected .vera folder or file.
 * A missing file ignores only the permanent folders; a redirected or unreadable one ignores all.
 */
export function readIgnorePolicy(root: string): { text: string; ignored: (path: string) => boolean } {
  try {
    const metadata = lstatSync(join(root, ".vera"));
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw veraError("DENIED");
    const path = join(root, ".vera/.veraignore");
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) throw veraError("DENIED");
    const text = readFileSync(path, "utf8");
    return { text, ignored: createIgnoreRules(text) };
  } catch (error) {
    if (missing(error)) return { text: "", ignored: createIgnoreRules() };
    return { text: "denied", ignored: () => true };
  }
}

/**
 * True for a folder the walk and the watcher must not enter, or a file that is no document:
 * neither is listed further, opened or recorded (TASK-e5310cdb). Folders are matched in their
 * "dir/" form only, so an allowlist .veraignore that re-includes all folders keeps them.
 */
export function skipEntry(
  rel: string,
  directory: boolean,
  ignored: (path: string) => boolean,
  excluded: (path: string) => boolean,
): boolean {
  if (directory) return ignored(`${rel}/`) || excluded(rel);
  return documentKind(rel) === "other" || ignored(rel);
}

/** fdir's directory listing with skipped folders and files removed before the walk goes on. */
export function prunedListing(root: string, skip: (rel: string, directory: boolean) => boolean) {
  return {
    readdir: ((
      path: string,
      options: { withFileTypes: true },
      callback: (error: NodeJS.ErrnoException | null, entries: Dirent[]) => void,
    ) => {
      readdir(path, options, (error, entries) => {
        if (error) return callback(error, []);
        const base = relative(root, path).split(sep).join("/");
        callback(
          null,
          entries.filter((entry) => !skip(base ? `${base}/${entry.name}` : entry.name, entry.isDirectory())),
        );
      });
    }) as unknown as typeof readdir,
  };
}

/** Unlike tool reads, ingest follows no file/directory aliases, even within the root. */
export async function ordinaryFile(root: string, guard: PathGuard, path: string) {
  const target = await guard.resolve(path);
  const parts = path.split("/");
  let size = 0;
  for (let n = 1; n <= parts.length; n++) {
    const info = await lstat(join(root, ...parts.slice(0, n)));
    if (info.isSymbolicLink() || (n < parts.length ? !info.isDirectory() : !info.isFile()))
      throw veraError("DENIED");
    size = info.size;
  }
  return { target, size };
}

export interface SelectInput {
  root: string;
  docs: WorkbenchConfig["docs"];
  signal: AbortSignal;
}
/** Selected document paths, sorted, with their sizes; `retry` when a path vanished meanwhile. */
export interface Selection {
  paths: { path: string; size: number }[];
  retry: boolean;
}
/**
 * The documents a workbench selects: include minus exclude, .veraignore and permanent rules,
 * document types only, ordinary files without links. Runs in the desktop indexer process.
 */
export async function selectDocuments({ root, docs, signal }: SelectInput): Promise<Selection> {
  const guard = await PathGuard.create(root);
  const { include, exclude } = documentSelection(docs);
  const { ignored } = readIgnorePolicy(root);
  const excluded = picomatch(exclude, { dot: true, posix: true });
  const listed = include.length
    ? await glob(include, {
        cwd: root,
        ignore: exclude,
        dot: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        expandDirectories: false,
        fs: prunedListing(root, (rel, directory) => skipEntry(rel, directory, ignored, excluded)),
      })
    : [];
  const paths: Selection["paths"] = [];
  let retry = false;
  for (const path of listed.sort()) {
    if (signal.aborted) break;
    // The listing already drops other kinds; this keeps the rule independent of the walker.
    if (documentKind(path) === "other") continue;
    try {
      paths.push({ path, size: (await ordinaryFile(root, guard, path)).size });
    } catch (error) {
      if (missing(error)) retry = true;
    }
  }
  return { paths, retry };
}
