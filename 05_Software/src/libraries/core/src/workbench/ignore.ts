import ignore, { type Ignore } from "ignore";

export const permanentIgnoreDirectories = [".vera", ".git", "node_modules"] as const;

/**
 * Git's .gitignore matching for one entry whose folders are already admitted: the deepest
 * .gitignore with a matching rule decides, and each file's rules are relative to its own folder.
 * `read(folder)` returns a folder's .gitignore text ("" is the root), or undefined for none.
 */
export function createGitignoreRules(read: (folder: string) => string | undefined) {
  const levels = new Map<string, Ignore | null>();
  const level = (folder: string) => {
    let rules = levels.get(folder);
    if (rules === undefined) {
      const text = read(folder);
      rules = text === undefined ? null : ignore().add(text);
      levels.set(folder, rules);
    }
    return rules;
  };
  const decided = new Map<string, boolean>();
  /** `path` is a root-relative slash path; folders end with "/". */
  return (path: string): boolean => {
    let result = decided.get(path);
    if (result !== undefined) return result;
    result = false;
    const parts = path.replace(/\/$/, "").split("/");
    for (let n = parts.length - 1; n >= 0; n--) {
      const rules = level(parts.slice(0, n).join("/"));
      if (!rules) continue;
      const { ignored, unignored } = rules.test(n ? path.split("/").slice(n).join("/") : path);
      if (ignored || unignored) {
        result = ignored;
        break;
      }
    }
    decided.set(path, result);
    return result;
  };
}

/**
 * Root-relative slash paths. The permanent runtime/VCS/dependency folders are always ignored; then
 * .veraignore decides, its negations winning over .gitignore; then the optional .gitignore rules.
 * Each folder above an entry is decided first, so an ignored folder hides everything inside it. A
 * .veraignore negation that brings back a folder .gitignore drops brings back its contents too.
 */
export function createIgnoreRules(text = "", gitignored?: (path: string) => boolean) {
  const rules = ignore().add(text);
  return (path: string): boolean => {
    if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return true;
    const parts = path.replace(/\/$/, "").split("/");
    if (
      parts.some((segment) =>
        (permanentIgnoreDirectories as readonly string[]).includes(segment.toLowerCase()),
      )
    )
      return true;
    if (!gitignored) return rules.ignores(path);
    let git: typeof gitignored | undefined = gitignored;
    for (let n = 1; n <= parts.length; n++) {
      const step = n < parts.length ? `${parts.slice(0, n).join("/")}/` : path;
      const own = rules.test(step);
      if (own.ignored) return true;
      if (git?.(step)) {
        if (!own.unignored) return true;
        git = undefined;
      }
    }
    return false;
  };
}
