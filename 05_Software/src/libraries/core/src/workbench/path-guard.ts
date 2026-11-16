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

async function canonicalPath(path: string) {
  let ancestor = path;
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
  return { canonical: join(await realpath(ancestor), ...tail), exists: tail.length === 0 };
}

/** A host-owned boundary that program argument binding must never downgrade to an unbound argument. */
export class ApplicationDataAccessError extends Error {
  constructor() {
    super("Agent access to VERA application data is refused in every permission mode.");
  }
}

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

/** Canonical ordinary file resolution, confined by default; full scope is explicitly host-selected. */
export class PathGuard {
  private constructor(
    readonly root: string,
    private readonly ignored: (path: string) => boolean,
    readonly scope: "workbench" | "filesystem" = "workbench",
    private readonly authorize?: () => void,
    private readonly excludedRoots: readonly string[] = [],
  ) {}

  /** A separately confined skill root may use its owning project's ignore policy. */
  static async create(
    root: string,
    policyRoot = root,
    scope: "workbench" | "filesystem" = "workbench",
    authorize?: () => void,
    excludedRoots: readonly string[] = [],
  ): Promise<PathGuard> {
    if (!isAbsolute(root)) throw Error("Workbench root must be absolute.");
    const canonical = await realpath(root);
    if (!(await lstat(canonical)).isDirectory()) throw Error("Workbench root must be a directory.");
    const excluded: string[] = [];
    for (const root of excludedRoots) {
      if (!isAbsolute(root)) throw Error("Application data root must be absolute.");
      excluded.push(pathIdentity(resolve(root)), pathIdentity((await canonicalPath(root)).canonical));
    }
    if (scope === "filesystem") return new PathGuard(canonical, () => false, scope, authorize, excluded);
    let text = "";
    const metadata = join(await realpath(policyRoot), ".vera");
    const ignorePath = join(metadata, ".veraignore");
    try {
      const directory = await lstat(metadata);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw Error("Redirected VERA metadata is unavailable.");
      const info = await lstat(ignorePath);
      if (!info.isFile() || info.isSymbolicLink())
        throw Error("Redirected .vera/.veraignore is unavailable.");
      if (pathIdentity(await realpath(ignorePath)) !== pathIdentity(ignorePath))
        throw Error("Redirected .vera/.veraignore is unavailable.");
      text = await readFile(ignorePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return new PathGuard(canonical, createIgnoreRules(text), scope, authorize, excluded);
  }

  private confined(path: string): string {
    const rel = relative(pathIdentity(this.root), pathIdentity(path));
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      if (this.scope === "filesystem") return path.split(sep).join("/");
      throw Error("Path leaves the workbench.");
    }
    return relative(this.root, path).split(sep).join("/");
  }

  private exclude(path: string): void {
    for (const root of this.excludedRoots) {
      const rel = relative(root, pathIdentity(path));
      if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
        throw new ApplicationDataAccessError();
    }
  }

  /** Checks only host exclusions; this grants no scope or file binding to an outside program argument. */
  async assertNotExcluded(path: string): Promise<void> {
    if (!this.excludedRoots.length) return;
    const lexical = resolve(this.root, path);
    this.exclude(lexical);
    this.exclude((await canonicalPath(lexical)).canonical);
  }

  private allowed(path: string): void {
    if (path && (this.ignored(path) || this.ignored(`${path}/`)))
      throw Error("Path is ignored by the workbench.");
  }

  /** Rechecks host authority synchronously at the final side-effect boundary. */
  assertAuthorized(): void {
    this.authorize?.();
  }

  async resolve(path: string): Promise<GuardedPath> {
    this.authorize?.();
    if (this.scope === "filesystem") {
      if (!path || /[\0\r\n]/.test(path)) throw Error("Use an ordinary filesystem path.");
      if (process.platform === "win32") {
        const slash = path.replaceAll("\\", "/");
        if (
          /^\/\/[?.]\//.test(slash) ||
          /^[A-Za-z]:(?:$|[^/])/.test(slash) ||
          slash.replace(/^[A-Za-z]:\//, "").includes(":")
        )
          throw Error(
            "Use an ordinary absolute or relative filesystem path, without device or stream syntax.",
          );
        for (const segment of slash.replace(/^[A-Za-z]:\//, "").split("/")) {
          if (segment === "." || segment === "..") continue;
          if (/[ .]$/.test(segment) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\s*(\.|$)/i.test(segment))
            throw Error("Device names and ambiguous Windows paths are unavailable.");
        }
      }
    }
    const lexical = resolve(this.root, this.scope === "filesystem" ? path : validateRelativePath(path));
    this.exclude(lexical);
    this.allowed(this.confined(lexical));
    const { canonical, exists } = await canonicalPath(lexical);
    this.authorize?.();
    if (this.scope === "filesystem" && exists) {
      const info = await lstat(canonical);
      if (!info.isFile() && !info.isDirectory())
        throw Error("Choose an ordinary file or directory, not a device or special file.");
    }
    this.exclude(canonical);
    const rel = this.confined(canonical);
    this.allowed(rel);
    return {
      absolute: canonical,
      relative: rel || ".",
      key: pathIdentity(canonical),
    };
  }
}
