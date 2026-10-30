import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionSummary, WorkbenchSnapshot } from "@vera/shared";
import { Activity } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "./api/index.js";
import { DocsTab } from "./components/documents/docs-tab.js";
import { DocumentViewerProvider } from "./components/documents/viewer-context.js";
import { ErrorMessage } from "./components/error-message.js";
import { ArtifactsTab } from "./components/session/artifacts-tab.js";
import { ChangesTab } from "./components/session/changes-tab.js";
import { ContextTab } from "./components/session/context-tab.js";
import { PlanTab } from "./components/session/plan-tab.js";
import { SessionList } from "./components/session/session-list.js";
import { SessionWorkspace } from "./components/session/workspace.js";
import { Settings, useSettingsSections } from "./components/settings.js";
import { Shell } from "./components/shell.js";
import { UpdateBanner } from "./components/updates.js";
import { Workbench } from "./components/workbench.js";
import { Plugins, WorkbenchEditor } from "./components/workbench-editor.js";
import { WorkbenchNavigation } from "./components/workbench-navigation.js";
import { usePreferences } from "./hooks/use-preferences.js";
import { ShortcutContext, shortcutCommand } from "./lib/shortcuts.js";

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(false);
  const [plugins, setPlugins] = useState(false);
  const [newWorkbench, setNewWorkbench] = useState(false);
  const [editor, setEditor] = useState<WorkbenchSnapshot>();
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
  const recent = useQuery({
    queryKey: ["workbench.recent"],
    queryFn: () => api.invoke("workbench.recent", {}),
  });
  const activeWorkbench = useMemo(() => {
    const folder = bench.data?.folder ?? recent.data?.find((entry) => entry.id === benchId)?.folder;
    return bench.data && folder ? { ...bench.data, folder, readOnly } : undefined;
  }, [bench.data, benchId, recent.data, readOnly]);
  const select = useCallback(
    (id: string) => {
      setComposerFocus(undefined);
      setActiveSession(id);
      setChat(true);
      setPlugins(false);
      setNewWorkbench(false);
      setSettings(false);
      if (benchId)
        try {
          localStorage.setItem(`vera.session.${benchId}`, id);
        } catch {
          /* Disabled storage. */
        }
    },
    [benchId],
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
  const create = useCallback(() => {
    if (!benchId || readOnly || sessionPending) return;
    void operation(async () => {
      const session = await api.invoke("session.create", { workbenchId: benchId, reuseEmpty: true });
      client.setQueryData<SessionSummary[]>(["session.list", benchId], (old) => [
        session,
        ...(old ?? []).filter((row) => row.id !== session.id),
      ]);
      select(session.id);
      setComposerFocus({ id: session.id, request: ++composerFocusSequence.current });
    }).catch(() => {});
  }, [benchId, readOnly, sessionPending, select, operation, client]);
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
  const navigate = useCallback((value: boolean) => {
    setSettings(value);
    setPlugins(false);
    setNewWorkbench(false);
    if (!value) setChat(false);
  }, []);
  const showNewWorkbench = useCallback(() => {
    setNewWorkbench(true);
    setSettings(false);
    setPlugins(false);
    setChat(false);
  }, []);
  const openWorkbench = useCallback(() => {
    if (sessionPending) return;
    void operation(async () => {
      const result = await api.invoke("app.chooseFolder", {});
      if (result.folder) {
        benchChanged(await api.invoke("workbench.open", { folder: result.folder }));
        setSettings(false);
        await recent.refetch();
      }
    });
  }, [sessionPending, operation, benchChanged, recent.refetch]);
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
        settingsReadOnly={!snapshot.data || snapshot.data.readOnly}
        open={async (folder) =>
          operation(async () => {
            if (folder !== activeWorkbench?.folder)
              benchChanged(await api.invoke("workbench.open", { folder }));
            setNewWorkbench(false);
            setPlugins(false);
            setChat(false);
            await recent.refetch();
          })
        }
        pin={(folder, value) =>
          void operation(async () => {
            await api.invoke("workbench.recent", { pin: { folder, value } });
            await recent.refetch();
          })
        }
        edit={(folder) =>
          void operation(async () => {
            const value =
              folder === activeWorkbench?.folder
                ? activeWorkbench
                : await api.invoke("workbench.open", { folder });
            if (value) {
              if (value.config.id !== benchId) benchChanged(value);
              setEditor(value);
            }
          })
        }
        reveal={(folder) =>
          void operation(async () => {
            await api.invoke("workbench.recent", { reveal: folder });
          })
        }
        close={() =>
          void operation(async () => {
            await api.invoke("workbench.close", {});
            benchChanged();
          })
        }
        remove={(folder) =>
          void operation(async () => {
            if (folder === activeWorkbench?.folder) {
              await api.invoke("workbench.close", {});
              benchChanged();
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
            remove={(id) =>
              operation(async () => {
                await api.invoke("session.delete", { sessionId: id });
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
      <DocumentViewerProvider scope={`${benchId}/${activeSession}/${settings}`} workbenchId={benchId ?? ""}>
        <Shell
          settings={settings}
          newSelected={newWorkbench}
          pluginsSelected={plugins}
          newWorkbench={showNewWorkbench}
          openWorkbench={openWorkbench}
          showPlugins={() => {
            setPlugins(true);
            setSettings(false);
            setChat(false);
          }}
          navigate={navigate}
          navigation={navigation}
          storageReadOnly={!snapshot.data || snapshot.data.readOnly}
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
                    : activeWorkbench
                      ? t("overview.title")
                      : t("welcome.title")}
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
            <div hidden={settings || plugins || (!newWorkbench && !activeWorkbench)}>
              {newWorkbench && <p className="muted">{t("welcome.description")}</p>}
              {info.data && snapshot.data && (
                <Workbench
                  settingsReadOnly={snapshot.data.readOnly}
                  active={newWorkbench ? undefined : activeWorkbench}
                  changed={benchChanged}
                  sessionPending={sessionPending}
                  sessions={sessions.data}
                  sessionsError={sessions.error}
                  retrySessions={() => void sessions.refetch()}
                  edit={() => activeWorkbench && setEditor(activeWorkbench)}
                  selectSession={select}
                />
              )}
            </div>
            {plugins && <Plugins />}
          </div>
          {emptyCanvas && (
            <div className="empty-workbench" data-empty-workbench role="img" aria-label="VERA">
              <Activity aria-hidden="true" />
              <span>VERA</span>
            </div>
          )}
          {editor && (
            <WorkbenchEditor
              workbench={editor}
              close={() => setEditor(undefined)}
              saved={(value) => {
                benchChanged(value, true);
                void recent.refetch();
              }}
            />
          )}
          {chat && !settings && !plugins && benchId && (
            <SessionWorkspace
              key={`${benchId}/${activeSession}`}
              id={activeSession}
              workbenchId={benchId}
              changed={changed}
              readOnly={readOnly}
              composerFocusRequest={
                composerFocus && composerFocus.id === activeSession ? composerFocus.request : 0
              }
            />
          )}
        </Shell>
      </DocumentViewerProvider>
    </ShortcutContext.Provider>
  );
}
