import ignore from "ignore";

export const permanentIgnoreDirectories = [".vera", ".git", "node_modules"] as const;
/** Root-relative slash paths; permanent runtime/VCS/dependency exclusions win over negation. */
export function createIgnoreRules(text = "") {
  const rules = ignore().add(text);
  return (path: string): boolean => {
    if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return true;
    if (
      path
        .split("/")
        .some((segment) => (permanentIgnoreDirectories as readonly string[]).includes(segment.toLowerCase()))
    )
      return true;
    return rules.ignores(path);
  };
}
