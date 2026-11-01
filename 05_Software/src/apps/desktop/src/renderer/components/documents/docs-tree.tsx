// REQ-UX-c28dde55 REQ-UX-795a7f61 REQ-UX-775eb693 REQ-UX-9f16abf2 REQ-UX-2d9cdf43 REQ-UX-fdd495b8
// REQ-UX-541a5bee REQ-UX-4d1b3324 REQ-UX-ed65cbbc REQ-UX-d455531b
// REQ-UX-25c814e1 REQ-UX-3a3d67c1 REQ-UX-ef3e2304 REQ-UX-b5edf930
import { useQueries, useQuery } from "@tanstack/react-query";
import { type DocsOpener, type DocsTreeEntry, type DocumentRecord, veraError } from "@vera/shared";
import { Ban, ChevronDown, ChevronRight, CircleCheck, CircleX, Clock, ScanText } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { useAttachments } from "../session/attachments.js";
import { canOpenExternally } from "./open-externally.js";
import { TreeMenu, type TreeMenuItem } from "./tree-menu.js";
import { TreeProperties } from "./tree-properties.js";
import { useDocumentViewer } from "./viewer-context.js";

type Summary = { count: number; problems: boolean };
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
const statusIcons = {
  indexed: CircleCheck,
  pending: Clock,
  failed: CircleX,
  unsupported: Ban,
  needs_ocr: ScanText,
} as const;
/** A saved folder that no longer exists or became a link; its expansion is dropped quietly. */
const gone = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "NOT_FOUND" || code === "DENIED";
};
/** Documents in the index beneath each folder, and whether any of them needs attention. */
export function folderSummaries(documents: readonly Pick<DocumentRecord, "path" | "status">[]) {
  const summaries = new Map<string, Summary>();
  for (const doc of documents) {
    const parts = doc.path.split("/");
    for (let n = 1; n < parts.length; n++) {
      const folder = parts.slice(0, n).join("/");
      const summary = summaries.get(folder) ?? { count: 0, problems: false };
      summary.count++;
      if (doc.status === "failed" || doc.status === "needs_ocr" || doc.status === "unsupported")
        summary.problems = true;
      summaries.set(folder, summary);
    }
  }
  return summaries;
}
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const byName = (a: DocsTreeEntry, b: DocsTreeEntry) =>
  a.type === b.type ? collator.compare(a.name, b.name) : a.type === "folder" ? -1 : 1;
/** The entries of each folder from a filter's matching file paths; every folder is open. */
function filteredFolders(paths: readonly string[]): Map<string, DocsTreeEntry[]> {
  const folders = new Map<string, Map<string, DocsTreeEntry>>([["", new Map()]]);
  for (const path of paths) {
    const parts = path.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const parent = parts.slice(0, n - 1).join("/");
      const entryPath = parts.slice(0, n).join("/");
      const folder = n < parts.length;
      if (!folders.has(parent)) folders.set(parent, new Map());
      folders.get(parent)?.set(entryPath, {
        name: parts[n - 1] as string,
        path: entryPath,
        type: folder ? "folder" : "file",
        // Name matches never come from ignored folders.
        ignored: false,
      });
      if (folder && !folders.has(entryPath)) folders.set(entryPath, new Map());
    }
  }
  return new Map([...folders].map(([path, entries]) => [path, [...entries.values()].sort(byName)]));
}
const storageKey = (workbenchId: string) => `vera.docs.tree.${workbenchId}`;
function loadExpanded(workbenchId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(workbenchId)) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}
export interface TreeExpansion {
  expanded: ReadonlySet<string>;
  save: (next: Set<string>) => void;
}
/** The expanded folders of a workbench's Docs tree, remembered per workbench in localStorage. */
export function useTreeExpansion(workbenchId: string): TreeExpansion {
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(workbenchId));
  const save = (next: Set<string>) => {
    setExpanded(next);
    try {
      if (next.size) localStorage.setItem(storageKey(workbenchId), JSON.stringify([...next]));
      else localStorage.removeItem(storageKey(workbenchId));
    } catch {}
  };
  return { expanded, save };
}
type Row = DocsTreeEntry & { level: number; parent: string; expanded: boolean };

