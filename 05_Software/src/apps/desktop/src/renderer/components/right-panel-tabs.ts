import { type RightPanelTab, rightPanelTabIds } from "@vera/shared";
import type { TFunction } from "i18next";
import { Bookmark, BookOpen, FileDiff, Folder, ListTodo, Package, Play, SquareTerminal } from "lucide-react";

/** Shared order and localized metadata for the shell and workbench visibility editor. */
export function rightPanelTabs(t: TFunction) {
  const contentTabs = {
    context: { label: t("panel.context"), icon: BookOpen },
    docs: { label: t("panel.docs"), icon: Folder },
    changes: { label: t("panel.changes"), icon: FileDiff },
    artifacts: { label: t("panel.artifacts"), icon: Package },
    plan: { label: t("panel.plan"), icon: ListTodo },
    bookmarks: { label: t("panel.bookmarks"), icon: Bookmark },
    runs: { label: t("panel.runs"), icon: Play },
    terminal: { label: t("panel.terminal"), icon: SquareTerminal },
  } satisfies Record<RightPanelTab, unknown>;
  return rightPanelTabIds.map((id) => ({ id, ...contentTabs[id] }));
}
