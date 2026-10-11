import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderList, ProviderSave } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

type Custom = ProviderList["custom"][number];
type Save = (request: ProviderSave, done: () => void) => Promise<void>;
export function Providers({ readOnly }: { readOnly: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["providers.list"], queryFn: () => api.invoke("providers.list", {}) });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<Custom | null | undefined>();
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
      // Imperative invoke avoids putting key-bearing variables into Query's mutation cache.
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
  function cancelConsent() {
    proposed.current?.done();
    proposed.current = undefined;
    setConsent(false);
  }
  async function choice(storageConsent: boolean) {
    const draft = proposed.current;
    if (!draft) return;
    await save({ ...draft.request, storageConsent }, draft.done);
  }
  async function remove(id: "openai" | `custom:${string}`) {
    setPending(true);
    setError(undefined);
    try {
      await api.invoke("providers.remove", { id });
      await list.refetch();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  const disabled = readOnly || !!list.data?.readOnly || pending;
  return (
    <section className="surface" id="section-providers" data-settings-section="providers">
      <h2 tabIndex={-1}>{t("settings.providers")}</h2>
      <p className="muted">{t("providers.description")}</p>
      {(error !== undefined || list.isError) && <ErrorMessage error={error ?? list.error} />}
      {list.isError && (
        <button type="button" onClick={() => void list.refetch()}>
          {t("settings.retry")}
        </button>
      )}
      {pending && <p role="status">{t("providers.saving")}</p>}
      {list.data && (
        <>
          <OpenAI
            provider={list.data.openai}
            disabled={disabled}
            save={save}
            remove={() => void remove("openai")}
          />
          <h3>{t("providers.custom")}</h3>
          <ul className="provider-list">
            {list.data.custom.map((provider) => (
              <li key={provider.id} data-provider={provider.id}>
                <div>
                  <h4>{provider.name}</h4>
                  <p className="path-text">{provider.baseUrl}</p>
                  <p>{provider.model}</p>
                  <CredentialStatus provider={provider} />
                </div>
                <div className="workbench-actions">
                  <button
                    type="button"
                    disabled={disabled || editing !== undefined}
                    onClick={() => setEditing(provider)}
                  >
                    {t("providers.edit")}
                  </button>
                  <button
                    type="button"
                    disabled={disabled || editing !== undefined}
                    onClick={() => void remove(provider.id as `custom:${string}`)}
                  >
                    {t("providers.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {editing === undefined ? (
            <button type="button" disabled={disabled} onClick={() => setEditing(null)}>
              {t("providers.add")}
            </button>
          ) : (
            <CustomEditor
              initial={editing}
              disabled={disabled}
              save={save}
              close={() => setEditing(undefined)}
            />
          )}
        </>
      )}
      {consent && <ConsentDialog pending={pending} choice={choice} cancel={cancelConsent} />}
    </section>
  );
}
function CredentialStatus({
  provider,
}: {
  provider: Pick<ProviderList["openai"], "configured" | "hint" | "storage">;
}) {
  const { t } = useTranslation();
  return (
    <div role="status" className="provider-status">
      <span>{provider.configured ? t("providers.configured") : t("providers.notConfigured")}</span>
      {provider.hint && <code data-provider-hint>{provider.hint}</code>}
      {provider.storage === "memory" && <span>{t("providers.memory")}</span>}
      {provider.storage === "unprotected" && <span>{t("providers.unprotected")}</span>}
    </div>
  );
}
function OpenAI({
  provider,
  disabled,
  save,
  remove,
}: {
  provider: ProviderList["openai"];
  disabled: boolean;
  save: Save;
  remove: () => void;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const [key, setKey] = useState("");
  const [model, setModel] = useState(provider.model ?? "");
  useEffect(() => setModel(provider.model ?? ""), [provider.model]);
  return (
    <div data-provider="openai" className="provider-card">
      <h3>{t("providers.openai")}</h3>
      <CredentialStatus provider={provider} />
      <form
        aria-label={t("providers.openai")}
        className="workbench-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            {
              provider: "openai",
              ...(key ? { apiKey: key } : {}),
              model: model.trim(),
            },
            () => setKey(""),
          );
        }}
      >
        <fieldset disabled={disabled} className="provider-fields">
          <label htmlFor={`${prefix}-key`}>{t("providers.openaiKey")}</label>
          <input
            id={`${prefix}-key`}
            type="password"
            autoComplete="off"
            spellCheck={false}
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
          <div className="workbench-actions">
            <button type="submit" data-provider-action="save-openai">
              {t("providers.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setKey("");
                remove();
              }}
            >
              {t("providers.remove")}
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
function CustomEditor({
  initial,
  disabled,
  save,
  close,
}: {
  initial: Custom | null;
  disabled: boolean;
  save: Save;
  close: () => void;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [url, setUrl] = useState(initial?.baseUrl ?? "http://localhost:11434/v1");
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
      className="workbench-form provider-card"
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
      <h3>{initial ? t("providers.edit") : t("providers.add")}</h3>
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
        <div className="workbench-actions">
          <button type="submit" data-provider-action="save-custom">
            {t("providers.save")}
          </button>
          <button type="button" onClick={done}>
            {t("providers.cancel")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function ConsentDialog({
  pending,
  choice,
  cancel,
}: {
  pending: boolean;
  choice: (consent: boolean) => Promise<void>;
  cancel: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const text = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="pinned-dialog"
      aria-labelledby={title}
      aria-describedby={text}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) cancel();
      }}
    >
      <h3 id={title}>{t("providers.consentTitle")}</h3>
      <p id={text}>{t("providers.consentWarning")}</p>
      <div className="workbench-actions">
        <button type="button" disabled={pending} onClick={() => void choice(false)}>
          {t("providers.memoryChoice")}
        </button>
        <button type="button" disabled={pending} onClick={() => void choice(true)}>
          {t("providers.diskChoice")}
        </button>
        <button type="button" disabled={pending} onClick={cancel}>
          {t("providers.cancel")}
        </button>
      </div>
    </dialog>
  );
}
