// REQ-UX-f261c988 REQ-UX-f5d6e9e4
import { useQuery } from "@tanstack/react-query";
import type { DocsOpener, DocsTreeEntry, DocumentRecord } from "@vera/shared";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useAttachments } from "../session/attachments.js";
import { canOpenExternally } from "./open-externally.js";
import type { TreeMenuItem } from "./tree-menu.js";

/** Program names are proper nouns and stay untranslated. */
const programNames: Record<Exclude<DocsOpener, "terminal" | "other">, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  notepadpp: "Notepad++",
};
/** The kinds of entries each detected program opens (TASK-eae3a69e). */
const opens = (app: DocsOpener, type: DocsTreeEntry["type"]) =>
  app === "terminal" ? type === "folder" : app === "notepadpp" ? type === "file" : true;
/** Programs listed by name; the Windows Open with dialog has its own item at the end. */
const named = (app: DocsOpener): app is Exclude<DocsOpener, "other"> => app !== "other";

function defineTranslationKeys<const T extends readonly string[]>(keys: T): T {
  return keys;
}
const statusKeys = defineTranslationKeys([
  "documents.status.pending",
  "documents.status.indexed",
  "documents.status.failed",
  "documents.status.unsupported",
  "documents.status.needs_ocr",
]);
const statusIndex = { pending: 0, indexed: 1, failed: 2, unsupported: 3, needs_ocr: 4 } as const;
const reasonKeys = defineTranslationKeys([
  "documents.reason.SIZE_LIMIT",
  "documents.reason.TYPE_UNSUPPORTED",
  "documents.reason.BINARY",
  "documents.reason.IO",
  "documents.reason.PROCESSING",
  "documents.reason.NEEDS_OCR",
]);
const reasonIndex = {
  SIZE_LIMIT: 0,
  TYPE_UNSUPPORTED: 1,
  BINARY: 2,
  IO: 3,
  PROCESSING: 4,
  NEEDS_OCR: 5,
} as const;
/** The localized index status (and reason) of a document, as Files shows it. */
export function useDescribeDocument() {
  const { t } = useTranslation();
  return (doc: DocumentRecord) =>
    `${t(statusKeys[statusIndex[doc.status]])}${doc.error ? ` · ${t(reasonKeys[reasonIndex[doc.error]])}` : ""}`;
}

export interface FileTarget {
  path: string;
  type: DocsTreeEntry["type"];
  ignored: boolean;
}

/**
 * The file actions of a workbench entry, shared by the Files tree row menu and the document tab
 * menu (TASK-6c4aeed8): Attach as context, Open in (default app, detected editors, the system's
 * applications on Linux, the Open with dialog), Show in Explorer/Finder/folder, Copy and Properties.
 * `menuFor` names the file whose menu is open, so Linux reads its registered applications then.
 */
export function useFileActions(workbenchId: string, menuFor: string | undefined) {
  const { t } = useTranslation();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const attachments = useAttachments();
  const info = useQuery({ queryKey: ["app.info"], queryFn: () => api.getAppInfo() });
  const openers = useQuery({
    queryKey: ["docs.openers"],
    // Detected once per start in main.
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => (await api.invoke("docs.openers", {})).apps,
  });
  const platform = info.data?.platform;
  const systemApps = useQuery({
    queryKey: ["docs.systemApps", workbenchId, menuFor],
    enabled: platform === "linux" && menuFor !== undefined,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => (await api.invoke("docs.systemApps", { workbenchId, path: menuFor as string })).apps,
  });
  /** Runs an action; its failure is shown by the caller and a success may say so. */
  const perform = (action: Promise<unknown>, done?: string) => {
    setError(undefined);
    setNotice(undefined);
    void action.then(() => setNotice(done), setError);
  };
  const revealLabel =
    platform === "win32"
      ? t("documents.revealExplorer")
      : platform === "darwin"
        ? t("documents.revealFinder")
        : t("documents.revealFolder");
  const items = (entry: FileTarget, properties: () => void): TreeMenuItem[] => {
    const openIn: TreeMenuItem[] = [
      // The default application is reached through PathGuard, which refuses what VERA ignores.
      ...(entry.type === "file" && !entry.ignored && canOpenExternally(entry.path)
        ? [
            {
              action: "open-external",
              label: t("documents.defaultApp"),
              name: t("documents.openExternalNamed", { path: entry.path }),
              run: () => perform(api.invoke("app.openPath", { path: entry.path })),
            },
          ]
        : []),
      ...(openers.data ?? [])
        .filter(named)
        .filter((app) => opens(app, entry.type))
        .map((app) => ({
          action: `open-in-${app}`,
          label: app === "terminal" ? t("documents.terminal") : programNames[app],
          run: () => perform(api.invoke("docs.openWith", { workbenchId, path: entry.path, app })),
        })),
      ...(entry.type === "file" && entry.path === menuFor
        ? (systemApps.data ?? []).map((app) => ({
            action: `system-${app.id}`,
            label: app.name,
            run: () =>
              perform(api.invoke("docs.openSystemApp", { workbenchId, path: entry.path, app: app.id })),
          }))
        : []),
      ...(entry.type === "file" && openers.data?.includes("other")
        ? [
            {
              action: "open-in-other",
              label: t("documents.otherApp"),
              run: () =>
                perform(api.invoke("docs.openWith", { workbenchId, path: entry.path, app: "other" })),
            },
          ]
        : []),
    ];
    const copy = (form: "absolute" | "relative" | "name", label: string): TreeMenuItem => ({
      action: `copy-${form}`,
      label,
      run: () =>
        perform(api.invoke("docs.copyPath", { workbenchId, path: entry.path, form }), t("documents.copied")),
    });
    return [
      // Only where a chat can take entries (inside the app); ignored entries stay out of the agent's reach.
      ...(attachments
        ? [
            {
              action: "attach",
              label: t("documents.attach"),
              disabled: entry.ignored || !attachments.attach || attachments.full,
              run: () => attachments.attach?.(entry.path),
            },
          ]
        : []),
      ...(openIn.length ? [{ action: "open-in", label: t("documents.openIn"), items: openIn }] : []),
      {
        action: "reveal",
        label: revealLabel,
        run: () => perform(api.invoke("docs.reveal", { workbenchId, path: entry.path })),
      },
      {
        action: "copy",
        label: t("documents.copy"),
        items: [
          copy("absolute", t("documents.copyAbsolute")),
          copy("relative", t("documents.copyRelative")),
          copy("name", t("documents.copyName")),
        ],
      },
      { action: "properties", label: t("documents.properties"), run: properties },
    ];
  };
  /** A managed download has only Show in Explorer: its folder belongs to VERA. */
  const downloadItems = (downloadId: string): TreeMenuItem[] => [
    {
      action: "reveal-download",
      label: revealLabel,
      run: () => perform(api.invoke("downloads.reveal", { downloadId })),
    },
  ];
  /** Drops the last action's message, as when another tab is selected. */
  const clear = useCallback(() => {
    setError(undefined);
    setNotice(undefined);
  }, []);
  return { items, downloadItems, error, notice, clear };
}