/**
 * The workbench folder as a tree in Docs (TASK-66b7d4aa): folders load their entries when
 * expanded, documents show their index status, other files open as text. A flat ARIA tree with
 * aria-level and one roving tab stop; keys move through the rendered rows in order. A row's
 * context menu offers Open, Attach as context, Open in, Show in Explorer, Copy and Properties. Entries VERA ignores are listed
 * fainter (TASK-b34f2cc7); a non-empty `query` shows only the files whose names match.
 */
export function DocsTree({
  workbenchId,
  documents,
  describe,
  query,
  expansion,
}: {
  workbenchId: string;
  documents: readonly DocumentRecord[];
  /** The localized status (and reason) of an indexed document. */
  describe: (doc: DocumentRecord) => string;
  /** The Docs search box's debounced text; empty shows the browsing tree. */
  query: string;
  expansion: TreeExpansion;
}) {
  const { t } = useTranslation();
  const open = useDocumentViewer();
  const byPath = useMemo(() => new Map(documents.map((doc) => [doc.path, doc])), [documents]);
  const summaries = useMemo(() => folderSummaries(documents), [documents]);
  const { expanded, save } = expansion;
  const [active, setActive] = useState<string>();
  const [menu, setMenu] = useState<{ row: Row; x: number; y: number }>();
  const [properties, setProperties] = useState<Row>();
  const [actionError, setActionError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const attachments = useAttachments();
  const info = useQuery({ queryKey: ["app.info"], queryFn: () => api.getAppInfo() });
  const openers = useQuery({
    queryKey: ["docs.openers"],
    // Detected once per start in main.
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => (await api.invoke("docs.openers", {})).apps,
  });
  /** Runs a row action; its failure shows under the tree and a success may say so. */
  const perform = (action: Promise<unknown>, done?: string) => {
    setActionError(undefined);
    setNotice(undefined);
    void action.then(() => setNotice(done), setActionError);
  };
  const tree = useRef<HTMLDivElement>(null);
  const toggle = (path: string, value: boolean) => {
    if (query) return;
    const next = new Set(expanded);
    if (value) next.add(path);
    else for (const folder of next) if (folder === path || folder.startsWith(`${path}/`)) next.delete(folder);
    save(next);
  };
  const paths = ["", ...expanded];
  const listed = useQueries({
    queries: paths.map((path) => ({
      queryKey: ["docs.tree", workbenchId, path],
      enabled: !query,
      refetchOnMount: "always" as const,
      queryFn: async () => {
        const result = await api.invoke("docs.tree", { workbenchId, path });
        if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
        return result;
      },
    })),
  });
  useEffect(() => {
    const stale = paths.filter((path, i) => path && listed[i]?.isError && gone(listed[i]?.error));
    if (!stale.length) return;
    const next = new Set(expanded);
    for (const path of stale)
      for (const folder of next) if (folder === path || folder.startsWith(`${path}/`)) next.delete(folder);
    save(next);
  });
  const found = useQuery({
    queryKey: ["docs.find", workbenchId, query],
    enabled: !!query,
    // A filter typed again later reads the disk again.
    gcTime: 0,
    queryFn: async () => {
      const result = await api.invoke("docs.find", { workbenchId, query });
      if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
      return result;
    },
  });
  const folders = useMemo(() => {
    if (query) return found.data ? filteredFolders(found.data.paths) : new Map<string, DocsTreeEntry[]>();
    return new Map(
      listed.flatMap((result) => (result.data ? [[result.data.path, result.data.entries]] : [])),
    );
  }, [query, found.data, listed]);
  const truncated = new Set(listed.flatMap((result) => (result.data?.truncated ? [result.data.path] : [])));
  const rows: Row[] = [];
  const walk = (path: string, level: number) => {
    for (const entry of folders.get(path) ?? []) {
      const open = entry.type === "folder" && (query ? true : expanded.has(entry.path));
      rows.push({ ...entry, level, parent: path, expanded: open });
      if (open) walk(entry.path, level + 1);
    }
  };
  walk("", 1);
  const current = rows.some((row) => row.path === active) ? active : rows[0]?.path;
  const activate = (row: Row) => {
    if (row.type === "folder") return toggle(row.path, !row.expanded);
    const doc = byPath.get(row.path);
    // Indexed documents open in their viewer; any other file is read as text.
    open?.(
      doc && (doc.status === "indexed" || doc.status === "needs_ocr")
        ? { path: row.path }
        : row.ignored
          ? { textPath: row.path, ignored: true }
          : { textPath: row.path },
    );
  };
  const focusRow = (path: string | undefined) => {
    if (path === undefined) return;
    tree.current?.querySelector<HTMLElement>(`[data-tree-path="${CSS_ESCAPE(path)}"]`)?.focus();
  };
  const openMenu = (row: Row, x: number, y: number) => {
    // A keyboard-opened menu may be followed by the browser's own contextmenu event on the row.
    if (menu?.row.path === row.path) return;
    setActive(row.path);
    setMenu({ row, x, y });
  };
  const platform = info.data?.platform;
  // Linux registers applications per file type; read them when a file's menu opens (TASK-c49f03d5).
  const systemFor = menu?.row.type === "file" ? menu.row.path : undefined;
  const systemApps = useQuery({
    queryKey: ["docs.systemApps", workbenchId, systemFor],
    enabled: platform === "linux" && systemFor !== undefined,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () =>
      (await api.invoke("docs.systemApps", { workbenchId, path: systemFor as string })).apps,
  });
  const menuItems = (row: Row): TreeMenuItem[] => {
    const openIn: TreeMenuItem[] = [
      // The default application is reached through PathGuard, which refuses what VERA ignores.
      ...(row.type === "file" && !row.ignored && canOpenExternally(row.path)
        ? [
            {
              action: "open-external",
              label: t("documents.defaultApp"),
              name: t("documents.openExternalNamed", { path: row.path }),
              run: () => perform(api.invoke("app.openPath", { path: row.path })),
            },
          ]
        : []),
      ...(openers.data ?? [])
        .filter(named)
        .filter((app) => opens(app, row.type))
        .map((app) => ({
          action: `open-in-${app}`,
          label: app === "terminal" ? t("documents.terminal") : programNames[app],
          run: () => perform(api.invoke("docs.openWith", { workbenchId, path: row.path, app })),
        })),
      ...(row.type === "file" && row.path === systemFor
        ? (systemApps.data ?? []).map((app) => ({
            action: `system-${app.id}`,
            label: app.name,
            run: () =>
              perform(api.invoke("docs.openSystemApp", { workbenchId, path: row.path, app: app.id })),
          }))
        : []),
      ...(row.type === "file" && openers.data?.includes("other")
        ? [
            {
              action: "open-in-other",
              label: t("documents.otherApp"),
              run: () => perform(api.invoke("docs.openWith", { workbenchId, path: row.path, app: "other" })),
            },
          ]
        : []),
    ];
    const copy = (form: "absolute" | "relative" | "name", label: string): TreeMenuItem => ({
      action: `copy-${form}`,
      label,
      run: () =>
        perform(api.invoke("docs.copyPath", { workbenchId, path: row.path, form }), t("documents.copied")),
    });
    return [
      {
        action: "open",
        label: t("documents.open"),
        run: () => (row.type === "folder" ? toggle(row.path, true) : activate(row)),
      },
      // Only where a chat can take entries (inside the app); ignored entries stay out of the agent's reach.
      ...(attachments
        ? [
            {
              action: "attach",
              label: t("documents.attach"),
              disabled: row.ignored || !attachments.attach || attachments.full,
              run: () => attachments.attach?.(row.path),
            },
          ]
        : []),
      ...(openIn.length ? [{ action: "open-in", label: t("documents.openIn"), items: openIn }] : []),
      {
        action: "reveal",
        label:
          platform === "win32"
            ? t("documents.revealExplorer")
            : platform === "darwin"
              ? t("documents.revealFinder")
              : t("documents.revealFolder"),
        run: () => perform(api.invoke("docs.reveal", { workbenchId, path: row.path })),
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
      { action: "properties", label: t("documents.properties"), run: () => setProperties(row) },
    ];
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>, row: Row, index: number) => {
    const move = (target: number) => {
      event.preventDefault();
      focusRow(rows[Math.max(0, Math.min(rows.length - 1, target))]?.path);
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "ArrowRight" && row.type === "folder") {
      event.preventDefault();
      if (!row.expanded) toggle(row.path, true);
      else if (rows[index + 1]?.parent === row.path) focusRow(rows[index + 1]?.path);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (row.type === "folder" && row.expanded && !query) toggle(row.path, false);
      else if (row.parent) focusRow(row.parent);
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(row);
    } else if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      openMenu(row, rect.left + 24, rect.bottom);
    }
  };
  const failure = query
    ? found.error
    : listed.find((result, i) => result.isError && !(paths[i] && gone(result.error)))?.error;
  return (
    <section className="docs-tree" aria-label={t("documents.tree")}>
      {failure != null && <ErrorMessage error={failure} />}
      {actionError !== undefined && <ErrorMessage error={actionError} />}
      {notice && (
        <p role="status" data-tree-notice>
          {notice}
        </p>
      )}
      {query && found.data && !found.data.paths.length && <p role="status">{t("documents.noMatches")}</p>}
      {query && found.data?.truncated && (
        <p role="status" data-tree-more>
          {t("documents.moreMatches")}
        </p>
      )}
      {!query && truncated.has("") && (
        <p role="status" className="tree-truncated" data-tree-truncated>
          {t("documents.treeTruncated")}
        </p>
      )}
      <div ref={tree} role="tree" aria-label={t("documents.tree")} data-docs-tree>
        {rows.map((row, index) => {
          const doc = row.type === "file" ? byPath.get(row.path) : undefined;
          const summary = row.type === "folder" ? summaries.get(row.path) : undefined;
          const status = doc ? describe(doc) : undefined;
          const StatusIcon = doc ? statusIcons[doc.status] : undefined;
          return (
            <div
              key={row.path}
              role="treeitem"
              className="tree-row"
              style={{ paddingInlineStart: `${(row.level - 1) * 1.1 + 0.3}rem` }}
              aria-level={row.level}
              aria-expanded={row.type === "folder" ? row.expanded : undefined}
              aria-selected={row.path === current}
              tabIndex={row.path === current ? 0 : -1}
              data-tree-path={row.path}
              data-tree-type={row.type}
              data-document={doc ? row.path : undefined}
              data-status={doc?.status}
              data-indexed={row.type === "file" ? String(!!doc) : undefined}
              data-ignored={row.ignored ? "true" : undefined}
              onFocus={() => setActive(row.path)}
              onClick={() => {
                setActive(row.path);
                activate(row);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(row, event.clientX, event.clientY);
              }}
              onKeyDown={(event) => onKey(event, row, index)}
            >
              {row.type === "folder" ? (
                row.expanded ? (
                  <ChevronDown aria-hidden="true" />
                ) : (
                  <ChevronRight aria-hidden="true" />
                )
              ) : (
                <span className="tree-file-mark" aria-hidden="true" />
              )}
              <span className="tree-name">{row.name}</span>
              {summary && (
                <span
                  className="tree-count"
                  data-folder-count
                  title={t("documents.folderCount", { count: summary.count })}
                >
                  {summary.count}
                </span>
              )}
              {summary?.problems && (
                <span
                  className="tree-problems"
                  data-folder-problems
                  role="img"
                  aria-label={t("documents.folderProblems")}
                >
                  !
                </span>
              )}
              {status !== undefined && StatusIcon && (
                <span className="tree-status" data-doc-status title={status}>
                  <StatusIcon aria-hidden="true" />
                  <span className="sr-only">{status}</span>
                </span>
              )}
              {row.ignored ? (
                <span className="sr-only">{t("documents.ignored")}</span>
              ) : (
                row.type === "file" && !doc && <span className="sr-only">{t("documents.notIndexed")}</span>
              )}
              {row.type === "folder" && row.expanded && truncated.has(row.path) && (
                <span className="tree-truncated" data-tree-truncated>
                  {t("documents.treeTruncated")}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {menu && (
        <TreeMenu
          label={t("documents.rowActions", { name: menu.row.name })}
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.row)}
          close={(restore) => {
            setMenu(undefined);
            if (restore) focusRow(menu.row.path);
          }}
        />
      )}
      {properties && (
        <TreeProperties
          workbenchId={workbenchId}
          path={properties.path}
          name={properties.name}
          type={properties.type}
          ignored={properties.ignored}
          doc={properties.type === "file" ? byPath.get(properties.path) : undefined}
          count={summaries.get(properties.path)?.count ?? 0}
          describe={describe}
          close={() => setProperties(undefined)}
        />
      )}
    </section>
  );
}
/** Attribute value escaping without CSS.escape (absent in jsdom): quotes and backslashes only. */
function CSS_ESCAPE(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
