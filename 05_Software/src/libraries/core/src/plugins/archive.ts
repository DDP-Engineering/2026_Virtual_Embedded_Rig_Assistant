import { createReadStream, existsSync } from "node:fs";
import { type FileHandle, lstat, mkdir, open, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import { isPluginRelativePath } from "@vera/shared";
import { Unzip, type UnzipFile, UnzipInflate } from "fflate";
import type { ProcessHost } from "../ports.js";
import { hostVariable } from "./process-tree.js";

/** A download archive that is unreadable or would write outside its extraction folder. */
export class ArchiveError extends Error {
  override name = "ArchiveError";
}

/**
 * Extracts a zip into an empty folder, entry by entry as the file streams in (stored and deflate).
 * Every entry name must be a plugin-relative path after `\` becomes `/`; entries are written as plain
 * files and folders, so a zip never creates a link.
 */
export async function extractZip(file: string, target: string, signal?: AbortSignal): Promise<void> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  const handles = new Set<FileHandle>();
  let failure: unknown;
  let entries = 0;
  let pending: Promise<void> = Promise.resolve();
  const fail = (error: unknown) => {
    failure ??= error instanceof ArchiveError ? error : new ArchiveError("The zip archive cannot be read.");
  };
  const chain = (task: () => Promise<void>) => {
    pending = pending.then(() => (failure ? undefined : task())).catch(fail);
  };
  unzip.onfile = (entry: UnzipFile) => {
    const name = entry.name.replaceAll("\\", "/");
    const folder = name.endsWith("/");
    const path = folder ? name.slice(0, -1) : name;
    if (!isPluginRelativePath(path)) {
      fail(new ArchiveError(`The zip entry ${JSON.stringify(entry.name)} leaves its folder.`));
      return;
    }
    entries++;
    const destination = join(target, ...path.split("/"));
    if (folder) {
      chain(async () => {
        await mkdir(destination, { recursive: true });
      });
      return;
    }
    let handle: Promise<FileHandle> | undefined;
    entry.ondata = (error, data, final) => {
      if (error) {
        fail(error);
        return;
      }
      chain(async () => {
        handle ??= mkdir(dirname(destination), { recursive: true }).then(async () => {
          // `wx`: a second entry of the same name is refused instead of overwriting the first.
          const opened = await open(destination, "wx");
          handles.add(opened);
          return opened;
        });
        const opened = await handle;
        if (data.length) await opened.write(data);
        if (final) {
          handles.delete(opened);
          await opened.close();
        }
      });
    };
    entry.start();
  };
  try {
    for await (const chunk of createReadStream(file)) {
      signal?.throwIfAborted();
      try {
        unzip.push(chunk as Uint8Array);
      } catch (error) {
        fail(error);
      }
      await pending;
      if (failure) throw failure;
    }
    try {
      unzip.push(new Uint8Array(), true);
    } catch (error) {
      fail(error);
    }
    await pending;
    if (failure) throw failure;
    if (!entries) throw new ArchiveError("The zip archive holds no entries.");
  } finally {
    for (const handle of handles) await handle.close().catch(() => {});
  }
}

/** True when `path` is `root` or below it. */
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

/**
 * Checks an extracted tree: files and folders, and links whose target resolves inside the tree. Any
 * other entry (FIFO, socket, device) or a link that leaves the tree is an ArchiveError.
 */
export async function checkTree(root: string): Promise<void> {
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder)) {
      const path = join(folder, entry);
      const info = await lstat(path);
      if (info.isSymbolicLink()) {
        // Windows reports junction targets in the \\?\ namespace.
        const target = (await readlink(path)).replace(/^\\\\\?\\/, "");
        if (!inside(root, resolve(dirname(path), target)))
          throw new ArchiveError(`The archive link ${entry} points outside its folder.`);
      } else if (info.isDirectory()) await walk(path);
      else if (!info.isFile()) throw new ArchiveError(`The archive entry ${entry} is not a file.`);
    }
  };
  await walk(root);
}

/**
 * Whether bsdtar's whole output is its notice for entries it left out because Windows cannot represent their names
 * (non-ASCII names in a 7z), plus the closing line of a delayed exit. Anything else is a real archive problem.
 */
export function bsdtarSkipsOnly(output: string): boolean {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.some((line) => line.includes("Archive entry has empty or unreadable filename")) &&
    lines.every((line) =>
      /^tar(?:\.exe)?: (?:Archive entry has empty or unreadable filename \.\.\. skipping|Error exit delayed from previous errors)\.?$/.test(
        line,
      ),
    )
  );
}

/**
 * The system tar that extracts `.tar.gz`, `.tgz`, `.tar.xz` and, on Windows, `.7z` (it detects the format itself):
 * bsdtar from System32 on Windows, GNU tar from /usr/bin or /bin elsewhere. Neither writes absolute
 * or `..` paths unless asked to; `checkTree` checks the links it leaves.
 */
export function tarCommand(
  host: Pick<ProcessHost, "platform" | "env">,
  file: string,
  target: string,
  exists: (path: string) => boolean = existsSync,
): { executable: string; args: string[] } {
  const executable =
    host.platform === "win32"
      ? win32.join(hostVariable(host as ProcessHost, "SystemRoot") ?? "C:\\Windows", "System32", "tar.exe")
      : exists("/usr/bin/tar")
        ? "/usr/bin/tar"
        : "/bin/tar";
  return { executable, args: ["-x", "-f", file, "-C", target] };
}
