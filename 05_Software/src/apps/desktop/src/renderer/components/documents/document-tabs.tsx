// REQ-UX-388cf31a REQ-UX-89428322 REQ-UX-be7140e4 REQ-UX-d64f086f REQ-REL-6fc27952
// REQ-UX-e0410483 REQ-UX-6ecb6c83 REQ-UX-67abf562 REQ-UX-fd131983 REQ-UX-a45c4384 REQ-UX-968b89b0
// REQ-UX-f261c988 REQ-UX-f5d6e9e4
import { useQuery } from "@tanstack/react-query";
import { veraError } from "@vera/shared";
import { Columns2, Pin, RotateCcw, Search, X } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { ChatBesideTab, DocumentSplitSeparator, useDocumentSplit } from "./document-split.js";
import { useDescribeDocument, useFileActions } from "./file-actions.js";
import { GitDiffView } from "./git-diff-view.js";
import { GitHistoryView } from "./git-history-view.js";
import type { ZoomRequest } from "./pdf-viewer.js";
import { SessionChangeDiff } from "./session-change-diff.js";
import { TabSearch } from "./tab-search.js";
import { TreeMenu, type TreeMenuItem } from "./tree-menu.js";
import { TreeProperties } from "./tree-properties.js";
import { CHAT, DocumentBody, type DocumentTab, useDocumentTabs } from "./viewer-context.js";
import { ViewerToolbarTarget } from "./viewer-toolbar.js";

const tabId = (index: number) => `document-tab-${index}`;
const panelId = (index: number) => `document-panel-${index}`;
/** The workbench file a tab shows, from its document key (`file:<path>`). */
const filePath = (key: string) => (key.startsWith("file:") ? key.slice(5) : undefined);
const focusTab = (index: number) => document.getElementById(tabId(index))?.focus();
/** Focuses a tab by its key; a moved tab is re-inserted by React and loses focus. */
const focusKey = (key: string) =>
  [...document.querySelectorAll<HTMLElement>("[data-tab-key]")]
    .find((tab) => tab.dataset.tabKey === key)
    ?.focus();

/**
 * The chat area: the Chat tab, always first and never closed, and one tab per open document
 * (TASK-79f6ffd3). The conversation stays mounted while a document is shown, so its draft and
 * scroll survive; only the selected document is mounted, at the place it was left. Document tabs
 * move by drag and drop or Ctrl+Shift+PageUp/PageDown, switch with Ctrl+Tab or Ctrl+PageUp/PageDown,
 * close with Ctrl+W, and offer the tab and file actions in their context menu (TASK-6c4aeed8).
 */
