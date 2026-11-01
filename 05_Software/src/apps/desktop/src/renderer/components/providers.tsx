import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderList, ProviderSave } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { Chatgpt } from "./chatgpt.js";
import { ConsentDialog } from "./consent-dialog.js";
import { ErrorMessage } from "./error-message.js";
import { LmStudioEditor } from "./lmstudio-editor.js";
import { ProviderTest } from "./provider-test.js";

type Custom = ProviderList["custom"][number];
function customVersion(provider: Custom) {
  return JSON.stringify([
    provider.id,
    provider.baseUrl,
    provider.model,
    provider.contextWindow,
    provider.maxOutputTokens,
    provider.hint,
    provider.storage,
    provider.configured,
  ]);
}
type Save = (request: ProviderSave, done: () => void) => Promise<void>;
type Preset = "openai" | "lmstudio" | "ollama" | "other";
type Editor = { kind: "new"; preset: Preset } | { kind: "openai" } | { kind: "custom"; provider: Custom };
const presets = {
  lmstudio: { name: "LM Studio", url: "http://localhost:1234/v1" },
  ollama: { name: "Ollama", url: "http://localhost:11434/v1" },
  other: { name: "", url: "" },
};
export function Providers() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const prefix = useId();
  const list = useQuery({ queryKey: ["providers.list"], queryFn: () => api.invoke("providers.list", {}) });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<Editor>();
  const [consent, setConsent] = useState(false);
  const proposed = useRef<{ request: ProviderSave; done: () => void } | undefined>(undefined);
  useEffect(
    () =>
      api.subscribe("app", () => {
        void client.invalidateQueries({ queryKey: ["providers.list"] });
      }),
    [client],
  );
  useEffect(
    () => () => {
      proposed.current = undefined;
    },
    [],
  );
  async function save(request: ProviderSave, done: () => void) {
    setPending(true);
    setError(undefined);
    try {
      // Keys stay in the imperative call and local draft, outside Query mutation caches.
      const result = await api.invoke("providers.save", request);
      if (result.status === "consent-required") {
        proposed.current = { request, done };
        setConsent(true);
      } else {
        proposed.current = undefined;
        setConsent(false);
        done();
        await list.refetch();
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  function close() {
    setEditing(undefined);
  }
  function cancelConsent() {
    proposed.current?.done();
    proposed.current = undefined;
    setConsent(false);
  }
  async function choice(storageConsent: boolean) {
    const draft = proposed.current;
    if (draft) await save({ ...draft.request, storageConsent }, draft.done);
  }
  async function remove(id: "openai" | `custom:${string}`) {
    setPending(true);
    setError(undefined);
    try {
      await api.invoke("providers.remove", { id });
      await list.refetch();
      close();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  const disabled = pending;
  const openai = list.data?.openai;
  const hasOpenai = !!(openai?.configured || openai?.model);
  const locked = disabled || !!editing;
  return (
    <section className="surface" id="section-providers" data-settings-section="providers">
      <h2 tabIndex={-1}>{t("settings.providers")}</h2>
      <p className="muted">{t("providers.description")}</p>
      <section data-provider-group="subscriptions" className="provider-group">
        <h3>{t("providers.subscriptions")}</h3>
        <Chatgpt disabled={disabled} />
      </section>
      <section data-provider-group="api" className="provider-group">
        <h3>{t("providers.connections")}</h3>
        <p className="muted">{t("providers.multiple")}</p>
        {list.isPending && <p role="status">{t("home.loading")}</p>}
        {(error !== undefined || list.isError) && <ErrorMessage error={error ?? list.error} />}
        {list.isError && (
          <button type="button" onClick={() => void list.refetch()}>
            {t("settings.retry")}
          </button>
        )}
        {pending && <p role="status">{t("providers.saving")}</p>}
        {list.data && (
          <>
            <h4>{t("providers.savedConnections")}</h4>
            {!hasOpenai && list.data.custom.length === 0 && (
              <p className="muted">{t("providers.emptyConnections")}</p>
            )}
            <ul className="provider-list">
              {hasOpenai && openai && (
                <li data-provider="openai">
                  {editing?.kind === "openai" ? (
                    <OpenAIEditor
                      provider={openai}
                      existing
                      disabled={disabled}
                      save={save}
                      close={close}
                      remove={() => void remove("openai")}
                    />
                  ) : (
                    <>
                      <div>
                        <h4>{t("providers.openai")}</h4>
                        {openai.model && <p>{openai.model}</p>}
                        <CredentialStatus provider={openai} />
                      </div>
                      <ProviderTest
                        name={t("providers.openai")}
                        id="openai"
                        version={JSON.stringify(openai)}
                        disabled={pending || !!editing || !openai.configured || !openai.model}
                        before={
                          <button
                            type="button"
                            disabled={locked}
                            aria-label={t("providers.editNamed", { name: t("providers.openai") })}
                            onClick={() => setEditing({ kind: "openai" })}
                          >
                            {t("providers.edit")}
                          </button>
                        }
                        after={
                          <button
                            type="button"
                            disabled={locked}
                            aria-label={t("providers.removeNamed", { name: t("providers.openai") })}
                            onClick={() => void remove("openai")}
                          >
                            {t("providers.remove")}
                          </button>
                        }
                      />
                    </>
                  )}
                </li>
              )}
              {list.data.custom.map((provider) => (
                <li key={provider.id} data-provider={provider.id}>
                  {editing?.kind === "custom" && editing.provider.id === provider.id ? (
                    provider.protocol === "lmstudio" ? (
                      <LmStudioEditor initial={provider} disabled={disabled} save={save} close={close} />
                    ) : (
                      <CustomEditor
                        key={provider.id}
                        initial={provider}
                        preset="other"
                        disabled={disabled}
                        save={save}
                        close={close}
                        remove={() => void remove(provider.id as `custom:${string}`)}
                      />
                    )
                  ) : (
                    <>
                      <div>
                        <h4>{provider.name}</h4>
                        <p>{provider.model}</p>
                        <CredentialStatus provider={provider} keyOptional />
                      </div>
                      <ProviderTest
                        name={provider.name}
                        id={provider.id as `custom:${string}`}
                        version={customVersion(provider)}
                        disabled={pending || !!editing}
                        before={
                          <button
                            type="button"
                            disabled={locked}
                            aria-label={t("providers.editNamed", { name: provider.name })}
                            onClick={() => setEditing({ kind: "custom", provider })}
                          >
                            {t("providers.edit")}
                          </button>
                        }
                        after={
                          <button
                            type="button"
                            disabled={locked}
                            aria-label={t("providers.removeNamed", { name: provider.name })}
                            onClick={() => void remove(provider.id as `custom:${string}`)}
                          >
                            {t("providers.remove")}
                          </button>
                        }
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
            {editing?.kind === "new" ? (
              <section className="provider-card" data-provider-add>
                <h4>{t("providers.add")}</h4>
                <label htmlFor={`${prefix}-preset`}>{t("providers.provider")}</label>
                <select
                  id={`${prefix}-preset`}
                  data-provider-preset
                  value={editing.preset}
                  disabled={disabled}
                  onChange={(event) => setEditing({ kind: "new", preset: event.target.value as Preset })}
                >
                  <option value="openai" disabled={hasOpenai}>
                    {t("providers.openai")}
                  </option>
                  <option value="lmstudio">LM Studio</option>
                  <option value="ollama">Ollama</option>
                  <option value="other">{t("providers.other")}</option>
                </select>
                {editing.preset === "openai" ? (
                  <OpenAIEditor
                    key="openai"
                    provider={list.data.openai}
                    existing={false}
                    disabled={disabled}
                    save={save}
                    close={close}
                    remove={() => {}}
                  />
                ) : editing.preset === "lmstudio" ? (
                  <LmStudioEditor initial={null} disabled={disabled} save={save} close={close} />
                ) : (
                  <CustomEditor
                    key={editing.preset}
                    preset={editing.preset}
                    initial={null}
                    disabled={disabled}
                    save={save}
                    close={close}
                    remove={() => {}}
                  />
                )}
              </section>
            ) : (
              <button
                type="button"
                data-action="add-provider"
                disabled={locked}
                onClick={() => setEditing({ kind: "new", preset: hasOpenai ? "ollama" : "openai" })}
              >
                {t("providers.add")}
              </button>
            )}
          </>
        )}
      </section>
      {consent && <ConsentDialog pending={pending} choice={choice} cancel={cancelConsent} />}
    </section>
  );
}
function CredentialStatus({
  provider,
  keyOptional = false,
}: {
  provider: Pick<ProviderList["openai"], "configured" | "hint" | "storage">;
  keyOptional?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div role="status" className="provider-status">
      <span>
        {provider.configured
          ? t("providers.configured")
          : keyOptional
            ? t("providers.noKey")
            : t("providers.notConfigured")}
      </span>
      {provider.hint && <code data-provider-hint>{provider.hint}</code>}
      {provider.storage === "memory" && <span>{t("providers.memory")}</span>}
      {provider.storage === "unprotected" && <span>{t("providers.unprotected")}</span>}
    </div>
  );
}
function OpenAIEditor({
  provider,
  existing,
  disabled,
  save,
  close,
  remove,
}: {
  provider: ProviderList["openai"];
  existing: boolean;
  disabled: boolean;
  save: Save;
  close: () => void;
  remove: () => void;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const [key, setKey] = useState("");
  const [model, setModel] = useState(provider.model ?? "");
  useEffect(() => setModel(provider.model ?? ""), [provider.model]);
  const done = () => {
    setKey("");
    close();
  };
  const submit = (
    <button type="submit" data-provider-action="save-openai">
      {t("providers.save")}
    </button>
  );
  const cancel = (
    <button type="button" onClick={done}>
      {t("providers.cancel")}
    </button>
  );
  return (
    <form
      aria-label={t("providers.openai")}
      className="workbench-form provider-editor"
      data-provider-editor="openai"
      onSubmit={(event) => {
        event.preventDefault();
        void save({ provider: "openai", ...(key ? { apiKey: key } : {}), model: model.trim() }, done);
      }}
    >
      <fieldset disabled={disabled} className="provider-fields">
        <label htmlFor={`${prefix}-key`}>{t("providers.openaiKey")}</label>
        <input
          id={`${prefix}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          required={!provider.configured}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          maxLength={16384}
        />
        <label htmlFor={`${prefix}-model`}>{t("providers.openaiModel")}</label>
        <input
          id={`${prefix}-model`}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          maxLength={200}
        />
        {existing ? (
          <ProviderTest
            name={t("providers.openai")}
            id="openai"
            version={JSON.stringify(provider)}
            disabled={
              disabled || !provider.configured || !provider.model || !!key || model !== (provider.model ?? "")
            }
            before={submit}
            after={
              <>
                <button
                  type="button"
                  onClick={() => {
                    setKey("");
                    remove();
                  }}
                >
                  {t("providers.remove")}
                </button>
                {cancel}
              </>
            }
          />
        ) : (
          <div className="workbench-actions">
            {submit}
            {cancel}
          </div>
        )}
      </fieldset>
    </form>
  );
}
function CustomEditor({
  initial,
  preset,
  remove,
  disabled,
  save,
  close,
}: {
  initial: Custom | null;
  preset: Exclude<Preset, "openai">;
  remove: () => void;
  disabled: boolean;
  save: Save;
  close: () => void;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const [name, setName] = useState(initial?.name ?? presets[preset].name);
  const [url, setUrl] = useState(initial?.baseUrl ?? presets[preset].url);
  const [model, setModel] = useState(initial?.model ?? "");
  const [context, setContext] = useState(String(initial?.contextWindow ?? 32768));
  const [output, setOutput] = useState(String(initial?.maxOutputTokens ?? 4096));
  const [key, setKey] = useState("");
  const [clear, setClear] = useState(false);
  function done() {
    setKey("");
    close();
  }
  return (
    <form
      aria-label={t("providers.custom")}
      className="workbench-form provider-editor"
      data-provider-editor="custom"
      onSubmit={(event) => {
        event.preventDefault();
        void save(
          {
            provider: "custom",
            ...(initial ? { id: initial.id as `custom:${string}` } : {}),
            config: {
              name,
              baseUrl: url,
              model,
              contextWindow: Number(context),
              maxOutputTokens: Number(output),
            },
            ...(clear ? { apiKey: "" } : key ? { apiKey: key } : {}),
          },
          done,
        );
      }}
    >
      {initial && (
        <h4>
          {t("providers.edit")} — {initial.name}
        </h4>
      )}
      <fieldset disabled={disabled} className="provider-fields">
        <label htmlFor={`${prefix}-name`}>{t("providers.name")}</label>
        <input
          id={`${prefix}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
        />
        <label htmlFor={`${prefix}-url`}>{t("providers.baseUrl")}</label>
        <input
          id={`${prefix}-url`}
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          required
          maxLength={2048}
        />
        <label htmlFor={`${prefix}-model`}>{t("providers.model")}</label>
        <input
          id={`${prefix}-model`}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          required
          maxLength={200}
        />
        <label htmlFor={`${prefix}-context`}>{t("providers.contextWindow")}</label>
        <input
          id={`${prefix}-context`}
          type="number"
          min={1}
          step={1}
          value={context}
          onChange={(event) => setContext(event.target.value)}
          required
        />
        <label htmlFor={`${prefix}-output`}>{t("providers.maxOutput")}</label>
        <input
          id={`${prefix}-output`}
          type="number"
          min={1}
          step={1}
          value={output}
          onChange={(event) => setOutput(event.target.value)}
          required
        />
        <label htmlFor={`${prefix}-key`}>{t("providers.endpointKey")}</label>
        <input
          id={`${prefix}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            setClear(false);
          }}
          disabled={clear}
          maxLength={16384}
        />
        <p className="muted">{t("providers.optionalKey")}</p>
        {initial?.storage && (
          <label className="provider-checkbox">
            <input
              type="checkbox"
              checked={clear}
              onChange={(event) => {
                setClear(event.target.checked);
                setKey("");
              }}
            />
            {t("providers.clearKey")}
          </label>
        )}
        {initial ? (
          <ProviderTest
            name={initial.name}
            id={initial.id as `custom:${string}`}
            version={customVersion(initial)}
            disabled={
              disabled ||
              name !== initial.name ||
              url !== initial.baseUrl ||
              model !== initial.model ||
              Number(context) !== initial.contextWindow ||
              Number(output) !== initial.maxOutputTokens ||
              !!key ||
              clear
            }
            before={
              <button type="submit" data-provider-action="save-custom">
                {t("providers.save")}
              </button>
            }
            after={
              <>
                <button
                  type="button"
                  onClick={() => {
                    setKey("");
                    remove();
                  }}
                >
                  {t("providers.remove")}
                </button>
                <button type="button" onClick={done}>
                  {t("providers.cancel")}
                </button>
              </>
            }
          />
        ) : (
          <div className="workbench-actions">
            <button type="submit" data-provider-action="save-custom">
              {t("providers.save")}
            </button>
            <button type="button" onClick={done}>
              {t("providers.cancel")}
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
