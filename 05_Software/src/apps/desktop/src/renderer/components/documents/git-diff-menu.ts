// REQ-UX-ca8791b8 REQ-UX-9fc1fb7c
import type { GitComparison, GitStatusEntry } from "@vera/shared";
import type { TFunction } from "i18next";
import type { TreeMenuItem } from "./tree-menu.js";
import type { ViewerTarget } from "./viewer-context.js";

/** The applicable actions in the single Git submenu for a Files row. */
export function gitMenu(
  entry: GitStatusEntry | undefined,
  lease: number | undefined,
  trackedPath: string | undefined,
  open: ((target: ViewerTarget) => void) | undefined,
  t: TFunction,
): TreeMenuItem[] {
  if (lease === undefined || !open) return [];
  const items: TreeMenuItem[] = [];
  const add = (comparison: GitComparison) => {
    if (!entry) return;
    items.push({
      action: `git-diff-${comparison}`,
      label: comparison === "unstaged" ? t("gitDiff.viewUnstaged") : t("gitDiff.viewStaged"),
      run: () => open({ gitDiff: { path: entry.path, indexLease: lease, comparison } }),
    });
  };
  if (entry?.conflict || (entry?.unstaged && entry.unstaged !== "?")) add("unstaged");
  if (entry?.conflict || (entry?.staged && entry.staged !== "?")) add("staged");
  if (trackedPath !== undefined)
    items.push({
      action: "git-history",
      label: t("gitHistory.view"),
      run: () => open({ gitHistory: { path: trackedPath, indexLease: lease } }),
    });
  return items.length ? [{ action: "git", label: t("gitDiff.menu"), items }] : [];
}
