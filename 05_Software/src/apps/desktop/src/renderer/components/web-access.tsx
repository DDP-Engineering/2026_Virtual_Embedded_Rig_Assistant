import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Response,
  type WebAccessSave,
  type WebAccessSnapshot,
  type WebAccessTestResult,
  type WebProviderId,
  webProviderIds,
  webProviders,
} from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { BrowserSettings } from "./browser-settings.js";
import { ConsentDialog } from "./consent-dialog.js";
import { ErrorMessage } from "./error-message.js";
import { SettingsPageHeader } from "./settings-page-header.js";
import "./web-access.css";

export function WebAccessPanel({ dirtyChanged }: { dirtyChanged?: ((dirty: boolean) => void) | undefined }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["web.access.get"], queryFn: () => api.invoke("web.access.get", {}) });
  if (query.data) return <WebAccessForm snapshot={query.data} dirtyChanged={dirtyChanged} />;
  return (
    <section className="surface web-access" data-settings-section="web">
      <h2>{t("settings.webAccess")}</h2>
      {query.isPending && <p role="status">{t("webAccess.loading")}</p>}
      {query.error && <ErrorMessage error={query.error} />}
    </section>
  );
}

/**
 * Web search and Interactive Browser share one page draft: the page header Save writes the search settings and
 * the two browser switches; Test connection, Remove key and the browser runtime buttons act at once.
 */
