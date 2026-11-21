// REQ-UX-ca8791b8
import type { GitComparison, GitStatusEntry } from "@vera/shared";
import type { TFunction } from "i18next";
import type { TreeMenuItem } from "./tree-menu.js";
import type { ViewerTarget } from "./viewer-context.js";

/** The Git children for a Files row. A tracked-path action can join this submenu independently of comparisons. */
export function gitDiffMenu(
  entry: GitStatusEntry | undefined,
  lease: number | undefined,
  open: ((target: ViewerTarget) => void) | undefined,
  t: TFunction,
): TreeMenuItem[] {
  if (!entry || lease === undefined || !open) return [];
  const items: TreeMenuItem[] = [];
  const add = (comparison: GitComparison) => {
    items.push({
      action: `git-diff-${comparison}`,
      label: comparison === "unstaged" ? t("gitDiff.viewUnstaged") : t("gitDiff.viewStaged"),
      run: () => open({ gitDiff: { path: entry.path, indexLease: lease, comparison } }),
    });
  };
  if (entry.conflict || (entry.unstaged && entry.unstaged !== "?")) add("unstaged");
  if (entry.conflict || (entry.staged && entry.staged !== "?")) add("staged");
  return items.length ? [{ action: "git", label: t("gitDiff.menu"), items }] : [];
}
