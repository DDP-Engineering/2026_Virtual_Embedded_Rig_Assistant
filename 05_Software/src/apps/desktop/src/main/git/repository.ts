// REQ-SEC-1b68aa62 REQ-SEC-b24a8722
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

export class GitReadError extends Error {
  constructor(readonly reason: "missing-git" | "unsupported" | "failed") {
    super(reason);
  }
}

export type GitRepository = { root: string; metadata: string; scope: string; prefix: string };
const windows = process.platform === "win32";
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const oid = /^[0-9a-f]{40}$/;

export function containsPath(parent: string, path: string): boolean {
  const rel = relative(parent, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export async function gitEntry(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

/** Find the nearest physical repository boundary without asking Git to discover configuration. */
export async function containingRepository(
  folder: string,
  signal: AbortSignal,
): Promise<GitRepository | undefined> {
  const scope = await realpath(folder);
  if (!isAbsolute(scope) || (windows && !/^[a-z]:[\\/]/i.test(scope))) throw new GitReadError("unsupported");
  for (let root = scope; ; root = dirname(root)) {
    signal.throwIfAborted();
    const metadata = join(root, ".git");
    const stat = await gitEntry(metadata);
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new GitReadError("unsupported");
      return { root, metadata, scope, prefix: relative(root, scope).split(sep).join("/") };
    }
    if (dirname(root) === root) return undefined;
  }
}

async function boundedFile(path: string, limit: number): Promise<Buffer | undefined> {
  const before = await gitEntry(path);
  if (!before) return undefined;
  if (!before.isFile() || before.size > limit) throw new GitReadError("unsupported");
  const handle = await open(
    path,
    constants.O_RDONLY | (windows ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.size > limit)
      throw new GitReadError("unsupported");
    const buffer = Buffer.allocUnsafe(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== stat.size) throw new GitReadError("failed");
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

async function copyMetadata(source: string, destination: string, limit: number, preserveTime = false) {
  const stat = preserveTime ? await gitEntry(source) : undefined;
  const bytes = await boundedFile(source, limit);
  if (!bytes) return;
  await writeFile(destination, bytes);
  // Git uses index mtime to decide when an index entry needs a racy-stat content check.
  if (stat) await utimes(destination, stat.atime, stat.mtime);
}

function safeConfig(output: Buffer): string {
  const records = new TextDecoder("utf-8", { fatal: true }).decode(output).split("\0");
  if (records.pop() !== "") throw new GitReadError("unsupported");
  const settings = new Map<string, string>();
  const booleanKeys = new Set(["filemode", "ignorecase", "symlinks"]);
  for (const record of records) {
    const divider = record.indexOf("\n");
    const key = divider === -1 ? record : record.slice(0, divider);
    const value = (divider === -1 ? "true" : record.slice(divider + 1)).toLowerCase();
    if (
      /^(include(?:if)?|filter|extensions)\./.test(key) ||
      ["core.worktree", "core.attributesfile", "core.excludesfile"].includes(key) ||
      (key === "core.repositoryformatversion" && value !== "0") ||
      (["core.bare", "core.sparsecheckout", "core.splitindex"].includes(key) && value !== "false")
    ) {
      throw new GitReadError("unsupported");
    }
    const option = key.startsWith("core.") ? key.slice(5) : "";
    if (booleanKeys.has(option) || option === "autocrlf" || option === "eol") {
      const values =
        option === "autocrlf"
          ? ["true", "false", "input"]
          : option === "eol"
            ? ["lf", "crlf", "native"]
            : ["true", "false"];
      if (!values.includes(value)) throw new GitReadError("unsupported");
      settings.set(option, value);
    }
  }
  return (
    "[core]\n\trepositoryformatversion = 0\n\tbare = false\n" +
    [...settings].map(([key, value]) => `\t${key} = ${value}\n`).join("")
  );
}

function safeHead(bytes: Buffer): { head: string; parts: string[] } {
  const head = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r?\n$/, "");
  if (oid.test(head)) return { head, parts: [] };
  const ref = head.startsWith("ref: refs/heads/") ? head.slice(5) : "";
  const parts = ref.split("/");
  if (
    !ref ||
    parts.length > 24 ||
    ref.includes("..") ||
    ref.includes("@{") ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Git ref names cannot contain control bytes.
    /[\u0000-\u0020\u007f~^:?*[\\<>|"]/.test(ref) ||
    parts.some((part) => !part || part.startsWith(".") || /(?:\.|\.lock)$/i.test(part))
  )
    throw new GitReadError("unsupported");
  return { head, parts };
}

async function copyHead(source: string, target: string) {
  const bytes = await boundedFile(join(source, "HEAD"), 4096);
  if (!bytes) throw new GitReadError("unsupported");
  const { head, parts } = safeHead(bytes);
  await writeFile(join(target, "HEAD"), `${head}\n`);
  if (!parts.length) return head;
  let from = source;
  let to = target;
  for (const directory of parts.slice(0, -1)) {
    from = join(from, directory);
    to = join(to, directory);
    const stat = await gitEntry(from);
    if (!stat) return head;
    if (!stat.isDirectory()) throw new GitReadError("unsupported");
    await mkdir(to, { recursive: true });
  }
  const name = parts.at(-1) as string;
  const ref = await boundedFile(join(from, name), 64);
  if (!ref) return head;
  const value = ref.toString("ascii").replace(/\r?\n$/, "");
  if (!oid.test(value)) throw new GitReadError("unsupported");
  await writeFile(join(to, name), `${value}\n`);
  return head;
}

async function linkObjects(source: string, target: string, signal: AbortSignal) {
  if (!(await gitEntry(source))?.isDirectory()) throw new GitReadError("unsupported");
  const info = join(source, "info");
  const infoEntry = await gitEntry(info);
  if (
    infoEntry &&
    (!infoEntry.isDirectory() ||
      (await gitEntry(join(info, "alternates"))) ||
      (await gitEntry(join(info, "http-alternates"))))
  )
    throw new GitReadError("unsupported");
  const dir = await opendir(source);
  let count = 0;
  for await (const entry of dir) {
    signal.throwIfAborted();
    if (++count > 1024) throw new GitReadError("unsupported");
    if (entry.name !== "pack" && !/^[a-f0-9]{2}$/.test(entry.name)) continue;
    const path = join(source, entry.name);
    if (!entry.isDirectory() || (await realpath(path)) !== path) throw new GitReadError("unsupported");
    // Do not expose objects/info: the private store cannot inherit any alternate object databases.
    await symlink(path, join(target, entry.name), windows ? "junction" : "dir");
  }
}

/** Copy bounded data into an app-owned gitdir and project only execution-free core settings. */
export async function prepareRepository(
  repo: GitRepository,
  scratch: string,
  signal: AbortSignal,
  readConfig: (config: Buffer) => Promise<Buffer>,
): Promise<{ metadata: string; head: string }> {
  const source = repo.metadata;
  if ((await realpath(source)) !== source) throw new GitReadError("unsupported");
  for (const feature of ["commondir", "config.worktree", "info/sparse-checkout"]) {
    if (await gitEntry(join(source, feature))) throw new GitReadError("unsupported");
  }
  const config = await boundedFile(join(source, "config"), 64 * 1024);
  if (!config) throw new GitReadError("unsupported");
  const settings = safeConfig(await readConfig(config));
  const target = join(scratch, "metadata");
  await mkdir(target);
  await Promise.all(["objects", "refs", "info"].map((dir) => mkdir(join(target, dir))));
  await writeFile(join(target, "config"), settings);
  const head = await copyHead(source, target);
  await copyMetadata(join(source, "packed-refs"), join(target, "packed-refs"), 8 * 1024 * 1024);
  await copyMetadata(join(source, "index"), join(target, "index"), 24 * 1024 * 1024, true);
  const info = await gitEntry(join(source, "info"));
  if (info) {
    if (!info.isDirectory()) throw new GitReadError("unsupported");
    for (const name of ["exclude", "attributes"])
      await copyMetadata(join(source, "info", name), join(target, "info", name), 128 * 1024);
  }
  await linkObjects(join(source, "objects"), join(target, "objects"), signal);
  signal.throwIfAborted();
  return { metadata: target, head };
}
