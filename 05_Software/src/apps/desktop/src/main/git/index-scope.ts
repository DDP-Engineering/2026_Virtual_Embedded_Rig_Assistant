import { join } from "node:path";
import { GitReadError, type GitRepository, gitEntry } from "./repository.js";

export function scoped(path: string, prefix: string) {
  const parts = path.split("/");
  if (
    path.length > 4096 ||
    parts.length > 128 ||
    path.includes("\\") ||
    path.includes("\0") ||
    (process.platform === "win32" && /[<>:"|?*]/.test(path)) ||
    parts.some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  )
    throw new GitReadError("failed");
  if (
    process.platform === "win32" &&
    parts.some((part) => /[. ]$|^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))
  )
    throw new GitReadError("failed");
  return !prefix ? path : path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : undefined;
}

export const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** Ordinary outer index paths must never drive Git into a newly embedded repository. */
export async function checkIndexScope(repo: GitRepository, output: Buffer, signal: AbortSignal) {
  const records = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output).split("\0");
  if (records.pop() !== "" || records.length > 100_000) throw new GitReadError("failed");
  const tracked = new Set<string>();
  const gitlinks = new Set<string>();
  const unmerged = new Set<string>();
  const checks = new Map<string, Promise<boolean>>();

  function isDirectory(path: string): Promise<boolean> {
    if (!path) return Promise.resolve(true);
    const existing = checks.get(path);
    if (existing) return existing;
    const pending = (async () => {
      if (!(await isDirectory(parentOf(path)))) return false;
      signal.throwIfAborted();
      const location = join(repo.scope, path);
      const entry = await gitEntry(location);
      if (entry?.isSymbolicLink()) throw new GitReadError("unsupported");
      if (!entry?.isDirectory()) return false;
      if (await gitEntry(join(location, ".git"))) throw new GitReadError("unsupported");
      return true;
    })();
    checks.set(path, pending);
    return pending;
  }

  for (let index = 0; index < records.length; index += 64) {
    signal.throwIfAborted();
    await Promise.all(
      records.slice(index, index + 64).map(async (record) => {
        const meta = /^(\d{6}) [0-9a-f]{40} ([0-3])\t/.exec(record);
        if (!meta) throw new GitReadError("failed");
        const path = scoped(record.slice(meta[0].length), repo.prefix);
        if (!path) throw new GitReadError("failed");
        if (meta[2] !== "0") unmerged.add(path);
        if (meta[1] === "160000") {
          gitlinks.add(path);
          return;
        }
        for (let next = path; next && !tracked.has(next); next = parentOf(next)) tracked.add(next);
        await isDirectory(parentOf(path));
      }),
    );
  }
  return { tracked, gitlinks, unmerged };
}
