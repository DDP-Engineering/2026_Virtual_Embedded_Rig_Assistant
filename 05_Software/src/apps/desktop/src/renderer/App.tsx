import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionSummary, WorkbenchSnapshot } from "@vera/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { usePreferences } from "./hooks/use-preferences.js";
import { globalShortcutBlocked } from "./lib/shortcuts.js";

export function App() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(false);
  const [section, setSection] = useState("appearance");
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (settings && section && main) main.scrollTop = 0;
  }, [section, settings]);
  const client = useQueryClient();
  const [chat, setChat] = useState(false);
  const [activeSession, setActiveSession] = useState<string>();
  const [sessionPending, setSessionPending] = useState(false);
  const [sessionError, setSessionError] = useState<unknown>();
  const [searchState, setSearchState] = useState<{ benchId: string | undefined; query: string }>({
    benchId: undefined,
    query: "",
  });
  const bench = useQuery({
    queryKey: ["workbench.active"],
    queryFn: () => api.invoke("workbench.config.get", {}),
    retry: false,
  });
  const benchId = bench.data?.config.id;
  const readOnly = bench.data?.readOnly ?? false;
  const sessions = useQuery({
    queryKey: ["session.list", benchId],
    queryFn: () => api.invoke("session.list", {}),
    enabled: !!benchId,
    refetchInterval: 2000,
  });
  const sessionSearch = searchState.benchId === benchId ? searchState.query : "";
  const searchQuery = sessionSearch.trim();
  const searchResults = useQuery({
    queryKey: ["session.search", benchId, searchQuery],
    queryFn: () => api.invoke("session.search", { query: searchQuery }),
    enabled: !!benchId && !!searchQuery,
    refetchInterval: 2000,
  });
  const changed = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["session.list"] });
    void client.invalidateQueries({ queryKey: ["session.search"] });
  }, [client]);
  const benchChanged = useCallback(
    (active?: WorkbenchSnapshot, configOnly = false) => {
      if (!configOnly) {
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
      setActiveSession(id);
      setChat(true);
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
    if (id) setChat(true);
  }, [benchId, sessions.data, activeSession]);
  const operation = useCallback(
    async (action: () => Promise<void>) => {
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
        setSessionPending(false);
      }
    },
    [changed],
  );
  const create = useCallback(() => {
    if (!benchId || readOnly || sessionPending) return;
    void operation(async () => {
      const session = await api.invoke("session.create", {});
      client.setQueryData<SessionSummary[]>(["session.list", benchId], (old) => [session, ...(old ?? [])]);
      select(session.id);
    }).catch(() => {});
  }, [benchId, readOnly, sessionPending, select, operation, client]);
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => node?.focus(), []);
  const info = useQuery({ queryKey: ["app.info"], queryFn: () => api.getAppInfo() });
  const { snapshot, mutation } = usePreferences(info.data?.locale ?? "en");
  const sections = useSettingsSections();
  function navigate(value: boolean) {
    setSettings(value);
    if (!value) setChat(false);
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (globalShortcutBlocked(event)) return;
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setSettings(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        create();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [create]);
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
      <strong>{t("welcome.workbenches")}</strong>
      <label>
        {t("chat.workbench")}
        <select
          aria-label={t("chat.workbench")}
          value={recent.data?.find((entry) => entry.id === benchId)?.folder ?? ""}
          disabled={sessionPending}
          onChange={(e) => {
            if (e.target.value)
              void operation(async () => {
                benchChanged(await api.invoke("workbench.open", { folder: e.target.value }));
              });
          }}
        >
          <option value="">{t("chat.chooseWorkbench")}</option>
          {recent.data
            ?.filter((entry) => !entry.missing)
            .map((entry) => (
              <option key={entry.folder} value={entry.folder}>
                {entry.name}
              </option>
            ))}
        </select>
      </label>
      <button type="button" onClick={() => setChat(false)}>
        {bench.data?.config.name ?? t("welcome.sidebarPlaceholder")}
      </button>
      {benchId && (
        <SessionList
          key={benchId}
          sessions={(searchQuery ? searchResults.data : sessions.data) ?? []}
          search={sessionSearch}
          searchChanged={(query) => setSearchState({ benchId, query })}
          searching={!!searchQuery && searchResults.isFetching}
          searchError={searchQuery ? searchResults.error : null}
          active={activeSession}
          select={select}
          create={create}
          disabled={readOnly || sessionPending}
          rename={(id, title) =>
            operation(async () => {
              await api.invoke("session.rename", { sessionId: id, title });
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
    <DocumentViewerProvider scope={`${benchId}/${activeSession}/${settings}`} workbenchId={benchId ?? ""}>
      <Shell
        settings={settings}
        navigate={navigate}
        navigation={navigation}
        storageReadOnly={!snapshot.data || snapshot.data.readOnly}
        context={
          benchId && chat && !settings ? <ContextTab workbenchId={benchId} readOnly={readOnly} /> : undefined
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
        <div className="page-content" hidden={chat && !settings}>
          <h2 className="page-title" key={settings ? "settings" : "welcome"} ref={focusHeading} tabIndex={-1}>
            {settings ? t("settings.title") : t("welcome.title")}
          </h2>
          {(info.isPending || snapshot.isPending) && (
            <p role="status" data-i18n="home.loading">
              {t("home.loading")}
            </p>
          )}
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
          <div hidden={settings}>
            <p className="muted">{t("welcome.description")}</p>
            {info.data && snapshot.data && (
              <Workbench
                settingsReadOnly={snapshot.data.readOnly}
                active={activeWorkbench}
                changed={benchChanged}
                sessionPending={sessionPending}
              />
            )}
          </div>
        </div>
        {chat && !settings && benchId && (
          <SessionWorkspace
            key={`${benchId}/${activeSession}`}
            id={activeSession}
            changed={changed}
            readOnly={readOnly}
          />
        )}
      </Shell>
    </DocumentViewerProvider>
  );
}
