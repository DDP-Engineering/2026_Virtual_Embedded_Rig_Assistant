import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionSummary, WorkbenchSnapshot } from "@vera/shared";
import { Activity } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api/index.js";
import { DocsTab } from "./components/documents/docs-tab.js";
import { DocumentTabs } from "./components/documents/document-tabs.js";
import { WorkbenchIndexStatus } from "./components/documents/index-status.js";
import { DocumentViewerProvider } from "./components/documents/viewer-context.js";
import { ErrorMessage } from "./components/error-message.js";
import { HelpContext, HelpView } from "./components/help.js";
import { Plugins } from "./components/plugins.js";
import { RunsTab } from "./components/runs-tab.js";
import { ArtifactsTab } from "./components/session/artifacts-tab.js";
import { type Attachments, AttachmentsContext } from "./components/session/attachments.js";
import { BookmarksTab } from "./components/session/bookmarks-tab.js";
import { ChangesTab } from "./components/session/changes-tab.js";
import { ContextTab } from "./components/session/context-tab.js";
import { PlanTab } from "./components/session/plan-tab.js";
import { SessionBookmarksProvider } from "./components/session/session-bookmarks.js";
import { SessionList } from "./components/session/session-list.js";
import { SessionWorkspace } from "./components/session/workspace.js";
import { Settings, useSettingsSections } from "./components/settings.js";
import { Shell } from "./components/shell.js";
import { TerminalTab } from "./components/terminal-tab.js";
import { UpdateBanner } from "./components/updates.js";
import { Workbench } from "./components/workbench.js";
import type { ConfigSection } from "./components/workbench-config-form.js";
import { WorkbenchCreate } from "./components/workbench-create.js";
import { WorkbenchEditor } from "./components/workbench-editor.js";
import { WorkbenchNavigation } from "./components/workbench-navigation.js";
import { useImageDrafts } from "./hooks/image-drafts.js";
import { SessionViewProvider } from "./hooks/session-view.js";
import { usePreferences } from "./hooks/use-preferences.js";
import { useRunPresentation } from "./hooks/use-run-presentation.js";
import { ATTACHMENT_LIMIT, addAttachment } from "./lib/attachments.js";
import { removeTabs } from "./lib/document-tabs-store.js";
import { screenHelpPage } from "./lib/help-pages.js";
import { globalShortcutBlocked, ShortcutContext, shortcutCommand } from "./lib/shortcuts.js";

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(false);
  const [plugins, setPlugins] = useState(false);
  /** The open help page; Help is a detour like Plugins, so hidden drafts survive it. */
  const [help, setHelp] = useState<string>();
  const [newWorkbench, setNewWorkbench] = useState(false);
  const [editor, setEditor] = useState<WorkbenchSnapshot>();
  const [editorRequest, setEditorRequest] = useState<{ section: ConfigSection }>();
  const [createdCount, setCreatedCount] = useState(0);
  const editorDirty = useRef(false);
  const editorOrigin = useRef<HTMLElement | null>(null);
  const restoreEditorFocus = useRef(false);
  const setEditorDirty = useCallback((dirty: boolean) => {
    editorDirty.current = dirty;
  }, []);
  /** False when the engineer keeps unsaved editor edits instead of navigating away. */
  const leaveEditor = useCallback(
    () => !editorDirty.current || window.confirm(t("projects.discardChanges")),
    [t],
  );
  const openEditor = useCallback((value: WorkbenchSnapshot, section?: ConfigSection) => {
    editorOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditorRequest(section ? { section } : undefined);
    setEditor(value);
  }, []);
  const closeEditor = useCallback(() => {
    restoreEditorFocus.current = true;
    setEditor(undefined);
  }, []);
  useEffect(() => {
    if (editor || !restoreEditorFocus.current) return;
    restoreEditorFocus.current = false;
    const origin = editorOrigin.current;
    editorOrigin.current = null;
    // A menu item that opened the editor is gone once its menu closed; fall back to the overview Edit.
    if (origin && origin !== document.body && origin.isConnected && origin.getClientRects().length > 0)
      origin.focus();
    else document.querySelector<HTMLElement>('[data-action="edit-workbench-overview"]')?.focus();
  }, [editor]);
  const [section, setSection] = useState("appearance");
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (settings && section && main) main.scrollTop = 0;
  }, [section, settings]);
  const client = useQueryClient();
  const [chat, setChat] = useState(false);
  const [activeSession, setActiveSession] = useState<string>();
  const operationBusy = useRef(false);
  const [sessionPending, setSessionPending] = useState(false);
  const [linkedTranscript, setLinkedTranscript] = useState<string>();
  const [composerFocus, setComposerFocus] = useState<{ id: string; request: number }>();
  const composerFocusSequence = useRef(0);
  // Docs tree entries attached to each session's next message (TASK-2fef1397).
  const [attached, setAttached] = useState<Record<string, readonly string[]>>({});
  const [sessionError, setSessionError] = useState<unknown>();
  const bench = useQuery({
    queryKey: ["workbench.active"],
    queryFn: () => api.invoke("workbench.config.get", {}),
    retry: false,
  });
  const benchId = bench.data?.config.id;
  const indexLease = bench.data?.indexLease;
  const [filesRequest, setFilesRequest] = useState<{ indexLease: number; sequence: number }>();
  useRunPresentation(benchId);
  const readOnly = bench.data?.readOnly ?? false;
  const benchFailure = bench.isError && (bench.error as { code?: string }).code !== "NOT_FOUND";

  useEffect(() => {
    if (editor && editor.config.id !== benchId) setEditor(undefined);
  }, [benchId, editor]);
  const sessions = useQuery({
    queryKey: ["session.list", benchId],
    queryFn: () => api.invoke("session.list", { workbenchId: benchId }),
    enabled: !!benchId,
    refetchInterval: 2000,
  });
  const changed = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["session.list"] });
    void client.invalidateQueries({ queryKey: ["session.search"] });
  }, [client]);
  useEffect(() => {
    if (!benchId) return;
    return api.subscribe("workbench", benchId, (event) => {
      if (event.type === "session.delegations.changed")
        void client.invalidateQueries({ queryKey: ["session.list", benchId] });
    });
  }, [benchId, client]);
  const selected = sessions.data?.find(({ id }) => id === activeSession);
  const delegationParent = sessions.data?.find(({ id }) => id === selected?.delegation?.parentSessionId);
  const delegationChildren = sessions.data?.filter(
    ({ delegation }) => delegation && delegation.parentSessionId === activeSession,
  );
  const benchChanged = useCallback(
    (active?: WorkbenchSnapshot, configOnly = false) => {
      if (!configOnly) {
        if (active) {
          // A copied workbench can reuse the stored id, but its Files data belongs to the old folder.
          client.removeQueries({
            predicate: ({ queryKey: [channel, owner] }) =>
              owner === active.config.id &&
              typeof channel === "string" &&
              (channel.startsWith("docs.") || channel === "downloads.list"),
          });
        }
        setNewWorkbench(false);
        setPlugins(false);
        setHelp(undefined);
        setActiveSession(undefined);
        setChat(false);
      }
      client.setQueryData(["workbench.active"], active ?? null);
      changed();
    },
    [client, changed],
  );
  /**
   * After the active workbench closes only what belonged to it goes (its session and chat). A page
   * the user opened while the close was pending, such as New Workbench or Plugins, stays open.
   */
  const benchClosed = useCallback(() => {
    setActiveSession(undefined);
    setChat(false);
    client.setQueryData(["workbench.active"], null);
    changed();
  }, [client, changed]);
  const recent = useQuery({
    queryKey: ["workbench.recent"],
    queryFn: () => api.invoke("workbench.recent", {}),
  });
  useEffect(
    () =>
      api.subscribe("app", () => {
        void client.invalidateQueries({ queryKey: ["workbench.recent"] });
      }),
    [client],
  );
  const activeWorkbench = useMemo(() => {
    const folder = bench.data?.folder ?? recent.data?.find((entry) => entry.id === benchId)?.folder;
    return bench.data && folder ? { ...bench.data, folder, readOnly } : undefined;
  }, [bench.data, benchId, recent.data, readOnly]);
  /** Shows a session; callers have already confirmed leaving a dirty editor. */
  const openSession = useCallback(
    (id: string, linked = false) => {
      setLinkedTranscript(linked ? id : undefined);
      setComposerFocus(undefined);
      setActiveSession(id);
      setChat(true);
      setPlugins(false);
      setHelp(undefined);
      setNewWorkbench(false);
      setSettings(false);
      setEditor(undefined);
      if (benchId)
        try {
          localStorage.setItem(`vera.session.${benchId}`, id);
        } catch {
          /* Disabled storage. */
        }
    },
    [benchId],
  );
  const select = useCallback(
    (id: string) => {
      if (leaveEditor()) openSession(id);
    },
    [leaveEditor, openSession],
  );
  const clearLinkedTranscript = useCallback((id: string) => {
    setLinkedTranscript((current) => (current === id ? undefined : current));
  }, []);
  const selectLinkedSession = useCallback(
    (id: string) => {
      if (leaveEditor()) openSession(id, true);
    },
    [leaveEditor, openSession],
  );
  useEffect(() => {
    if (!benchId || !sessions.data) return;
    if (activeSession && sessions.data.some((s) => s.id === activeSession)) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(`vera.session.${benchId}`);
    } catch {
      /* Disabled storage. */
    }
    const id = sessions.data.find((s) => s.id === remembered)?.id ?? sessions.data[0]?.id;
    setActiveSession(id);
  }, [benchId, sessions.data, activeSession]);
  const operation = useCallback(
    async (action: () => Promise<void>) => {
      if (operationBusy.current) return false;
      operationBusy.current = true;
      setSessionPending(true);
      setSessionError(undefined);
      try {
        await action();
        changed();
        return true;
      } catch (e) {
        setSessionError(e);
        return false;
      } finally {
        operationBusy.current = false;
        setSessionPending(false);
      }
    },
    [changed],
  );
  /** Creates (or reuses an empty) session and opens it; `then` receives its id. */
  const createWith = useCallback(
    (then?: (id: string) => void) => {
      if (!benchId || readOnly || sessionPending || !leaveEditor()) return;
      void operation(async () => {
        const session = await api.invoke("session.create", { workbenchId: benchId, reuseEmpty: true });
        client.setQueryData<SessionSummary[]>(["session.list", benchId], (old) => [
          session,
          ...(old ?? []).filter((row) => row.id !== session.id),
        ]);
        openSession(session.id);
        setComposerFocus({ id: session.id, request: ++composerFocusSequence.current });
        then?.(session.id);
      }).catch(() => {});
    },
    [benchId, readOnly, sessionPending, openSession, operation, client, leaveEditor],
  );
  const create = useCallback(() => createWith(), [createWith]);
  const { imageDraft, addImages, clearImages } = useImageDrafts();
  const activeRow = sessions.data?.find((row) => row.id === activeSession);
  const imageSessionLocked =
    activeRow?.archived ||
    activeRow?.status === "awaiting_approval" ||
    (!!benchId && !!activeSession && imageDraft(benchId, activeSession).pending);
  const attachToChat = useCallback(
    (add: (id: string) => void) => {
      if (!activeSession) return createWith(add);
      if (!leaveEditor()) return;
      add(activeSession);
      openSession(activeSession);
      setComposerFocus({ id: activeSession, request: ++composerFocusSequence.current });
    },
    [activeSession, createWith, leaveEditor, openSession],
  );
  const attachments = useMemo<Attachments>(
    () => ({
      imageDraft,
      addImages,
      clearImages,
      attachImage:
        benchId && !readOnly && !imageSessionLocked
          ? (path) => attachToChat((id) => void addImages(benchId, id, [path]))
          : undefined,
      list: (id) => attached[id] ?? [],
      remove: (id, path) =>
        setAttached((all) => ({ ...all, [id]: (all[id] ?? []).filter((p) => p !== path) })),
      clear: (id, paths) =>
        setAttached((all) => ({ ...all, [id]: (all[id] ?? []).filter((p) => !paths.includes(p)) })),
      full: !!activeSession && (attached[activeSession]?.length ?? 0) >= ATTACHMENT_LIMIT,
      // A chat opens to take the entry: the active session's, or a new or reused empty one.
      attach:
        benchId && !readOnly
          ? (path) =>
              attachToChat((id) =>
                setAttached((all) => ({ ...all, [id]: addAttachment(all[id] ?? [], path) })),
              )
          : undefined,
    }),
    [
      attached,
      activeSession,
      benchId,
      readOnly,
      attachToChat,
      imageDraft,
      addImages,
      clearImages,
      imageSessionLocked,
    ],
  );
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => node?.focus(), []);
  const info = useQuery({ queryKey: ["app.info"], queryFn: () => api.getAppInfo() });
  const { snapshot, mutation } = usePreferences(info.data?.locale ?? "en");
  const emptyCanvas =
    !settings &&
    !plugins &&
    help === undefined &&
    !newWorkbench &&
    !activeWorkbench &&
    !bench.isPending &&
    !benchFailure &&
    !info.isPending &&
    !snapshot.isPending &&
    !info.isError &&
    !snapshot.isError;
  const sections = useSettingsSections();
  const navigate = useCallback(
    (value: boolean) => {
      if (!leaveEditor()) return;
      setSettings(value);
      setPlugins(false);
      setHelp(undefined);
      setNewWorkbench(false);
      setEditor(undefined);
      if (!value) setChat(false);
    },
    [leaveEditor],
  );
  const clearComposerFocus = useCallback(() => setComposerFocus(undefined), []);
  // Documents open as tabs of the chat area, so opening one shows it (TASK-79f6ffd3).
  const revealChat = useCallback(() => {
    if (!leaveEditor()) return;
    setChat(true);
    setSettings(false);
    setPlugins(false);
    setHelp(undefined);
    setNewWorkbench(false);
    setEditor(undefined);
  }, [leaveEditor]);
  const showNewWorkbench = useCallback(() => {
    if (!leaveEditor()) return;
    setNewWorkbench(true);
    setEditor(undefined);
    setSettings(false);
    setPlugins(false);
    setHelp(undefined);
    setChat(false);
  }, [leaveEditor]);
  /** Opens Help as a detour: hidden drafts (New Workbench, the workbench editor) stay mounted. */
  const showHelp = useCallback((page: string) => {
    setHelp(page);
    setSettings(false);
    setPlugins(false);
    setChat(false);
  }, []);
  const helpPage = screenHelpPage({
    help: help !== undefined,
    settings,
    section,
    plugins,
    workbench: newWorkbench || !!editor || !!activeWorkbench,
    chat: chat && !!benchId,
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "F1" || event.ctrlKey || event.metaKey || globalShortcutBlocked(event)) return;
      event.preventDefault();
      showHelp(helpPage);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [helpPage, showHelp]);
  const openWorkbench = useCallback(() => {
    if (sessionPending || !leaveEditor()) return;
    void operation(async () => {
      const result = await api.invoke("app.chooseFolder", {});
      if (result.folder) {
        benchChanged(await api.invoke("workbench.open", { folder: result.folder }));
        setSettings(false);
        await recent.refetch();
      }
    });
  }, [sessionPending, operation, benchChanged, recent.refetch, leaveEditor]);
  const bindings = snapshot.data?.settings.keyboardShortcuts;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const command = shortcutCommand(event, bindings);
      switch (command) {
        case "settings":
          navigate(true);
          break;
        case "shortcuts":
          navigate(true);
          setSection("shortcuts");
          break;
        case "newSession":
          if (!benchId || readOnly || sessionPending) return;
          create();
          break;
        case "newWorkbench":
          showNewWorkbench();
          break;
        case "openWorkbench":
          if (sessionPending) return;
          openWorkbench();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [bindings, navigate, create, benchId, readOnly, sessionPending, showNewWorkbench, openWorkbench]);
  const navigation = settings ? (
    <div
      className="settings-tabs"
      role="tablist"
      aria-label={t("settings.title")}
      aria-orientation="vertical"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const index = sections.findIndex(({ id }) => id === section);
        const next =
          event.key === "ArrowDown"
            ? (index + 1) % sections.length
            : event.key === "ArrowUp"
              ? (index + sections.length - 1) % sections.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? sections.length - 1
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        const id = sections[next]?.id;
        if (id) {
          setSection(id);
          document.getElementById(`settings-tab-${id}`)?.focus();
        }
      }}
    >
      {sections.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`settings-tab-${id}`}
          data-section={id}
          aria-selected={section === id}
          aria-controls="settings-panel"
          tabIndex={section === id ? 0 : -1}
          onClick={() => setSection(id)}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  ) : (
    <>
      <WorkbenchNavigation
        entries={recent.data ?? []}
        activeId={benchId}
        activeFolder={bench.data?.folder}
        indexingStatus={
          benchId &&
          indexLease !== undefined && (
            <WorkbenchIndexStatus
              workbenchId={benchId}
              indexLease={indexLease}
              open={() => setFilesRequest((last) => ({ indexLease, sequence: (last?.sequence ?? 0) + 1 }))}
            />
          )
        }
        disabled={sessionPending}
        settingsLoading={!snapshot.data}
        open={async (folder) => {
          const resume = plugins && folder === editor?.folder && folder === activeWorkbench?.folder;
          if (!resume && !leaveEditor()) return false;
          return operation(async () => {
            if (folder !== activeWorkbench?.folder)
              benchChanged(await api.invoke("workbench.open", { folder }));
            setNewWorkbench(false);
            setPlugins(false);
            setHelp(undefined);
            setChat(false);
            if (!resume) setEditor(undefined);
            await recent.refetch();
          });
        }}
        pin={(folder, value) =>
          void operation(async () => {
            await api.invoke("workbench.recent", { pin: { folder, value } });
            await recent.refetch();
          })
        }
        move={(folder, offset) =>
          operation(async () => {
            await api.invoke("workbench.recent", { move: { folder, offset } });
            await recent.refetch();
          })
        }
        edit={(folder) =>
          (folder === editor?.folder || leaveEditor()) &&
          void operation(async () => {
            const value =
              folder === activeWorkbench?.folder
                ? activeWorkbench
                : await api.invoke("workbench.open", { folder });
            if (value) {
              if (value.indexLease !== indexLease) benchChanged(value);
              setNewWorkbench(false);
              setPlugins(false);
              setHelp(undefined);
              setChat(false);
              openEditor(value);
            }
          })
        }
        reveal={(folder) =>
          void operation(async () => {
            await api.invoke("workbench.recent", { reveal: folder });
          })
        }
        close={() =>
          leaveEditor() &&
          void operation(async () => {
            await api.invoke("workbench.close", {});
            benchClosed();
          })
        }
        remove={(folder) =>
          (folder !== activeWorkbench?.folder || leaveEditor()) &&
          void operation(async () => {
            if (folder === activeWorkbench?.folder) {
              await api.invoke("workbench.close", {});
              benchClosed();
            }
            await api.invoke("workbench.recent", { remove: folder });
            await recent.refetch();
          })
        }
      >
        {benchId && (
          <SessionList
            key={benchId}
            sessions={sessions.data ?? []}
            active={activeSession}
            select={select}
            create={create}
            disabled={readOnly || sessionPending}
            rename={(id, title) =>
              operation(async () => {
                await api.invoke("session.rename", { sessionId: id, title });
              })
            }
            archive={(id, archived) =>
              operation(async () => {
                await api.invoke("session.archive.set", { sessionId: id, archived });
              })
            }
            move={(id, offset) =>
              operation(async () => {
                await api.invoke("session.move", { workbenchId: benchId, sessionId: id, offset });
                // Refresh before the list is enabled again so focus returns to the moved row.
                await client.invalidateQueries({ queryKey: ["session.list", benchId] });
              })
            }
            moveDisabled={!snapshot.data}
            remove={(id) =>
              operation(async () => {
                await api.invoke("session.delete", { sessionId: id });
                if (benchId) removeTabs(localStorage, benchId, id);
                if (id === activeSession) {
                  setActiveSession(undefined);
                  try {
                    localStorage.removeItem(`vera.session.${benchId}`);
                  } catch {}
                }
              })
            }
          />
        )}
      </WorkbenchNavigation>
      {sessions.isError && (
        <>
          <ErrorMessage error={sessions.error} />
          <button type="button" onClick={changed}>
            {t("settings.retry")}
          </button>
        </>
      )}
      {sessionError !== undefined && <ErrorMessage error={sessionError} />}
    </>
  );
  return (
    <ShortcutContext.Provider value={bindings}>
      <HelpContext.Provider value={showHelp}>
        <AttachmentsContext.Provider value={attachments}>
          <DocumentViewerProvider
            scope={`${benchId}/${activeSession ?? ""}`}
            sessionId={activeSession}
            workbenchId={benchId ?? ""}
            gitLease={bench.data?.config.interface.git_status ? indexLease : undefined}
            reveal={revealChat}
          >
            {/* One session view per window (PERF-05): the chat and its side tabs share one read. */}
            <SessionViewProvider
              id={benchId && chat && !settings && !plugins && help === undefined ? activeSession : undefined}
              changed={changed}
            >
              <SessionBookmarksProvider
                sessionId={benchId && chat && !settings ? activeSession : undefined}
                disabled={readOnly || (selected?.archived ?? true)}
              >
                <Shell
                  workbenchId={benchId}
                  showFilesRequest={
                    filesRequest?.indexLease === indexLease ? filesRequest?.sequence : undefined
                  }
                  visibleTabs={bench.data?.config.interface.right_panel_tabs}
                  configurePanelTabs={
                    activeWorkbench
                      ? () => {
                          if (!leaveEditor()) return;
                          setSettings(false);
                          setNewWorkbench(false);
                          setPlugins(false);
                          setHelp(undefined);
                          setChat(false);
                          openEditor(activeWorkbench, "interface");
                        }
                      : undefined
                  }
                  settings={settings}
                  newSelected={newWorkbench}
                  pluginsSelected={plugins}
                  newWorkbench={showNewWorkbench}
                  openWorkbench={openWorkbench}
                  showPlugins={() => {
                    // Installing a package is a reversible detour; the editor remains its draft owner.
                    setPlugins(true);
                    setHelp(undefined);
                    setSettings(false);
                    setChat(false);
                  }}
                  navigate={navigate}
                  showHelp={() => showHelp("index")}
                  navigation={navigation}
                  context={
                    benchId && chat && !settings ? (
                      <ContextTab workbenchId={benchId} readOnly={readOnly} />
                    ) : undefined
                  }
                  docs={
                    benchId && indexLease !== undefined && !settings ? (
                      <DocsTab
                        key={indexLease}
                        workbenchId={benchId}
                        indexLease={indexLease}
                        gitEnabled={bench.data?.config.interface.git_status ?? false}
                        readOnly={readOnly}
                        editExclusions={() => {
                          if (!activeWorkbench) return;
                          // Like Edit in the workbench list: the editor replaces the other views.
                          setNewWorkbench(false);
                          setPlugins(false);
                          setHelp(undefined);
                          setChat(false);
                          openEditor(activeWorkbench, "documents");
                        }}
                      />
                    ) : undefined
                  }
                  changes={
                    benchId && activeSession && chat && !settings ? (
                      <ChangesTab workbenchId={benchId} sessionId={activeSession} />
                    ) : undefined
                  }
                  artifacts={
                    benchId && activeSession && chat && !settings ? (
                      <ArtifactsTab workbenchId={benchId} sessionId={activeSession} />
                    ) : undefined
                  }
                  plan={
                    benchId && activeSession && chat && !settings ? (
                      <PlanTab workbenchId={benchId} sessionId={activeSession} />
                    ) : undefined
                  }
                  bookmarks={
                    benchId && activeSession && chat && !settings ? (
                      <BookmarksTab
                        sessionId={activeSession}
                        readOnly={readOnly}
                        archived={selected?.archived ?? true}
                      />
                    ) : undefined
                  }
                  runs={
                    benchId && !settings ? (
                      <RunsTab
                        key={benchId}
                        workbenchId={benchId}
                        sessions={sessions.data}
                        currentSessionId={chat ? activeSession : undefined}
                      />
                    ) : undefined
                  }
                  terminal={
                    benchId && !settings ? <TerminalTab key={benchId} workbenchId={benchId} /> : undefined
                  }
                >
                  <UpdateBanner />
                  <div className="page-content" hidden={(chat && !settings) || emptyCanvas}>
                    <h2
                      hidden={
                        !settings && !plugins && help === undefined && !newWorkbench && !activeWorkbench
                      }
                      className="page-title"
                      key={settings ? "settings" : "welcome"}
                      ref={focusHeading}
                      tabIndex={-1}
                    >
                      {settings
                        ? t("settings.title")
                        : help !== undefined
                          ? t("help.title")
                          : plugins
                            ? t("projects.plugins")
                            : newWorkbench
                              ? t("projects.new")
                              : editor
                                ? t("projects.edit")
                                : t("overview.title")}
                    </h2>
                    {(info.isPending || snapshot.isPending) && (
                      <p role="status" data-i18n="home.loading">
                        {t("home.loading")}
                      </p>
                    )}
                    {benchFailure && <ErrorMessage error={bench.error} />}
                    {(info.isError || snapshot.isError) && (
                      <>
                        <ErrorMessage error={info.error ?? snapshot.error} />
                        <button
                          type="button"
                          onClick={() => {
                            void info.refetch();
                            void snapshot.refetch();
                          }}
                        >
                          {t("settings.retry")}
                        </button>
                      </>
                    )}
                    {settings && snapshot.data && (
                      <Settings
                        section={section}
                        snapshot={snapshot.data}
                        info={info.data}
                        saving={mutation.isPending}
                        error={mutation.error}
                        update={(patch) => mutation.mutate(patch)}
                      />
                    )}
                    {/* Stays mounted while hidden so an unsaved draft survives navigation. */}
                    <div hidden={settings || plugins || help !== undefined || !newWorkbench}>
                      <WorkbenchCreate
                        key={createdCount}
                        shown={!settings && !plugins && help === undefined && newWorkbench}
                        created={(value) => {
                          setCreatedCount((count) => count + 1);
                          benchChanged(value);
                        }}
                        busy={sessionPending}
                      />
                    </div>
                    {editor && (
                      <WorkbenchEditor
                        key={editor.config.id}
                        shown={!settings && !plugins && help === undefined && !newWorkbench}
                        workbench={editor}
                        request={editorRequest}
                        close={closeEditor}
                        dirtyChanged={setEditorDirty}
                        saved={(value) => {
                          benchChanged(value, true);
                          void recent.refetch();
                        }}
                      />
                    )}
                    <div
                      hidden={
                        settings ||
                        plugins ||
                        help !== undefined ||
                        newWorkbench ||
                        !!editor ||
                        !activeWorkbench
                      }
                    >
                      {info.data && snapshot.data && (
                        <Workbench
                          active={activeWorkbench}
                          changed={benchChanged}
                          closed={benchClosed}
                          sessionPending={sessionPending}
                          sessions={sessions.data}
                          sessionsError={sessions.error}
                          retrySessions={() => void sessions.refetch()}
                          edit={() => activeWorkbench && openEditor(activeWorkbench)}
                          selectSession={select}
                        />
                      )}
                    </div>
                    {help !== undefined && !settings && <HelpView page={help} open={setHelp} />}
                    {plugins && (
                      <Plugins
                        workbench={
                          activeWorkbench
                            ? {
                                id: activeWorkbench.config.id,
                                name: activeWorkbench.config.name,
                                readOnly: activeWorkbench.readOnly,
                              }
                            : undefined
                        }
                      />
                    )}
                  </div>
                  {emptyCanvas && (
                    <div className="empty-workbench" data-empty-workbench role="img" aria-label="VERA">
                      <Activity aria-hidden="true" />
                      <span>VERA</span>
                    </div>
                  )}
                  {chat && !settings && !plugins && help === undefined && benchId && (
                    <DocumentTabs
                      chat={
                        <SessionWorkspace
                          key={`${benchId}/${activeSession}`}
                          id={activeSession}
                          dictationMode={snapshot.data?.settings.dictationRecordingMode}
                          workbenchId={benchId}
                          detail={bench.data?.config.chat.detail ?? "normal"}
                          changed={changed}
                          readOnly={readOnly}
                          browserEnabled={
                            snapshot.data?.settings.interactiveBrowser === true &&
                            bench.data?.config.interactive_browser === true
                          }
                          archived={selected?.archived ?? true}
                          delegation={selected?.delegation}
                          delegationParent={delegationParent}
                          delegationChildren={delegationChildren}
                          selectLinkedSession={selectLinkedSession}
                          focusTranscript={linkedTranscript === activeSession && !!activeSession}
                          transcriptOpened={clearLinkedTranscript}
                          composerFocusRequest={
                            composerFocus && composerFocus.id === activeSession ? composerFocus.request : 0
                          }
                          composerFocused={clearComposerFocus}
                        />
                      }
                    />
                  )}
                </Shell>
              </SessionBookmarksProvider>
            </SessionViewProvider>
          </DocumentViewerProvider>
        </AttachmentsContext.Provider>
      </HelpContext.Provider>
    </ShortcutContext.Provider>
  );
}
