// REQ-UX-28ad0002
import {
  type GitComparison,
  type GitDiffResponse,
  type GitHistoryResponse,
  parseRef,
  type RasterFormat,
  referenceLabel,
  type ViewerContent,
  veraError,
  workbenchIdSchema,
} from "@vera/shared";
import {
  createContext,
  lazy,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { readTabs, type StoredTabs, writeTabs } from "../../lib/document-tabs-store.js";
import { Markdown } from "../session/markdown.js";
import { type FileMode, type FileModeInfo, readFileMode, rememberFileMode } from "./file-mode.js";
import type { HexFile } from "./hex-source.js";
import { HexViewer } from "./hex-viewer.js";
import type { ImageFile } from "./image-source.js";
import { ImageViewer } from "./image-viewer.js";
import type { LargeTextFile } from "./large-text-source.js";
import { LargeTextViewer } from "./large-text-viewer.js";
import type { ZoomRequest } from "./pdf-viewer.js";
import { readTextFile } from "./read-text-file.js";
import { TextViewer } from "./text-viewer.js";

const PdfViewer = lazy(() => import("./pdf-viewer.js"));
// Retain exact portable target variants without workbench identity supplied by callers.
export type ViewerTarget =
  | { gitHistory: { path: string; indexLease: number } }
  | { gitDiff: { path: string; indexLease: number; comparison: GitComparison } }
  | { runId: string }
  | { path: string }
  | { ref: string }
  | { downloadId: string }
  /**
   * A workbench file shown as plain text, indexed or not (TASK-66b7d4aa); `ignored` files have no
   * Open in default app, which PathGuard refuses (TASK-b34f2cc7).
   */
  | { textPath: string; ignored?: boolean; hex?: true }
  | { sessionId: string; messageId: string; ref: string };
const ViewerContext = createContext<((target: ViewerTarget, imageFormat?: RasterFormat) => void) | undefined>(
  undefined,
);
/** Opens a target in its document tab of the chat area (TASK-79f6ffd3). */
export function useDocumentViewer() {
  return useContext(ViewerContext);
}

/** Where a document was left: the PDF page, the first shown text line or a scroll offset. */
export type DocumentPlace = { page: number } | { line: number } | { scroll: number } | { offset: number };
export interface DocumentTab {
  key: string;
  target: ViewerTarget;
  label: string;
  title: string;
  content?: ViewerContent | undefined;
  gitDiff?: GitDiffResponse | undefined;
  gitHistory?: GitHistoryResponse | undefined;
  /** Display-masked small-file bytes, transient and invalidated with the content attempt. */
  textBytes?: Uint8Array | undefined;
  largeText?: LargeTextFile | undefined;
  hexFile?: HexFile | undefined;
  imageFile?: ImageFile | undefined;
  imageFormat?: RasterFormat | undefined;
  modeInfo?: FileModeInfo | undefined;
  modeChoice?: FileMode | undefined;
  rememberMode?: boolean | undefined;
  error?: unknown;
  /** Bumped by every open of the tab and by Retry; a load answers only its own attempt. */
  attempt: number;
}
/** The Chat tab's key in a session's tab set. */
export const CHAT = "chat";
interface TabSet {
  tabs: DocumentTab[];
  active: string;
}
const EMPTY: TabSet = { tabs: [], active: CHAT };

function retiredGitTarget(target: ViewerTarget, lease: number | undefined) {
  if ("gitHistory" in target) return target.gitHistory.indexLease !== lease;
  return "gitDiff" in target && target.gitDiff.indexLease !== lease;
}

function currentGitTabs(set: TabSet, lease: number | undefined): TabSet {
  const tabs = set.tabs.filter(({ target }) => !retiredGitTarget(target, lease));
  if (tabs.length === set.tabs.length) return set;
  return { tabs, active: tabs.some((tab) => tab.key === set.active) ? set.active : CHAT };
}

const displayName = (path: string) =>
  path.replace(/__vera_(?:display|reference)_[A-Za-z0-9_-]+\.?/g, "[REDACTED]");
const sourcePath = (path: string) => path.replace(/\/__vera_reference_[A-Za-z0-9_-]+\.$/, "");
const fileName = (path: string) => path.split("/").at(-1) || path;
/** One tab per document: the workbench path, the artifact or the download (REQ-FUNC-89161a95). */
export function documentKey(target: ViewerTarget): string {
  if ("gitHistory" in target) return `git-history:${target.gitHistory.path}`;
  if ("gitDiff" in target) return `git-diff:${target.gitDiff.comparison}:${target.gitDiff.path}`;
  if ("runId" in target) return `run:${target.runId}`;
  if ("downloadId" in target) return `download:${target.downloadId}`;
  if ("textPath" in target) return `file:${target.textPath}`;
  if ("path" in target) return `file:${target.path}`;
  const parsed = parseRef(target.ref);
  if (!parsed || parsed.kind === "help") return `ref:${target.ref}`;
  return parsed.kind === "artifact" ? `artifact:${parsed.name}` : `file:${sourcePath(parsed.path)}`;
}
function describe(target: ViewerTarget, download: string): { label: string; title: string } {
  if ("gitDiff" in target || "gitHistory" in target) {
    const path = displayName("gitDiff" in target ? target.gitDiff.path : target.gitHistory.path);
    return { label: fileName(path), title: path };
  }
  if ("runId" in target) return { label: `${target.runId}.log`, title: `.vera/runs/${target.runId}.log` };
  if ("downloadId" in target) return { label: download, title: download };
  if ("textPath" in target)
    return { label: fileName(displayName(target.textPath)), title: displayName(target.textPath) };
  if ("path" in target) return { label: fileName(displayName(target.path)), title: displayName(target.path) };
  const parsed = parseRef(target.ref);
  if (!parsed || parsed.kind === "help") return { label: referenceLabel(target.ref), title: target.ref };
  return parsed.kind === "artifact"
    ? { label: parsed.name, title: parsed.name }
    : { label: fileName(displayName(sourcePath(parsed.path))), title: displayName(sourcePath(parsed.path)) };
}

interface TabsState {
  workbenchId: string;
  tabs: DocumentTab[];
  active: string;
  select: (key: string) => void;
  close: (key: string) => void;
  /** Closes several tabs; `keep` is selected when the selected tab is among them (TASK-6c4aeed8). */
  closeMany: (keys: readonly string[], keep: string) => void;
  /** Moves a document tab before another one, or to the end with `null`. */
  move: (key: string, before: string | null) => void;
  retry: (key: string) => void;
  setMode: (key: string, mode: FileMode) => void;
  /** The place a tab was left at, given back when its document mounts again (REQ-UX-1f53a583). */
  place: (key: string) => DocumentPlace | undefined;
  setPlace: (key: string, place: DocumentPlace) => void;
  /** The control that opened a tab's document, for Escape to return to (REQ-UX-d64f086f). */
  opener: (key: string) => HTMLElement | null;
  /** Set by open and consumed once by the opened document, so selecting a tab never steals focus. */
  focusRequest: { current: boolean };
}
const TabsContext = createContext<TabsState | undefined>(undefined);
export function useDocumentTabs() {
  return useContext(TabsContext);
}

/**
 * The open documents of each session as tabs of the chat area (TASK-79f6ffd3). `scope` names the
 * session (`<workbench>/<session>`); every session keeps its own tabs for the application run.
 * `reveal` asks the app to show the chat area when a document opens behind another page.
 */
export function DocumentViewerProvider({
  workbenchId,
  scope: contextScope,
  sessionId,
  gitLease,
  reveal,
  children,
}: {
  workbenchId: string;
  scope?: string;
  /** The session whose tabs are saved and restored (TASK-061fe00e); none keeps them for the run only. */
  sessionId?: string | undefined;
  gitLease?: number | undefined;
  reveal?: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const scope = contextScope ?? workbenchId;
  const scopeOwners = useRef(new Map<string, string>());
  useEffect(() => {
    scopeOwners.current.set(scope, workbenchId);
  }, [scope, workbenchId]);
  const [sets, setSets] = useState<ReadonlyMap<string, TabSet>>(new Map());
  const selectedSet = sets.get(scope) ?? EMPTY;
  const current = useMemo(() => currentGitTabs(selectedSet, gitLease), [selectedSet, gitLease]);
  // Attempts come from one counter, so a closed and reopened tab never takes an older answer.
  const attempts = useRef(0);
  const places = useRef(new Map<string, DocumentPlace>()),
    openers = useRef(new Map<string, HTMLElement | null>()),
    focusRequest = useRef(false);
  const latestSets = useRef(sets);
  const seen = useRef(new Map<string, TabSet>());
  latestSets.current = sets;
  useEffect(() => {
    for (const [owner, set] of latestSets.current) {
      for (const tab of set.tabs) {
        if (!retiredGitTarget(tab.target, gitLease)) continue;
        const key = `${owner}\n${tab.key}`;
        openers.current.delete(key);
        places.current.delete(key);
      }
    }
    for (const [owner, set] of seen.current) seen.current.set(owner, currentGitTabs(set, gitLease));
    setSets((map) => {
      const next = new Map(map);
      for (const [owner, set] of map) next.set(owner, currentGitTabs(set, gitLease));
      return [...next].every(([owner, set]) => map.get(owner) === set) ? map : next;
    });
  }, [gitLease]);
  const change = useCallback(
    (update: (set: TabSet) => TabSet) =>
      setSets((map) => {
        const next = update(map.get(scope) ?? EMPTY);
        return new Map(map).set(scope, next);
      }),
    [scope],
  );
  const download = t("downloads.title");
  const open = useCallback(
    (target: ViewerTarget, imageFormat?: RasterFormat) => {
      if (retiredGitTarget(target, gitLease)) return;
      const key = documentKey(target);
      const modeChoice: FileMode | undefined = imageFormat && "path" in target ? "rendered" : undefined;
      // Reopening from inside a document keeps the control that first opened it.
      const active = document.activeElement as HTMLElement | null;
      if (!active?.closest("[data-source-current]")) openers.current.set(`${scope}\n${key}`, active);
      places.current.delete(`${scope}\n${key}`);
      focusRequest.current = true;
      change((set) => {
        const known = set.tabs.find((tab) => tab.key === key);
        const { label, title } = describe(target, download);
        const tabs = known
          ? set.tabs.map((tab) =>
              tab.key === key
                ? {
                    ...tab,
                    target,
                    // A download keeps the file name it learned when it loaded.
                    label: "downloadId" in target ? tab.label : label,
                    title: "downloadId" in target ? tab.title : title,
                    content: undefined,
                    gitDiff: undefined,
                    gitHistory: undefined,
                    textBytes: undefined,
                    largeText: undefined,
                    hexFile: undefined,
                    imageFile: undefined,
                    modeInfo: undefined,
                    modeChoice,
                    imageFormat,
                    rememberMode: "textPath" in target && target.hex === true,
                    error: undefined,
                    attempt: ++attempts.current,
                  }
                : tab,
            )
          : [
              ...set.tabs,
              {
                key,
                target,
                label,
                title,
                modeChoice,
                imageFormat,
                rememberMode: "textPath" in target && target.hex === true,
                attempt: ++attempts.current,
              },
            ];
        return { tabs, active: key };
      });
      reveal?.();
    },
    [scope, change, download, reveal, gitLease],
  );
  const select = useCallback((key: string) => change((set) => ({ ...set, active: key })), [change]);
  const close = useCallback(
    (key: string) => {
      places.current.delete(`${scope}\n${key}`);
      openers.current.delete(`${scope}\n${key}`);
      change((set) => {
        const index = set.tabs.findIndex((tab) => tab.key === key);
        if (index < 0) return set;
        const tabs = set.tabs.filter((tab) => tab.key !== key);
        // The closed tab's right neighbour takes its place, else the left one, else Chat.
        const active = set.active === key ? (tabs[index]?.key ?? tabs[index - 1]?.key ?? CHAT) : set.active;
        return { tabs, active };
      });
    },
    [scope, change],
  );
  const closeMany = useCallback(
    (keys: readonly string[], keep: string) => {
      for (const key of keys) {
        places.current.delete(`${scope}\n${key}`);
        openers.current.delete(`${scope}\n${key}`);
      }
      change((set) => {
        const tabs = set.tabs.filter((tab) => !keys.includes(tab.key));
        return { tabs, active: keys.includes(set.active) ? keep : set.active };
      });
    },
    [scope, change],
  );
  const move = useCallback(
    (key: string, before: string | null) =>
      change((set) => {
        const moving = set.tabs.find((tab) => tab.key === key);
        if (!moving || key === before) return set;
        const rest = set.tabs.filter((tab) => tab.key !== key);
        const at = before === null ? rest.length : rest.findIndex((tab) => tab.key === before);
        if (at < 0) return set;
        return { ...set, tabs: [...rest.slice(0, at), moving, ...rest.slice(at)] };
      }),
    [change],
  );
  const retry = useCallback(
    (key: string) => {
      // The retried document takes focus again once it loads.
      focusRequest.current = true;
      change((set) => ({
        ...set,
        tabs: set.tabs.map((tab) =>
          tab.key === key
            ? {
                ...tab,
                content: undefined,
                gitDiff: undefined,
                gitHistory: undefined,
                textBytes: undefined,
                largeText: undefined,
                hexFile: undefined,
                imageFile: undefined,
                error: undefined,
                attempt: ++attempts.current,
              }
            : tab,
        ),
      }));
    },
    [change],
  );
  const setMode = useCallback(
    (key: string, mode: FileMode) => {
      const tab = current.tabs.find((entry) => entry.key === key);
      const info = tab?.modeInfo;
      if (!info?.modes.includes(mode)) return;
      rememberFileMode(localStorage, info.extension, mode);
      const switching = info.mode !== mode;
      if (switching) {
        places.current.delete(`${scope}\n${key}`);
        focusRequest.current = true;
      }
      change((set) => ({
        ...set,
        tabs: set.tabs.map((entry) =>
          entry.key === key
            ? {
                ...entry,
                modeChoice: mode,
                rememberMode: false,
                modeInfo: { ...info, mode },
                target:
                  "textPath" in entry.target
                    ? {
                        textPath: entry.target.textPath,
                        ...(entry.target.ignored === undefined ? {} : { ignored: entry.target.ignored }),
                      }
                    : entry.target,
                ...(switching
                  ? {
                      content: undefined,
                      gitDiff: undefined,
                      gitHistory: undefined,
                      textBytes: undefined,
                      largeText: undefined,
                      hexFile: undefined,
                      imageFile: undefined,
                      error: undefined,
                      attempt: ++attempts.current,
                    }
                  : {}),
              }
            : entry,
        ),
      }));
    },
    [current.tabs, scope, change],
  );
  // ---- Saving and restoring a session's tabs in localStorage (TASK-061fe00e).
  /** Sessions whose stored tabs were read (and checked) in this run; only those are saved. */
  const restored = useRef(new Set<string>());
  const owners = useRef(new Map<string, { workbenchId: string; sessionId: string }>());
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    for (const owned of pending.current) {
      const owner = owners.current.get(owned);
      if (!owner) continue;
      const set = latestSets.current.get(owned) ?? EMPTY;
      const persistable = set.tabs.flatMap((tab) => {
        if ("gitDiff" in tab.target || "gitHistory" in tab.target) return [];
        const place = places.current.get(`${owned}\n${tab.key}`);
        return [{ key: tab.key, target: tab.target, ...(place ? { place } : {}) }];
      });
      const record: StoredTabs = {
        version: 1,
        active: persistable.some((tab) => tab.key === set.active) ? set.active : CHAT,
        tabs: persistable.map(({ key: _key, ...tab }) => tab),
      };
      writeTabs(localStorage, owner.workbenchId, owner.sessionId, record);
    }
    pending.current.clear();
  }, []);
  const schedule = useCallback(
    (owned: string) => {
      if (!restored.current.has(owned) || !owners.current.has(owned)) return;
      pending.current.add(owned);
      timer.current ??= setTimeout(flush, 500);
    },
    [flush],
  );
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);
  // Every change of the shown session's tab set is saved; merely showing a session writes nothing.
  useEffect(() => {
    if (seen.current.get(scope) === current) return;
    const first = !seen.current.has(scope);
    seen.current.set(scope, current);
    if (!first) schedule(scope);
  }, [current, scope, schedule]);
  // A session's stored tabs come back the first time it is shown in a run, without those whose
  // documents are gone; tabs opened meanwhile stay after them.
  useEffect(() => {
    if (!sessionId || restored.current.has(scope) || !workbenchId) return;
    owners.current.set(scope, { workbenchId, sessionId });
    const record = readTabs(localStorage, workbenchId, sessionId);
    // The record's schema mirrors ViewerTarget and DocumentPlace; it only spells optionals out.
    const stored = record && {
      active: record.active,
      tabs: record.tabs.map((tab) => ({
        target: tab.target as ViewerTarget,
        place: tab.place as DocumentPlace | undefined,
      })),
    };
    if (!stored?.tabs.length) {
      restored.current.add(scope);
      return;
    }
    const owned = scope;
    let alive = true;
    void (async () => {
      const keys = stored.tabs.map((tab) => documentKey(tab.target));
      const downloads = keys.some((key) => key.startsWith("download:"))
        ? await api
            .invoke("downloads.list", { workbenchId })
            .then((result) => new Set(result.downloads.map((d) => `download:${d.downloadId}`)))
            .catch(() => undefined)
        : undefined;
      const artifacts = keys.some((key) => key.startsWith("artifact:"))
        ? await api
            .invoke("artifacts.list", { sessionId })
            .then((list) => new Set(list.map((a) => `artifact:${a.name}`)))
            .catch(() => undefined)
        : undefined;
      const exists = await Promise.all(
        keys.map(async (key) => {
          if (key.startsWith("download:")) return !downloads || downloads.has(key);
          if (key.startsWith("artifact:")) return !artifacts || artifacts.has(key);
          if (!key.startsWith("file:")) return true;
          try {
            await api.invoke("docs.stat", { workbenchId, path: key.slice(5) });
            return true;
          } catch (error) {
            // Only a document that is gone is left out; any other failure shows in its tab.
            return (error as { code?: unknown } | null)?.code !== "NOT_FOUND";
          }
        }),
      );
      if (!alive) return;
      const kept = stored.tabs.filter((_, i) => exists[i]);
      setSets((map) => {
        const live = map.get(owned) ?? EMPTY;
        // A document opened while the check ran keeps its live tab, target and place.
        const liveKeys = new Set(live.tabs.map((tab) => tab.key));
        const fresh = kept.filter((tab) => !liveKeys.has(documentKey(tab.target)));
        for (const tab of fresh)
          if (tab.place) places.current.set(`${owned}\n${documentKey(tab.target)}`, tab.place);
        const restoredTabs: DocumentTab[] = fresh.map((tab) => ({
          key: documentKey(tab.target),
          target: tab.target,
          ...(documentKey(tab.target).startsWith("file:")
            ? { label: "[REDACTED]", title: "[REDACTED]" }
            : describe(tab.target, download)),
          attempt: ++attempts.current,
        }));
        const restoredKeys = new Set(restoredTabs.map((tab) => tab.key));
        // Keep an explicit Chat selection, including before the first document has restored.
        const active = map.has(owned) ? live.active : restoredKeys.has(stored.active) ? stored.active : CHAT;
        return new Map(map).set(owned, { tabs: [...restoredTabs, ...live.tabs], active });
      });
      restored.current.add(owned);
      // A record that lost tabs is rewritten without them.
      if (kept.length !== stored.tabs.length) schedule(owned);
    })();
    return () => {
      alive = false;
    };
  }, [scope, sessionId, workbenchId, download, schedule]);
  // A tab loads when it is first selected, once per attempt; switching back reuses the content, and
  // a session's restored tabs cost nothing until they are shown.
  const loading = useRef(new Set<string>());
  useEffect(() => {
    for (const tab of current.tabs) {
      if (tab.key !== current.active) continue;
      const request = `${scope}\n${tab.key}\n${tab.attempt}`;
      if (
        tab.content ||
        tab.gitDiff ||
        tab.gitHistory ||
        tab.error !== undefined ||
        loading.current.has(request)
      )
        continue;
      loading.current.add(request);
      const { target, key, attempt } = tab;
      const requestId = `display:${attempt}`;
      const settle = (
        result: Pick<
          DocumentTab,
          | "content"
          | "gitDiff"
          | "gitHistory"
          | "textBytes"
          | "largeText"
          | "hexFile"
          | "imageFile"
          | "modeInfo"
          | "error"
        >,
      ) =>
        setSets((map) => {
          const set = map.get(scope);
          const found = set?.tabs.find((entry) => entry.key === key);
          // A closed, reopened or retried tab ignores this late answer.
          if (!set || !found || found.attempt !== attempt) return map;
          const title =
            result.gitHistory?.displayPath ??
            result.gitDiff?.displayPath ??
            (result.content && !("runId" in target)
              ? (result.content.displayPath ?? displayName(result.content.path))
              : undefined);
          const name = title === undefined ? undefined : fileName(title);
          return new Map(map).set(scope, {
            ...set,
            tabs: set.tabs.map((entry) =>
              entry.key === key
                ? {
                    ...entry,
                    ...result,
                    ...(name ? { label: name, title: title ?? name } : {}),
                  }
                : entry,
            ),
          });
        });
      if ("gitHistory" in target) {
        const query = { workbenchId, ...target.gitHistory };
        void api
          .invoke("git.history", query)
          .then((result) => {
            if (
              result.workbenchId !== workbenchId ||
              result.indexLease !== query.indexLease ||
              result.path !== query.path
            )
              throw veraError("CONFLICT");
            settle({ gitHistory: result });
          })
          .catch((failure: unknown) => settle({ error: failure ?? veraError("INTERNAL") }))
          .finally(() => loading.current.delete(request));
        continue;
      }
      if ("gitDiff" in target) {
        const query = { workbenchId, ...target.gitDiff };
        void api
          .invoke("git.diff", query)
          .then((result) => {
            if (
              result.workbenchId !== workbenchId ||
              result.indexLease !== query.indexLease ||
              result.path !== query.path ||
              result.comparison !== query.comparison
            )
              throw veraError("CONFLICT");
            settle({ gitDiff: result });
          })
          .catch((failure: unknown) => settle({ error: failure ?? veraError("INTERNAL") }))
          .finally(() => loading.current.delete(request));
        continue;
      }
      const call =
        "runId" in target
          ? api.invoke("runs.log", { workbenchId, id: target.runId, full: true }).then((log) => {
              if (log.id !== target.runId) throw veraError("NOT_FOUND");
              // A log longer than the host sends arrives as its tail; the first line says so.
              const lines = (log.truncated ? `[${t("runs.tailOnly")}]\n${log.text}` : log.text).split("\n");
              return {
                workbenchId,
                content: {
                  kind: "text" as const,
                  path: `.vera/runs/${target.runId}.log`,
                  ref: null,
                  snippet: "",
                  lines,
                  start: 1,
                  end: lines.length,
                },
              };
            })
          : "path" in target || "textPath" in target
            ? readFileMode(
                workbenchId,
                "path" in target ? target.path : target.textPath,
                requestId,
                tab.modeChoice ?? ("textPath" in target && target.hex ? "hex" : undefined),
                (modeInfo) => {
                  const live = latestSets.current.get(scope)?.tabs.find((entry) => entry.key === key);
                  if (tab.rememberMode && live?.attempt === attempt && "textPath" in target) {
                    rememberFileMode(localStorage, modeInfo.extension, "hex");
                    change((set) => ({
                      ...set,
                      tabs: set.tabs.map((entry) =>
                        entry.key === key && entry.attempt === attempt
                          ? {
                              ...entry,
                              rememberMode: false,
                              modeChoice: "hex",
                              target: {
                                textPath: target.textPath,
                                ...(target.ignored === undefined ? {} : { ignored: target.ignored }),
                              },
                            }
                          : entry,
                      ),
                    }));
                  }
                  settle({ modeInfo });
                },
                tab.imageFormat,
              )
            : "downloadId" in target
              ? api.invoke("downloads.open", { workbenchId, downloadId: target.downloadId })
              : api.invoke("docs.open", { workbenchId, ...target, requestId }).then(async (result) => {
                  if (result.content.kind !== "text" || !result.content.byteSource) return result;
                  if (
                    result.workbenchId !== workbenchId ||
                    (result.requestId !== requestId && result.content.ref !== target.ref)
                  )
                    return result;
                  const text = await readTextFile(workbenchId, result.content.path, result.content);
                  return {
                    ...result,
                    content: text.content,
                    textBytes: text.textBytes,
                    largeText: text.largeText,
                  };
                });
      void call
        .then((result) => {
          if (
            result.workbenchId !== workbenchId ||
            ((!("requestId" in result) || result.requestId !== requestId) &&
              ("runId" in target
                ? result.content.path !== `.vera/runs/${target.runId}.log`
                : "downloadId" in target
                  ? !("downloadId" in result) || result.downloadId !== target.downloadId
                  : "textPath" in target
                    ? result.content.path !== target.textPath
                    : "ref" in target
                      ? result.content.ref !== target.ref
                      : result.content.path !== target.path))
          )
            throw veraError("NOT_FOUND");
          settle({
            content: result.content,
            textBytes: "textBytes" in result ? result.textBytes : undefined,
            largeText: "largeText" in result ? result.largeText : undefined,
            hexFile: "hexFile" in result ? result.hexFile : undefined,
            imageFile: "imageFile" in result ? result.imageFile : undefined,
            modeInfo: "modeInfo" in result ? result.modeInfo : undefined,
            error: undefined,
          });
        })
        .catch((failure: unknown) => settle({ content: undefined, error: failure ?? veraError("INTERNAL") }))
        .finally(() => loading.current.delete(request));
    }
  }, [current.tabs, current.active, scope, workbenchId, change, t]);
  useEffect(() => {
    const refresh = (owner?: string) =>
      setSets(
        (map) =>
          new Map(
            [...map].map(([ownedScope, set]) => {
              if (owner !== undefined && scopeOwners.current.get(ownedScope) !== owner)
                return [ownedScope, set];
              return [
                ownedScope,
                {
                  ...set,
                  tabs: set.tabs.map((tab) =>
                    "downloadId" in tab.target
                      ? tab
                      : {
                          ...tab,
                          label: "runId" in tab.target ? tab.label : "[REDACTED]",
                          title: "runId" in tab.target ? tab.title : "[REDACTED]",
                          content: undefined,
                          gitDiff: undefined,
                          gitHistory: undefined,
                          textBytes: undefined,
                          largeText: undefined,
                          hexFile: undefined,
                          imageFile: undefined,
                          error: undefined,
                          attempt: ++attempts.current,
                        },
                  ),
                },
              ];
            }),
          ),
      );
    const offApp = api.subscribe("app", (event) => {
      // Theme, language and layout changes leave masked content as it is; the tabs keep their documents.
      if (event.type === "settings.changed" && event.masking !== false) refresh();
    });
    const offWorkbench = workbenchIdSchema.safeParse(workbenchId).success
      ? api.subscribe("workbench", workbenchId, (event) => {
          if (event.type === "config.changed") refresh(workbenchId);
        })
      : () => {};
    return () => {
      offApp();
      offWorkbench();
    };
  }, [workbenchId]);
  const metadataAttempts = useRef(new Map<string, number>());
  useEffect(() => {
    for (const tab of current.tabs) {
      if (!tab.key.startsWith("file:") || tab.label !== "[REDACTED]") continue;
      const owner = `${scope}\n${tab.key}`;
      if (metadataAttempts.current.get(owner) === tab.attempt) continue;
      metadataAttempts.current.set(owner, tab.attempt);
      void api
        .invoke("docs.stat", { workbenchId, path: tab.key.slice(5) })
        .then((result) => {
          if (result.workbenchId !== workbenchId) return;
          const title = result.properties.displayPath ?? displayName(result.properties.path);
          setSets((map) => {
            const set = map.get(scope);
            if (!set) return map;
            return new Map(map).set(scope, {
              ...set,
              tabs: set.tabs.map((entry) =>
                entry.key === tab.key && entry.attempt === tab.attempt
                  ? { ...entry, label: fileName(title), title }
                  : entry,
              ),
            });
          });
        })
        .catch(() => {});
    }
  }, [current.tabs, scope, workbenchId]);
  const place = useCallback((key: string) => places.current.get(`${scope}\n${key}`), [scope]);
  const setPlace = useCallback(
    (key: string, value: DocumentPlace) => {
      places.current.set(`${scope}\n${key}`, value);
      schedule(scope);
    },
    [scope, schedule],
  );
  const opener = useCallback((key: string) => openers.current.get(`${scope}\n${key}`) ?? null, [scope]);
  const state = useMemo(
    () => ({
      workbenchId,
      tabs: current.tabs,
      active: current.active,
      select,
      close,
      closeMany,
      move,
      retry,
      setMode,
      place,
      setPlace,
      opener,
      focusRequest,
    }),
    [workbenchId, current, select, close, closeMany, move, retry, setMode, place, setPlace, opener],
  );
  return (
    <ViewerContext.Provider value={open}>
      <TabsContext.Provider value={state}>{children}</TabsContext.Provider>
    </ViewerContext.Provider>
  );
}

