import { constants, type Stats } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { type VeraError, veraError } from "@vera/shared";
import { readIgnorePolicy } from "../knowledge/selection.js";
import { isBinary } from "../tools/binary.js";
import { validateRelativePath } from "./path-guard.js";

/** The Docs tree's bounds (TASK-66b7d4aa). */
export const FOLDER_ENTRY_LIMIT = 5000;
export const FIND_MATCH_LIMIT = 200;
export const FIND_WALK_LIMIT = 50_000;
export const TEXT_VIEW_LIMIT = 5 * 1024 * 1024;

export interface TreeEntry {
  name: string;
  path: string;
  type: "folder" | "file";
  /** Hidden from the agent and the index by the .vera, .git, node_modules and .veraignore rules. */
  ignored: boolean;
}
export interface EntryProperties {
  path: string;
  type: "folder" | "file";
  /** Bytes of a file; null for a folder. */
  size: number | null;
  /** ISO time of the last modification. */
  modified: string;
}
export interface TextView {
  kind: "text";
  path: string;
  ref: null;
  snippet: string;
  lines: string[];
  start: number;
  end: number;
}
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const byName = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const textError = (key: string): VeraError => ({ code: "INVALID", messageKey: key });
const missing = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

/**
 * Workbench-relative segments; absolute, backslash, empty, "." and ".." parts are refused, and so
 * are the Windows aliases PathGuard refuses (trailing dot or space, streams, device names): the OS
 * would open another entry than the one named, past the ignore marking and the link checks.
 */
function segments(path: string): string[] {
  if (path === "") return [];
  if (isAbsolute(path) || path.startsWith("/") || path.includes("\\")) throw veraError("DENIED");
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw veraError("DENIED");
  try {
    validateRelativePath(path);
  } catch {
    throw veraError("DENIED");
  }
  return parts;
}
/**
 * Every ancestor and the target are ordinary (never a link) and of the expected kind. Ignored
 * entries pass: the tree shows them to the user (TASK-b34f2cc7); the agent's PathGuard does not.
 */
async function ordinary(root: string, parts: string[], last: "folder" | "file"): Promise<Stats> {
  let info: Stats | undefined;
  for (let n = 1; n <= parts.length; n++) {
    const folder = n < parts.length || last === "folder";
    try {
      info = await lstat(join(root, ...parts.slice(0, n)));
    } catch (error) {
      if (missing(error)) throw veraError("NOT_FOUND");
      throw error;
    }
    if (info.isSymbolicLink() || (folder ? !info.isDirectory() : !info.isFile())) throw veraError("DENIED");
  }
  if (!info) throw veraError("DENIED");
  return info;
}

/**
 * One folder of the workbench for the Docs tree: folders then files in natural name order, without
 * links, at most 5,000. Entries the permanent and .veraignore rules hide from the agent and the
 * index are listed and marked `ignored`, and so is everything inside an ignored folder.
 */