function WebAccessForm({
  snapshot,
  dirtyChanged,
}: {
  snapshot: WebAccessSnapshot;
  dirtyChanged?: ((dirty: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const storageDescriptions = {
    encrypted: t("webAccess.storage.encrypted"),
    unprotected: t("webAccess.storage.unprotected"),
    memory: t("webAccess.storage.memory"),
  };
  const client = useQueryClient();
  const [provider, setProvider] = useState<WebProviderId>(snapshot.preferences.provider);
  const keyMetadata = snapshot.keys[provider];
  const providerName = webProviders[provider].name;
  const [enabled, setEnabled] = useState(snapshot.preferences.enabled);
  const [authentication, setAuthentication] = useState(snapshot.preferences.authentication);
  const [key, setKey] = useState("");
  const browser = useQuery({
    queryKey: ["browser.settings.get"],
    queryFn: () => api.invoke("browser.settings.get", {}),
    refetchInterval: 500,
    networkMode: "always",
  });
  // Browser switch edits; undefined keeps the saved value.
  const [appBrowser, setAppBrowser] = useState<boolean>();
  const [benchBrowser, setBenchBrowser] = useState<boolean>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const [consent, setConsent] = useState(false);
  const savingNow = useRef(false);
  const [testing, setTesting] = useState(false),
    [visible, setVisible] = useState(false);
  const [result, setResult] = useState<WebAccessTestResult>();
  const [testError, setTestError] = useState<unknown>();
  const attempt = useRef<string | undefined>(undefined);
  const alive = useRef(true);
  const generation = useRef(0);
  const testTrigger = useRef<HTMLButtonElement>(null);
  const focusAfterClose = useRef(false);
  useEffect(() => {
    if (!visible && !testing && focusAfterClose.current) {
      focusAfterClose.current = false;
      testTrigger.current?.focus();
    }
  }, [visible, testing]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      if (attempt.current) void api.invoke("web.access.cancel", { testId: attempt.current }).catch(() => {});
    };
  }, []);
  const bench = browser.data?.workbench;
  const savedApp = browser.data?.appEnabled ?? false;
  const appValue = appBrowser ?? savedApp;
  const benchValue = benchBrowser ?? bench?.enabled ?? false;
  const appDirty = appBrowser !== undefined && appBrowser !== savedApp;
  const benchDirty = Boolean(bench) && benchBrowser !== undefined && benchBrowser !== bench?.enabled;
  const webDirty =
    enabled !== snapshot.preferences.enabled ||
    provider !== snapshot.preferences.provider ||
    authentication !== snapshot.preferences.authentication ||
    key.trim() !== "";
  const dirty = webDirty || appDirty || benchDirty;
  useEffect(() => dirtyChanged?.(dirty), [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
  const missingKey = authentication === "api-key" && !key.trim() && !keyMetadata.keyConfigured;
  const refresh = async () => {
    const current = await api.invoke("web.access.get", {});
    client.setQueryData(["web.access.get"], current);
    return current;
  };
  const reset = () => {
    setEnabled(snapshot.preferences.enabled);
    setProvider(snapshot.preferences.provider);
    setAuthentication(snapshot.preferences.authentication);
    setKey("");
    setAppBrowser(undefined);
    setBenchBrowser(undefined);
    setError(undefined);
  };
  const save = async (storageConsent?: boolean) => {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError(undefined);
    try {
      if (webDirty) {
        const request: WebAccessSave = {
          enabled,
          provider,
          authentication,
          ...(authentication === "api-key" && key.trim() ? { apiKey: key.trim() } : {}),
          ...(storageConsent === undefined ? {} : { storageConsent }),
        };
        const response = await api.invoke("web.access.save", request);
        if (response.status === "consent-required") {
          setConsent(true);
          return;
        }
        setConsent(false);
        setKey("");
        await refresh();
      }
      if (appDirty) {
        const changed = await api.updateSettings({ interactiveBrowser: appValue });
        await client.cancelQueries({ queryKey: ["app.settings"] });
        client.setQueryData(["app.settings"], changed);
      }
      if (benchDirty && bench) {
        const changed = await api.invoke("workbench.config.update", {
          workbenchId: bench.id,
          patch: { interactive_browser: benchValue },
        });
        await client.cancelQueries({ queryKey: ["workbench.active"] });
        client.setQueryData<Response<"workbench.config.get"> | null>(["workbench.active"], (current) =>
          current?.config.id === bench.id ? { ...current, ...changed } : current,
        );
      }
      if (appDirty || benchDirty) await browser.refetch();
      setAppBrowser(undefined);
      setBenchBrowser(undefined);
    } catch (failure) {
      setError(failure);
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  };
  const remove = async () => {
    if (savingNow.current) return;
    savingNow.current = true;
    setSaving(true);
    setError(undefined);
    try {
      await api.invoke("web.access.removeKey", { provider });
      setAuthentication(webProviders[provider].anonymous ? "anonymous" : "api-key");
      setKey("");
      const current = await refresh();
      setEnabled(current.preferences.enabled);
    } catch (failure) {
      setError(failure);
    } finally {
      savingNow.current = false;
      setSaving(false);
    }
  };
  const runTest = async () => {
    if (attempt.current) return;
    const id = crypto.randomUUID(),
      current = ++generation.current;
    attempt.current = id;
    setVisible(true);
    setTesting(true);
    setResult(undefined);
    setTestError(undefined);
    try {
      const response = await api.invoke("web.access.test", {
        testId: id,
        provider,
        authentication,
        ...(authentication === "api-key" && key.trim() ? { apiKey: key.trim() } : {}),
      });
      if (alive.current && generation.current === current) setResult(response);
    } catch (failure) {
      if (alive.current && generation.current === current) setTestError(failure);
    } finally {
      if (attempt.current === id) {
        attempt.current = undefined;
        if (alive.current) setTesting(false);
      }
    }
  };
  const closeTest = () => {
    focusAfterClose.current = true;
    setVisible(false);
    generation.current++;
    if (attempt.current) void api.invoke("web.access.cancel", { testId: attempt.current }).catch(() => {});
  };
  const disabled = saving || testing;
  const valid = !(enabled && missingKey);
  return (
    <section className="surface web-access" data-settings-section="web">
      <SettingsPageHeader
        title={t("settings.webAccess")}
        i18n="settings.webAccess"
        dirty={dirty}
        valid={valid}
        saving={saving}
        onCancel={reset}
        onSave={() => void save()}
      />
      <div className="web-access-columns">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (dirty && valid) void save();
          }}
        >
          <fieldset disabled={disabled}>
            <label className="web-access-toggle">
              <input
                id="web-enabled"
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {t("webAccess.enabled")}
            </label>
            <label className="web-access-field" htmlFor="web-provider">
              {t("webAccess.provider")}
              <select
                id="web-provider"
                value={provider}
                onChange={(event) => {
                  const next = event.target.value as WebProviderId;
                  setProvider(next);
                  setKey("");
                  setError(undefined);
                  setAuthentication(
                    next === snapshot.preferences.provider
                      ? snapshot.preferences.authentication
                      : webProviders[next].anonymous
                        ? "anonymous"
                        : "api-key",
                  );
                }}
              >
                {webProviderIds.map((id) => (
                  <option key={id} value={id}>
                    {webProviders[id].name}
                  </option>
                ))}
              </select>
            </label>
            <label className="web-access-field" htmlFor="web-authentication">
              {t("webAccess.authentication")}
              <select
                id="web-authentication"
                value={authentication}
                onChange={(event) => setAuthentication(event.target.value as typeof authentication)}
              >
                {webProviders[provider].anonymous && (
                  <option value="anonymous">{t("webAccess.anonymous")}</option>
                )}
                <option value="api-key">{t("webAccess.apiKeyMode")}</option>
              </select>
            </label>
            {authentication === "api-key" && (
              <label className="web-access-field" htmlFor="web-api-key">
                {t("webAccess.apiKey", { provider: providerName })}
                <input
                  id="web-api-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  placeholder={keyMetadata.keyConfigured ? t("webAccess.keepKey") : ""}
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
            )}
            {keyMetadata.keyConfigured && (
              <p data-web-key-status>
                {t("webAccess.storedKey", { storage: storageDescriptions[keyMetadata.storage ?? "memory"] })}
              </p>
            )}
            {missingKey && <p className="muted">{t("webAccess.keyRequired")}</p>}
            <div className="workbench-actions">
              <button
                type="button"
                data-web-test
                ref={testTrigger}
                disabled={testing || !enabled || !snapshot.preferences.enabled || missingKey}
                onClick={() => void runTest()}
              >
                {t("webAccess.test")}
              </button>
              {keyMetadata.keyConfigured && (
                <button type="button" data-web-remove onClick={() => void remove()}>
                  {t("webAccess.removeKey")}
                </button>
              )}
            </div>
          </fieldset>
          {Boolean(error) && <ErrorMessage error={error} />}
        </form>
        <BrowserSettings
          settings={browser.data}
          error={browser.error}
          refetch={() => browser.refetch()}
          appEnabled={appValue}
          workbenchEnabled={benchValue}
          setApp={setAppBrowser}
          setWorkbench={setBenchBrowser}
          disabled={saving}
        />
      </div>
      {consent && <ConsentDialog pending={saving} choice={save} cancel={() => setConsent(false)} />}
      {visible && (
        <WebTestDialog
          provider={provider}
          testing={testing}
          result={result}
          error={testError}
          close={closeTest}
        />
      )}
    </section>
  );
}

function WebTestDialog({
  provider,
  testing,
  result,
  error,
  close,
}: {
  provider: WebProviderId;
  testing: boolean;
  result: WebAccessTestResult | undefined;
  error: unknown;
  close: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null),
    title = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog web-test-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h3 id={title}>{t("webAccess.testTitle")}</h3>
      <div className="web-test-body" aria-live="polite" aria-busy={testing}>
        {testing && <p>{t("webAccess.testing", { provider: webProviders[provider].name })}</p>}
        {result && (
          <>
            <p data-web-test-status={result.status}>
              {
                {
                  pass: t("webAccess.results.pass"),
                  fail: t("webAccess.results.fail"),
                  disabled: t("webAccess.results.disabled"),
                  "key-required": t("webAccess.results.key-required"),
                  cancelled: t("webAccess.results.cancelled"),
                }[result.status]
              }
            </p>
            <p className="muted">
              {webProviders[result.provider].name} ·{" "}
              {result.authentication === "anonymous" ? t("webAccess.anonymous") : t("webAccess.apiKeyMode")}
            </p>
          </>
        )}
        {Boolean(error) && <ErrorMessage error={error} />}
      </div>
      <footer>
        <button type="button" data-web-close onClick={close}>
          {t("webAccess.close")}
        </button>
      </footer>
    </dialog>
  );
}