export function DocumentTabs({ chat }: { chat: ReactNode }) {
  const { t } = useTranslation();
  const state = useDocumentTabs();
  const scope = state?.scope;
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ scope: string; key: string; x: number; y: number }>();
  const [searchScope, setSearchScope] = useState<string>();
  const searchButton = useRef<HTMLButtonElement>(null);
  const [properties, setProperties] = useState<{ path: string; ignored: boolean }>();
  const [drop, setDrop] = useState<string | null>();
  const dragged = useRef<string | undefined>(undefined);
  const workbenchId = state?.workbenchId ?? "";
  const actions = useFileActions(workbenchId, menu ? filePath(menu.key) : undefined);
  const describe = useDescribeDocument();
  const documents = useQuery({
    queryKey: ["docs.list", workbenchId],
    enabled: !!properties && !!workbenchId,
    queryFn: async () => {
      const result = await api.invoke("docs.list", { workbenchId });
      if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
      return result.documents;
    },
  });
  const keys = [CHAT, ...(state?.tabs ?? []).map((tab) => tab.key)];
  const active = state?.active ?? CHAT;
  const split = useDocumentSplit(root, scope, active !== CHAT);
  const select = state?.select;
  const selectVisible = (key: string) => {
    if (key !== CHAT || !split.visible) select?.(key);
  };
  const closeTab = (key: string) => {
    const index = keys.indexOf(key);
    const wasActive = key === active;
    flushSync(() => state?.close(key));
    // Closing the selected tab moves focus to the tab that replaced it.
    if (wasActive) focusTab(Math.min(index, keys.length - 2));
  };
  const pinGroup = (key: string) => {
    const pinned = state?.tabs.find((tab) => tab.key === key)?.pinned;
    return state?.tabs.filter((tab) => tab.pinned === pinned).map((tab) => tab.key) ?? [];
  };
  /** Moves a document tab one place within its pin group. */
  const shift = (key: string, delta: -1 | 1) => {
    const group = pinGroup(key);
    const index = group.indexOf(key);
    if (index < 0) return;
    if (delta < 0 && index > 0) state?.move(key, group[index - 1] ?? null);
    if (delta > 0 && index < group.length - 1) state?.move(key, group[index + 2] ?? null);
  };
  /** A moved tab is re-inserted by React; it gets its focus back once the move has rendered. */
  const moveFocused = (key: string, delta: -1 | 1) => {
    flushSync(() => shift(key, delta));
    focusKey(key);
  };
  const keysRef = useRef({ keys, active, closeTab, shift, selectVisible, splitVisible: split.visible });
  keysRef.current = { keys, active, closeTab, shift, selectVisible, splitVisible: split.visible };
  const { clear } = actions;
  // An action's message belongs to the moment it ran; another tab clears it.
  useEffect(() => {
    void active;
    clear();
  }, [active, clear]);
  // A menu whose tab closed some other way (Ctrl+W elsewhere, a session switch) goes away.
  const menuGone =
    !!menu && (menu.scope !== state?.scope || !state?.tabs.some((tab) => tab.key === menu.key));
  useEffect(() => {
    if (menuGone) setMenu(undefined);
  }, [menuGone]);
  useEffect(() => {
    setSearchScope((requested) => (requested === scope ? requested : undefined));
    dragged.current = undefined;
    setDrop(undefined);
  }, [scope]);
  useEffect(() => {
    if (!select) return;
    const listener = (event: KeyboardEvent) => {
      // Open dialogs and menus (the tab's or a Files row's) keep their own keys.
      if (event.altKey || event.isComposing || document.querySelector("dialog[open], [data-tree-menu]"))
        return;
      const {
        keys: all,
        active: current,
        closeTab: closing,
        shift: moving,
        selectVisible: choose,
        splitVisible,
      } = keysRef.current;
      const focus = document.activeElement;
      const tabKey = focus?.closest<HTMLElement>("[data-tab-key]")?.dataset.tabKey;
      const origin = splitVisible
        ? (tabKey ?? (focus?.closest("[data-chat-panel]") ? CHAT : current))
        : current;
      const index = Math.max(0, all.indexOf(origin));
      const key = event.key;
      if (event.ctrlKey && (key === "Tab" || ((key === "PageDown" || key === "PageUp") && !event.shiftKey))) {
        event.preventDefault();
        const forward = key === "PageDown" || (key === "Tab" && !event.shiftKey);
        const next = (index + (forward ? 1 : -1) + all.length) % all.length;
        flushSync(() => choose(all[next] ?? CHAT));
        focusTab(next);
      } else if (event.ctrlKey && event.shiftKey && (key === "PageDown" || key === "PageUp")) {
        event.preventDefault();
        if (origin === CHAT) return;
        const focused = document.activeElement?.closest("[data-document-tabs]");
        flushSync(() => moving(current, key === "PageDown" ? 1 : -1));
        if (focused) focusKey(current);
      } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === "w") {
        if (origin === CHAT) return;
        event.preventDefault();
        closing(current);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [select]);
  if (!state) return <>{chat}</>;
  const { tabs } = state;
  const entries = [
    { key: CHAT, label: t("documents.chatTab"), title: t("documents.chatTab") },
    ...tabs.map((tab) => {
      if ("sessionChange" in tab.target)
        return {
          ...tab,
          label: t("changes.diffTab", { path: tab.label }),
          title: t("changes.diffTab", { path: tab.title }),
        };
      if ("gitHistory" in tab.target)
        return {
          ...tab,
          label: t("gitHistory.tab", { path: tab.label }),
          title: t("gitHistory.tab", { path: tab.title }),
        };
      if (!("gitDiff" in tab.target)) return tab;
      const { comparison } = tab.target.gitDiff;
      const describe = (path: string) =>
        comparison === "staged" ? t("gitDiff.tabStaged", { path }) : t("gitDiff.tabUnstaged", { path });
      return { ...tab, label: describe(tab.label), title: describe(tab.title) };
    }),
  ];
  const selectedIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.key === active),
  );
  const shown = tabs.find((tab) => tab.key === active);
  const splitLabel = split.requested ? t("documents.exitSplit") : t("documents.showBesideChat");
  const menuItems = (tab: DocumentTab): TreeMenuItem[] => {
    const index = keys.indexOf(tab.key);
    const group = pinGroup(tab.key);
    const others = tabs.filter((entry) => entry.key !== tab.key && !entry.pinned).map((entry) => entry.key);
    const right = keys.slice(index + 1).filter((key) => others.includes(key));
    const path = filePath(tab.key);
    const ignored = "textPath" in tab.target && !!tab.target.ignored;
    return [
      { action: "close", label: t("documents.close"), run: () => closeTab(tab.key) },
      {
        action: "close-others",
        label: t("documents.closeOthers"),
        disabled: others.length === 0,
        run: () => state.closeMany(others, tab.key),
      },
      {
        action: "close-right",
        label: t("documents.closeRight"),
        disabled: right.length === 0,
        run: () => state.closeMany(right, tab.key),
      },
      {
        action: "move-left",
        label: t("documents.moveLeft"),
        disabled: group[0] === tab.key,
        run: () => moveFocused(tab.key, -1),
      },
      {
        action: "move-right",
        label: t("documents.moveRight"),
        disabled: group.at(-1) === tab.key,
        run: () => moveFocused(tab.key, 1),
      },
      {
        action: tab.pinned ? "unpin" : "pin",
        label: tab.pinned ? t("documents.unpinTab") : t("documents.pinTab"),
        run: () => {
          flushSync(() => state.togglePin(tab.key));
          focusKey(tab.key);
        },
      },
      {
        action: "show-beside-chat",
        label: t("documents.showBesideChat"),
        run: () => {
          flushSync(() => {
            state.select(tab.key);
            split.open();
          });
          focusKey(tab.key);
        },
      },
      ...(path !== undefined && tab.content?.kind !== "artifact"
        ? actions.items({ path, displayPath: tab.content?.displayPath, type: "file", ignored }, () =>
            setProperties({ path, ignored }),
          )
        : "downloadId" in tab.target
          ? actions.downloadItems(tab.target.downloadId)
          : []),
    ];
  };
  const openMenu = (key: string, x: number, y: number) => {
    if (key === CHAT) return;
    setMenu({ scope: state.scope, key, x, y });
  };
  const menuTab = menu && !menuGone && tabs.find((tab) => tab.key === menu.key);
  const endDrag = () => {
    dragged.current = undefined;
    setDrop(undefined);
  };
  /** Accepts a drop only while a document tab of this strip is dragged. */
  const over = (target: string | null) => (event: ReactDragEvent) => {
    if (dragged.current === undefined || (target !== null && !pinGroup(dragged.current).includes(target)))
      return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDrop(target);
  };
  const dropOn = (target: string | null) => (event: ReactDragEvent) => {
    const key = dragged.current;
    if (key === undefined) return;
    event.preventDefault();
    state.move(key, target);
    endDrag();
  };
  return (
    <div
      ref={root}
      className="document-tabs"
      data-split-view={split.visible || undefined}
      style={split.visible ? ({ "--chat-pane-width": `${split.leftWidth}px` } as CSSProperties) : undefined}
    >
      <div className="document-tab-bar">
        <div
          className="document-tab-strip"
          role="tablist"
          aria-label={t("documents.tabs")}
          aria-multiselectable={split.visible || undefined}
          data-document-tabs
        >
          {entries.map((entry, index) => {
            const document_ = entry.key !== CHAT;
            const pinned = "pinned" in entry && entry.pinned === true;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: drag and drop only; the keyboard moves tabs with Ctrl+Shift+PageUp/PageDown and the tab menu.
              <div
                className="document-tab"
                key={entry.key}
                data-selected={index === selectedIndex || (!document_ && split.visible)}
                data-pinned={pinned || undefined}
                data-drop={drop === entry.key || undefined}
                draggable={document_ || undefined}
                onDragStart={
                  document_
                    ? (event) => {
                        dragged.current = entry.key;
                        event.dataTransfer?.setData("application/x-vera-tab", entry.key);
                        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                      }
                    : undefined
                }
                onDragOver={document_ ? over(entry.key) : undefined}
                onDrop={document_ ? dropOn(entry.key) : undefined}
                onDragEnd={endDrag}
              >
                <button
                  type="button"
                  role="tab"
                  id={tabId(index)}
                  data-tab-key={entry.key}
                  aria-selected={index === selectedIndex || (!document_ && split.visible)}
                  aria-description={pinned ? t("documents.pinnedTab") : undefined}
                  aria-controls={panelId(index)}
                  aria-haspopup={document_ ? "menu" : undefined}
                  tabIndex={index === selectedIndex ? 0 : -1}
                  title={entry.title}
                  onClick={() => selectVisible(entry.key)}
                  onContextMenu={(event) => {
                    if (!document_) return;
                    event.preventDefault();
                    openMenu(entry.key, event.clientX, event.clientY);
                  }}
                  onMouseDown={(event) => {
                    // Middle-button press would start autoscroll; the release closes the tab instead.
                    if (event.button === 1 && document_) event.preventDefault();
                  }}
                  onAuxClick={(event) => {
                    if (event.button === 1 && document_) closeTab(entry.key);
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") {
                      if (!document_) return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      openMenu(entry.key, rect.left, rect.bottom);
                      return;
                    }
                    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing)
                      return;
                    if (event.key === "Delete" && document_) {
                      event.preventDefault();
                      closeTab(entry.key);
                      return;
                    }
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? entries.length - 1
                          : event.key === "ArrowRight"
                            ? (index + 1) % entries.length
                            : event.key === "ArrowLeft"
                              ? (index + entries.length - 1) % entries.length
                              : undefined;
                    const target = next === undefined ? undefined : entries[next];
                    if (next === undefined || !target) return;
                    event.preventDefault();
                    flushSync(() => selectVisible(target.key));
                    focusTab(next);
                  }}
                >
                  {pinned && <Pin className="document-tab-pin" aria-hidden="true" />}
                  {entry.label}
                </button>
                {document_ && (
                  <button
                    type="button"
                    className="document-tab-close"
                    data-action="close-tab"
                    data-tab-label={entry.label}
                    aria-label={t("documents.closeTab", { name: entry.label })}
                    title={t("documents.closeTab", { name: entry.label })}
                    tabIndex={-1}
                    onClick={() => closeTab(entry.key)}
                  >
                    <X aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop target at the strip's end; the keyboard uses Ctrl+Shift+PageDown. */}
          <div
            className="document-tab-strip-end"
            data-tab-strip-end
            data-drop={drop === null || undefined}
            onDragOver={over(null)}
            onDrop={dropOn(null)}
          />
        </div>
        <div className="document-tab-actions">
          <button
            type="button"
            data-action="reopen-tab"
            aria-label={t("documents.reopenTab")}
            title={t("documents.reopenTab")}
            disabled={!state.canReopen}
            onClick={() => {
              flushSync(state.reopen);
              document.querySelector<HTMLElement>('[data-document-tabs] [role="tab"][tabindex="0"]')?.focus();
            }}
          >
            <RotateCcw aria-hidden="true" />
          </button>
          <button
            ref={searchButton}
            type="button"
            data-action="search-tabs"
            aria-label={t("documents.searchTabs")}
            title={t("documents.searchTabs")}
            aria-haspopup="dialog"
            disabled={tabs.length === 0}
            onClick={() => setSearchScope(state.scope)}
          >
            <Search aria-hidden="true" />
          </button>
          <button
            type="button"
            data-action="split-view"
            aria-label={splitLabel}
            title={splitLabel}
            aria-pressed={split.requested}
            disabled={!shown && !split.requested}
            onClick={split.requested ? split.close : split.open}
          >
            <Columns2 aria-hidden="true" />
          </button>
        </div>
      </div>
      {searchScope === state.scope && (
        <TabSearch
          tabs={entries.slice(1)}
          select={(key) => {
            flushSync(() => {
              setSearchScope(undefined);
              state.select(key);
            });
            focusKey(key);
          }}
          dismiss={() => {
            flushSync(() => setSearchScope(undefined));
            searchButton.current?.focus();
          }}
        />
      )}
      <div className="document-tab-notices" data-tab-notices>
        {actions.error !== undefined && <ErrorMessage error={actions.error} />}
        {actions.notice && <p role="status">{actions.notice}</p>}
      </div>
      <div
        className="document-tab-panel"
        data-chat-panel
        role="tabpanel"
        id={panelId(0)}
        aria-labelledby={tabId(0)}
        // Inert, not hidden: the conversation keeps its layout and so its scroll position.
        inert={active !== CHAT && !split.visible}
      >
        <ChatBesideTab.Provider value={split.visible}>{chat}</ChatBesideTab.Provider>
      </div>
      {split.visible && (
        <DocumentSplitSeparator
          chatId={panelId(0)}
          width={split.leftWidth}
          max={split.max}
          resize={split.resize}
        />
      )}
      {shown && (
        <DocumentPanel
          // A new open of the tab remounts its document at the requested place.
          key={`${shown.key}\n${shown.attempt}`}
          tab={shown}
          index={selectedIndex}
          leave={() => {
            const opener = state.opener(shown.key);
            flushSync(() => selectVisible(CHAT));
            // The opener gets focus back when it is still shown; otherwise the Chat tab does.
            if (opener?.isConnected && !opener.closest("[hidden], [inert]")) opener.focus();
            else focusTab(0);
          }}
        />
      )}
      {menu && menuTab && (
        <TreeMenu
          label={t("documents.tabActions", { name: menuTab.label })}
          x={menu.x}
          y={menu.y}
          items={menuItems(menuTab)}
          close={(restore) => {
            setMenu(undefined);
            // Before the item runs (TreeMenu's contract), so a dialog it opens returns focus here.
            if (restore) focusKey(menuTab.key);
          }}
        />
      )}
      {properties && (
        <TreeProperties
          workbenchId={workbenchId}
          path={properties.path}
          type="file"
          ignored={properties.ignored}
          doc={documents.data?.find((doc) => doc.path === properties.path)}
          count={0}
          describe={describe}
          close={() => setProperties(undefined)}
        />
      )}
    </div>
  );
}

function DocumentPanel({ tab, index, leave }: { tab: DocumentTab; index: number; leave: () => void }) {
  const { t } = useTranslation();
  const state = useDocumentTabs();
  const node = useRef<HTMLElement>(null);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [findRequest, setFindRequest] = useState(0);
  const [gotoRequest, setGotoRequest] = useState(0);
  const [zoomRequest, setZoomRequest] = useState<ZoomRequest>();
  // The document menu (TASK-0ec8c0d0): where it opened, the selection to copy and the focus to restore.
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    selection: Range | undefined;
    from: Element | null;
  }>();
  const { content, error } = tab;
  const find = (panel: HTMLElement | null) => {
    const search = panel?.querySelector<HTMLInputElement>("[data-document-search]");
    if (search) search.focus();
    else setFindRequest((value) => value + 1);
  };
  const openMenu = (x: number, y: number) => {
    const panel = node.current;
    if (!panel || !content) return;
    // The selection is kept now: the menu takes focus, and Copy must copy what was selected.
    const current = window.getSelection();
    const range =
      current && current.rangeCount > 0 && !current.isCollapsed ? current.getRangeAt(0) : undefined;
    const inside = range && panel.contains(range.commonAncestorContainer);
    setMenu({ x, y, selection: inside ? range.cloneRange() : undefined, from: document.activeElement });
  };
  const menuItems = (): TreeMenuItem[] => {
    if (!content) return [];
    const copy: TreeMenuItem = {
      action: "copy-text",
      label: t("documents.copy"),
      keys: "Control+C",
      disabled: !menu?.selection,
      run: () => {
        const range = menu?.selection;
        const current = window.getSelection();
        if (!range || !current) return;
        current.removeAllRanges();
        current.addRange(range);
        document.execCommand("copy");
      },
    };
    const findItem: TreeMenuItem = {
      action: "find",
      label: t("documents.find"),
      keys: "Control+F",
      run: () => find(node.current),
    };
    if (tab.hexFile)
      return [
        findItem,
        {
          action: "go-to-offset",
          label: t("documents.hexGoTo"),
          keys: "Control+G",
          run: () => setGotoRequest((value) => value + 1),
        },
      ];
    if (tab.imageFile) return [];
    if (content.kind === "text")
      return [
        copy,
        findItem,
        {
          action: "go-to-line",
          label: t("documents.goToLine"),
          keys: "Control+G",
          run: () => setGotoRequest((value) => value + 1),
        },
      ];
    if (content.kind === "pdf") {
      const zoom = (step: ZoomRequest["step"]) => () =>
        setZoomRequest((value) => ({ step, id: (value?.id ?? 0) + 1 }));
      return [
        copy,
        findItem,
        { action: "zoom-in", label: t("documents.zoomIn"), keys: "Control+=", run: zoom(1) },
        { action: "zoom-out", label: t("documents.zoomOut"), keys: "Control+-", run: zoom(-1) },
        { action: "zoom-reset", label: t("documents.zoomReset"), keys: "Control+0", run: zoom(0) },
      ];
    }
    return [copy];
  };
  useEffect(() => {
    if (!state?.focusRequest.current) return;
    state.focusRequest.current = false;
    // The body may already have focused its cited unit (it renders first when content is ready).
    if (!node.current?.contains(document.activeElement)) node.current?.focus();
  }, [state]);
  if (!state) return null;
  // Only the document: its path is the tab's tooltip and its actions are in the tab's menu.
  return (
    <>
      <section
        ref={node}
        data-source-current
        data-session-change-diff={
          "sessionChange" in tab.target ? tab.target.sessionChange.changeId : undefined
        }
        className="document-tab-panel source-current"
        role="tabpanel"
        id={panelId(index)}
        aria-labelledby={tabId(index)}
        tabIndex={-1}
        onContextMenu={(event) => {
          // The find and line fields keep their own (empty) menu.
          if (!content || (event.target as Element).closest("input")) return;
          event.preventDefault();
          openMenu(event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (
            ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") &&
            !(event.target as Element).closest("input")
          ) {
            event.preventDefault();
            const rect = (event.target as Element).getBoundingClientRect();
            openMenu(rect.left + 16, rect.top + 16);
            return;
          }
          // Ctrl+F finds in text and PDFs, Ctrl+G goes to a text line; each shows its field on demand.
          const mod = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
          const key = event.key.toLowerCase();
          if (mod && key === "f" && !tab.imageFile && (content?.kind === "pdf" || content?.kind === "text")) {
            event.preventDefault();
            event.stopPropagation();
            find(event.currentTarget);
          }
          if (mod && key === "g" && !tab.imageFile && content?.kind === "text") {
            event.preventDefault();
            event.stopPropagation();
            setGotoRequest((value) => value + 1);
          }
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            leave();
          }
        }}
      >
        {tab.modeInfo && (
          <div className="viewer-toolbar-row">
            <fieldset className="viewer-mode-toolbar" aria-label={t("documents.mode")}>
              {tab.modeInfo.modes.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  data-viewer-mode={mode}
                  aria-pressed={tab.modeInfo?.mode === mode}
                  onClick={() => state.setMode(tab.key, mode)}
                >
                  {mode === "rendered"
                    ? t("documents.modeRendered")
                    : mode === "text"
                      ? t("documents.modeText")
                      : t("documents.modeHex")}
                </button>
              ))}
            </fieldset>
            <div className="viewer-toolbar-controls" ref={setToolbar} />
          </div>
        )}
        {error !== undefined ? (
          <>
            <ErrorMessage error={error} />
            <button type="button" onClick={() => state.retry(tab.key)}>
              {t("settings.retry")}
            </button>
          </>
        ) : tab.changeDetail ? (
          <SessionChangeDiff change={tab.changeDetail} identity={tab.key} />
        ) : tab.gitHistory ? (
          <GitHistoryView response={tab.gitHistory} />
        ) : tab.gitDiff ? (
          <GitDiffView response={tab.gitDiff} identity={tab.key} />
        ) : content ? (
          <ViewerToolbarTarget value={toolbar}>
            <Suspense fallback={<p role="status">{t("home.loading")}</p>}>
              <DocumentBody
                content={content}
                bytes={tab.textBytes}
                largeText={tab.largeText}
                hexFile={tab.hexFile}
                imageFile={tab.imageFile}
                retry={() => state.retry(tab.key)}
                place={state.place(tab.key)}
                onPlace={(place) => state.setPlace(tab.key, place)}
                findRequest={findRequest}
                gotoRequest={gotoRequest}
                zoomRequest={zoomRequest}
              />
            </Suspense>
          </ViewerToolbarTarget>
        ) : (
          <p role="status">{t("home.loading")}</p>
        )}
      </section>
      {/* Outside the panel, so the menu's Escape does not also leave the tab. */}
      {menu && (
        <TreeMenu
          label={t("documents.documentActions", { name: tab.label })}
          x={menu.x}
          y={menu.y}
          items={menuItems()}
          close={(restore) => {
            const from = menu.from;
            setMenu(undefined);
            if (!restore) return;
            if (from instanceof HTMLElement && from.isConnected && node.current?.contains(from)) from.focus();
            else node.current?.focus();
          }}
        />
      )}
    </>
  );
}