export async function listFolder(
  root: string,
  path: string,
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const { ignored } = readIgnorePolicy(root);
  const parts = segments(path);
  if (parts.length) await ordinary(root, parts, "folder");
  const inherited = parts.some((_, n) => ignored(`${parts.slice(0, n + 1).join("/")}/`));
  const folders: TreeEntry[] = [];
  const files: TreeEntry[] = [];
  for (const entry of await readdir(join(root, ...parts), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const rel = parts.length ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      folders.push({ name: entry.name, path: rel, type: "folder", ignored: inherited || ignored(`${rel}/`) });
    else if (entry.isFile())
      files.push({ name: entry.name, path: rel, type: "file", ignored: inherited || ignored(rel) });
  }
  folders.sort((a, b) => byName(a.name, b.name));
  files.sort((a, b) => byName(a.name, b.name));
  const entries = [...folders, ...files];
  return { entries: entries.slice(0, FOLDER_ENTRY_LIMIT), truncated: entries.length > FOLDER_ENTRY_LIMIT };
}

/**
 * Visible files whose workbench-relative path contains the fragment, ignoring case: a breadth-first
 * walk that stops after 200 matches or 50,000 entries and then reports `truncated`.
 */
export async function findFiles(
  root: string,
  fragment: string,
): Promise<{ paths: string[]; truncated: boolean }> {
  const needle = fragment.trim().toLowerCase();
  if (!needle) throw veraError("INVALID");
  const { ignored } = readIgnorePolicy(root);
  const queue = [""];
  const paths: string[] = [];
  let visited = 0;
  let truncated = false;
  walk: while (queue.length) {
    const folder = queue.shift() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(join(root, folder), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => byName(a.name, b.name));
    for (const entry of entries) {
      if (++visited > FIND_WALK_LIMIT) {
        truncated = true;
        break walk;
      }
      if (entry.isSymbolicLink()) continue;
      const rel = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignored(`${rel}/`)) queue.push(rel);
      } else if (entry.isFile() && !ignored(rel) && rel.toLowerCase().includes(needle)) {
        if (paths.length === FIND_MATCH_LIMIT) {
          truncated = true;
          break walk;
        }
        paths.push(rel);
      }
    }
  }
  return { paths: paths.sort(byName), truncated };
}

/** An ordinary file or folder of the workbench, ignored or not; the workbench folder, links and outside paths are refused. */
async function entry(root: string, path: string): Promise<{ absolute: string; info: Stats }> {
  const parts = segments(path);
  if (!parts.length) throw veraError("DENIED");
  if (parts.length > 1) await ordinary(root, parts.slice(0, -1), "folder");
  const absolute = join(root, ...parts);
  let info: Stats;
  try {
    info = await lstat(absolute);
  } catch (error) {
    if (missing(error)) throw veraError("NOT_FOUND");
    throw error;
  }
  if (info.isSymbolicLink() || !(info.isFile() || info.isDirectory())) throw veraError("DENIED");
  return { absolute, info };
}

/** The type, size and modified time of a workbench entry, ignored or not, for the Docs tree's Properties. */
export async function statEntry(root: string, path: string): Promise<EntryProperties> {
  const { info } = await entry(root, path);
  const folder = info.isDirectory();
  return {
    path,
    type: folder ? "folder" : "file",
    size: folder ? null : info.size,
    modified: info.mtime.toISOString(),
  };
}

/**
 * The absolute path and kind of a workbench entry, ignored or not, for the Docs tree's actions that
 * reach the OS: open with a program, show in the file manager, copy its path (TASK-eae3a69e).
 */
export async function locateEntry(
  root: string,
  path: string,
): Promise<{ absolute: string; type: "folder" | "file" }> {
  const { absolute, info } = await entry(root, path);
  return { absolute, type: info.isDirectory() ? "folder" : "file" };
}

/**
 * An ordinary UTF-8 text file of the workbench, ignored or not, for the Source tab, at most 5 MiB.
 * Binary content (NUL probe or invalid UTF-8) and larger files are refused with their own message
 * keys.
 */
export async function readText(root: string, path: string): Promise<TextView> {
  const parts = segments(path);
  if (!parts.length) throw veraError("DENIED");
  const info = await ordinary(root, parts, "file");
  if (info.size > TEXT_VIEW_LIMIT) throw textError("documents.textTooLarge");
  const handle = await open(join(root, ...parts), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const opened = await handle.stat();
    if (opened.ino !== info.ino || opened.dev !== info.dev || opened.size > TEXT_VIEW_LIMIT)
      throw veraError("CONFLICT");
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  if (bytes.length > TEXT_VIEW_LIMIT) throw textError("documents.textTooLarge");
  if (isBinary(bytes.subarray(0, 8192))) throw textError("documents.textBinary");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw textError("documents.textBinary");
  }
  const lines = text.split(/\r?\n/);
  return { kind: "text", path, ref: null, snippet: "", lines, start: 1, end: lines.length };
}
