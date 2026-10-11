import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createIgnoreRules } from "./ignore.js";

export interface GuardedPath {
  absolute: string;
  relative: string;
  /** Canonical session fingerprint key; Windows aliases share this key. */
  key: string;
}

const pathIdentity = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);

export function validateRelativePath(path: string): string {
  const slash = path.replaceAll("\\", "/");
  if (!path || slash.startsWith("/") || isAbsolute(path) || /[\0:]/.test(path))
    throw Error("Use a workbench-relative path.");
  for (const part of slash.split("/")) {
    if (part === "." || part === "..") continue;
    if (/[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\s*(\.|$)/i.test(part))
      throw Error("Device names and ambiguous Windows paths are unavailable.");
  }
  return slash;
}

/** Every file tool uses lexical and canonical confinement, including nonexistent tails. */
export class PathGuard {
  private constructor(
    readonly root: string,
    private readonly ignored: (path: string) => boolean,
  ) {}

  static async create(root: string): Promise<PathGuard> {
    if (!isAbsolute(root)) throw Error("Workbench root must be absolute.");
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw Error("Workbench root must be a directory.");
    let text = "";
    const ignorePath = join(canonical, ".veraignore");
    try {
      const info = await lstat(ignorePath);
      if (!info.isFile() || info.isSymbolicLink()) throw Error("Redirected .veraignore is unavailable.");
      if (pathIdentity(await realpath(ignorePath)) !== pathIdentity(ignorePath))
        throw Error("Redirected .veraignore is unavailable.");
      text = await readFile(ignorePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return new PathGuard(canonical, createIgnoreRules(text));
  }

  private confined(path: string): string {
    const rel = relative(pathIdentity(this.root), pathIdentity(path));
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw Error("Path leaves the workbench.");
    return relative(this.root, path).split(sep).join("/");
  }

  private allowed(path: string): void {
    if (path && (this.ignored(path) || this.ignored(`${path}/`)))
      throw Error("Path is ignored by the workbench.");
  }

  async resolve(path: string): Promise<GuardedPath> {
    const lexical = resolve(this.root, validateRelativePath(path));
    this.allowed(this.confined(lexical));
    let ancestor = lexical;
    const tail: string[] = [];
    for (;;) {
      try {
        await lstat(ancestor);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = dirname(ancestor);
        if (parent === ancestor) throw error;
        tail.unshift(relative(parent, ancestor));
        ancestor = parent;
      }
    }
    const canonical = join(await realpath(ancestor), ...tail);
    const rel = this.confined(canonical);
    this.allowed(rel);
    return {
      absolute: canonical,
      relative: rel || ".",
      key: pathIdentity(canonical),
    };
  }
}
