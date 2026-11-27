import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const HEAD_BYTES = 1024;

function small(path: string): string | undefined {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat?.isFile() && stat.size <= HEAD_BYTES ? readFileSync(path, "utf8") : undefined;
}

/**
 * The branch checked out in the Git repository that holds `folder`, read from its HEAD file. No Git process
 * runs, so the system prompt can carry it on every turn; a detached HEAD gives `detached at <hash>`.
 */
export function gitHead(folder: string): string | undefined {
  try {
    for (let root = resolve(folder); ; root = dirname(root)) {
      const entry = join(root, ".git");
      const stat = statSync(entry, { throwIfNoEntry: false });
      if (stat) {
        // A linked worktree and a submodule keep a file here that names the real directory.
        const pointer = stat.isDirectory() ? undefined : /^gitdir: (.+)$/m.exec(small(entry) ?? "")?.[1];
        if (!stat.isDirectory() && !pointer) return undefined;
        const head = small(join(pointer ? resolve(root, pointer.trim()) : entry, "HEAD"))?.trim() ?? "";
        const branch = /^ref: refs\/heads\/(.+)$/.exec(head)?.[1];
        // Git forbids spaces and control characters in a branch name; anything else is not shown.
        if (branch) return /^[^\s\p{Cc}]{1,120}$/u.test(branch) ? branch : undefined;
        return /^[0-9a-f]{40,64}$/.test(head) ? `detached at ${head.slice(0, 7)}` : undefined;
      }
      if (dirname(root) === root) return undefined;
    }
  } catch {
    return undefined;
  }
}