export function DocumentBody({
  content,
  bytes,
  largeText,
  hexFile,
  imageFile,
  place,
  onPlace,
  retry,
  findRequest = 0,
  gotoRequest = 0,
  zoomRequest,
}: {
  content: ViewerContent;
  bytes?: Uint8Array | undefined;
  largeText?: LargeTextFile | undefined;
  hexFile?: HexFile | undefined;
  imageFile?: ImageFile | undefined;
  /** Where the document was left; without it the cited unit is shown (REQ-UX-1f53a583). */
  place?: DocumentPlace | undefined;
  onPlace?: ((place: DocumentPlace) => void) | undefined;
  retry?: (() => void) | undefined;
  /** Bumped by Ctrl+F and Ctrl+G in the tab (TASK-4c04273a). */
  findRequest?: number;
  gotoRequest?: number;
  /** A zoom step from the document menu (TASK-0ec8c0d0); PDFs only. */
  zoomRequest?: ZoomRequest | undefined;
}) {
  const { t } = useTranslation();
  const node = useRef<HTMLElement>(null);
  const kept = useRef(place);
  const report = useRef(onPlace);
  report.current = onPlace;
  // Scrolled documents report their offset as their place (paged and line views report their own).
  useEffect(() => {
    const body = node.current;
    if (!body) return;
    const scrolled = () => report.current?.({ scroll: body.scrollTop });
    body.addEventListener("scroll", scrolled, { passive: true });
    return () => body.removeEventListener("scroll", scrolled);
  }, []);
  useEffect(() => {
    if (kept.current && "scroll" in kept.current) {
      if (node.current) node.current.scrollTop = kept.current.scroll;
      return;
    }
    if (content.kind === "presentation") {
      const slide = node.current?.querySelector<HTMLElement>(`[data-slide="${content.page}"]`);
      slide?.scrollIntoView?.({ block: "start" });
      slide?.focus();
    }
    if ("anchor" in content && content.anchor !== null) {
      const anchor = [...(node.current?.querySelectorAll<HTMLElement>("[data-heading]") ?? [])].find(
        (el) => el.dataset.heading === content.anchor,
      );
      anchor?.scrollIntoView?.({ block: "start" });
      anchor?.focus();
    }
  }, [content]);
  if (imageFile) return <ImageViewer file={imageFile} retry={retry} />;
  if (hexFile)
    return (
      <HexViewer
        file={hexFile}
        retry={retry}
        place={place}
        onPlace={onPlace}
        findRequest={findRequest}
        gotoRequest={gotoRequest}
      />
    );
  if (content.kind === "pdf")
    return (
      <PdfViewer
        content={content}
        page={place && "page" in place ? place.page : undefined}
        onPage={(page) => onPlace?.({ page })}
        findRequest={findRequest}
        zoomRequest={zoomRequest}
      />
    );
  if (content.kind === "text" && largeText)
    return (
      <LargeTextViewer
        file={largeText}
        content={content}
        retry={retry}
        place={place}
        onPlace={onPlace}
        findRequest={findRequest}
        gotoRequest={gotoRequest}
      />
    );
  if (content.kind === "text")
    return (
      <TextViewer
        content={content}
        bytes={bytes}
        line={place && "line" in place ? place.line : undefined}
        onLine={(line) => onPlace?.({ line })}
        findRequest={findRequest}
        gotoRequest={gotoRequest}
      />
    );
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: Named document region supports keyboard scrolling.
    <section ref={node} className="document-body" aria-label={t("documents.viewer")} tabIndex={0}>
      {content.kind === "artifact" ? (
        <ArtifactBody content={content.content} mime={content.mime} />
      ) : content.kind === "presentation" ? (
        content.slides.map((text, i) => {
          const slide = i + 1;
          return (
            <section
              key={slide}
              data-slide={slide}
              tabIndex={-1}
              aria-current={slide >= content.page && slide <= content.pageEnd ? "true" : undefined}
            >
              <h3>{t("documents.slide", { number: slide })}</h3>
              <pre>{text}</pre>
            </section>
          );
        })
      ) : (
        content.sections.map((s) => (
          <section
            key={s.slug || "preamble"}
            data-heading={s.slug}
            id={s.slug ? `document-heading-${s.slug}` : undefined}
            tabIndex={-1}
            aria-current={s.slug === content.anchor ? "true" : undefined}
          >
            {content.kind === "markdown" ? <Markdown text={s.text} /> : <pre>{s.text}</pre>}
          </section>
        ))
      )}
    </section>
  );
}
export function ArtifactBody({ content, mime }: { content: string; mime: string }) {
  return mime === "text/markdown" ? <Markdown text={content} /> : <pre>{content}</pre>;
}
