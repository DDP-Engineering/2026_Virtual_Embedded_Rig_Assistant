import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionSummary, WorkbenchSnapshot } from "@vera/shared";
import { Activity } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api/index.js";
import { DocsTab } from "./components/documents/docs-tab.js";
import { DocumentTabs } from "./components/documents/document-tabs.js";
import { DocumentViewerProvider } from "./components/documents/viewer-context.js";
import { ErrorMessage } from "./components/error-message.js";
import { Plugins } from "./components/plugins.js";
import { RunsTab } from "./components/runs-tab.js";
import { ArtifactsTab } from "./components/session/artifacts-tab.js";
import { type Attachments, AttachmentsContext } from "./components/session/attachments.js";
import { ChangesTab } from "./components/session/changes-tab.js";
import { ContextTab } from "./components/session/context-tab.js";
import { PlanTab } from "./components/session/plan-tab.js";
import { SessionList } from "./components/session/session-list.js";
import { SessionWorkspace } from "./components/session/workspace.js";
import { Settings, useSettingsSections } from "./components/settings.js";
import { Shell } from "./components/shell.js";
import { UpdateBanner } from "./components/updates.js";
import { Workbench } from "./components/workbench.js";
import { WorkbenchCreate } from "./components/workbench-create.js";
import { WorkbenchEditor } from "./components/workbench-editor.js";
import { WorkbenchNavigation } from "./components/workbench-navigation.js";
import { usePreferences } from "./hooks/use-preferences.js";
import { ATTACHMENT_LIMIT, addAttachment } from "./lib/attachments.js";
import { removeTabs } from "./lib/document-tabs-store.js";
import { ShortcutContext, shortcutCommand } from "./lib/shortcuts.js";

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(false);
  const [plugins, setPlugins] = useState(false);
  const [newWorkbench, setNewWorkbench] = useState(false);
  const [editor, setEditor] = useState<WorkbenchSnapshot>();
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
  const openEditor = useCallback((value: WorkbenchSnapshot) => {
    editorOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
  const benchChanged = useCallback(
    (active?: WorkbenchSnapshot, configOnly = false) => {
      if (!configOnly) {
        setNewWorkbench(false);
        setPlugins(false);
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
    (id: string) => {
      setComposerFocus(undefined);
      setActiveSession(id);
      setChat(true);
      setPlugins(false);
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
  const attachments = useMemo<Attachments>(
    () => ({
      list: (id) => attached[id] ?? [],
      remove: (id, path) =>
        setAttached((all) => ({ ...all, [id]: (all[id] ?? []).filter((p) => p !== path) })),
      clear: (id, paths) =>
        setAttached((all) => ({ ...all, [id]: (all[id] ?? []).filter((p) => !paths.includes(p)) })),
      full: !!activeSession && (attached[activeSession]?.length ?? 0) >= ATTACHMENT_LIMIT,
      // A chat opens to take the entry: the active session's, or a new or reused empty one.
      attach:
        benchId && !readOnly
          ? (path) => {
              const add = (id: string) =>
                setAttached((all) => ({ ...all, [id]: addAttachment(all[id] ?? [], path) }));
              if (!activeSession) return createWith(add);
              if (!leaveEditor()) return;
              add(activeSession);
              openSession(activeSession);
              setComposerFocus({ id: activeSession, request: ++composerFocusSequence.current });
            }
          : undefined,
    }),
    [attached, activeSession, benchId, readOnly, createWith, leaveEditor, openSession],
  );
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => node?.focus(), []);
  const info = useQuery({ queryKey: ["app.info"], queryFn: () => api.getAppInfo() });
  const { snapshot, mutation } = usePreferences(info.data?.locale ?? "en");
  const emptyCanvas =
    !settings &&
    !plugins &&
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
    setNewWorkbench(false);
    setEditor(undefined);
  }, [leaveEditor]);
  const showNewWorkbench = useCallback(() => {
    if (!leaveEditor()) return;
    setNewWorkbench(true);
    setEditor(undefined);
    setSettings(false);
    setPlugins(false);
    setChat(false);
  }, [leaveEditor]);
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
        disabled={sessionPending}
        settingsLoading={!snapshot.data}
        open={async (folder) =>
          leaveEditor() &&
          operation(async () => {
            if (folder !== activeWorkbench?.folder)
              benchChanged(await api.invoke("workbench.open", { folder }));
            setNewWorkbench(false);
            setPlugins(false);
            setChat(false);
            setEditor(undefined);
            await recent.refetch();
          })
        }
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
              if (value.config.id !== benchId) benchChanged(value);
              setNewWorkbench(false);
              setPlugins(false);
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
      <AttachmentsContext.Provider value={attachments}>
        <DocumentViewerProvider
          scope={`${benchId}/${activeSession ?? ""}`}
          sessionId={activeSession}
          workbenchId={benchId ?? ""}
          reveal={revealChat}
        >
          <Shell
            settings={settings}
            newSelected={newWorkbench}
            pluginsSelected={plugins}
            newWorkbench={showNewWorkbench}
            openWorkbench={openWorkbench}
            showPlugins={() => {
              if (!leaveEditor()) return;
              setPlugins(true);
              setSettings(false);
              setChat(false);
              setEditor(undefined);
            }}
            navigate={navigate}
            navigation={navigation}
            context={
              benchId && chat && !settings ? (
                <ContextTab workbenchId={benchId} readOnly={readOnly} />
              ) : undefined
            }
            docs={
              benchId && !settings ? (
                <DocsTab key={benchId} workbenchId={benchId} readOnly={readOnly} />
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
            runs={benchId && !settings ? <RunsTab key={benchId} workbenchId={benchId} /> : undefined}
          >
            <UpdateBanner />
            <div className="page-content" hidden={(chat && !settings) || emptyCanvas}>
              <h2
                hidden={!settings && !plugins && !newWorkbench && !activeWorkbench}
                className="page-title"
                key={settings ? "settings" : "welcome"}
                ref={focusHeading}
                tabIndex={-1}
              >
                {settings
                  ? t("settings.title")
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
              <div hidden={settings || plugins || !newWorkbench}>
                <p className="muted">{t("welcome.description")}</p>
                <WorkbenchCreate
                  key={createdCount}
                  shown={!settings && !plugins && newWorkbench}
                  created={(value) => {
                    setCreatedCount((count) => count + 1);
                    benchChanged(value);
                  }}
                  busy={sessionPending}
                />
              </div>
              {!settings && !plugins && !newWorkbench && editor && (
                <WorkbenchEditor
                  key={editor.config.id}
                  workbench={editor}
                  close={closeEditor}
                  dirtyChanged={setEditorDirty}
                  saved={(value) => {
                    benchChanged(value, true);
                    void recent.refetch();
                  }}
                />
              )}
              <div hidden={settings || plugins || newWorkbench || !!editor || !activeWorkbench}>
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
            {chat && !settings && !plugins && benchId && (
              <DocumentTabs
                chat={
                  <SessionWorkspace
                    key={`${benchId}/${activeSession}`}
                    id={activeSession}
                    workbenchId={benchId}
                    detail={bench.data?.config.chat.detail ?? "normal"}
                    changed={changed}
                    readOnly={readOnly}
                    composerFocusRequest={
                      composerFocus && composerFocus.id === activeSession ? composerFocus.request : 0
                    }
                    composerFocused={clearComposerFocus}
                  />
                }
              />
            )}
          </Shell>
        </DocumentViewerProvider>
      </AttachmentsContext.Provider>
    </ShortcutContext.Provider>
  );
}
