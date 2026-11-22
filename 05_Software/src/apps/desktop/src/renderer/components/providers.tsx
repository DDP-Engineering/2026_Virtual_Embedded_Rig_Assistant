// REQ-UX-fe31a037
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { curatedProviderPresets, type ProviderList, type ProviderSave } from "@vera/shared";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { Chatgpt } from "./chatgpt.js";
import { ConsentDialog } from "./consent-dialog.js";
import { CustomEditor, customVersion } from "./custom-provider-editor.js";
import { ErrorMessage } from "./error-message.js";
import { LmStudioEditor } from "./lmstudio-editor.js";
import { type ProviderId, ProviderModels } from "./provider-models.js";
import { ProviderPresetSelector } from "./provider-preset-selector.js";
import { ProviderTest } from "./provider-test.js";
import { SettingsPageHeader } from "./settings-page-header.js";
import "./providers.css";

type Custom = ProviderList["custom"][number];
type Save = (request: ProviderSave, done: () => void) => Promise<void>;
type Editor = { kind: "new"; preset: string } | { kind: "openai" } | { kind: "custom"; provider: Custom };

/**
 * Connected providers as cards with their models as checkboxes (a page draft saved with the header Save) and one
 * Add provider action that opens a dialog with the provider dropdown and its connection editor.
 */
export function Providers({ dirtyChanged }: { dirtyChanged?: ((dirty: boolean) => void) | undefined }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["providers.list"], queryFn: () => api.invoke("providers.list", {}) });
  const subscription = useQuery({
    queryKey: ["chatgpt.status"],
    queryFn: () => api.invoke("providers.chatgpt.status", {}),
    staleTime: 0,
    refetchInterval: ({ state: { data } }) =>
      data?.state === "pending" || data?.state === "manual" ? 1000 : false,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<Editor>();
  const [consent, setConsent] = useState(false);
  const [ticks, setTicks] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [savingTicks, setSavingTicks] = useState(false);
  const proposed = useRef<{ request: ProviderSave; done: () => void } | undefined>(undefined);
  const dirty = Object.keys(ticks).length > 0;
  useEffect(() => dirtyChanged?.(dirty), [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
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
  const connected = subscription.data?.connected === true;
  // Signing out removes the subscription card, so its pending ticks go too.
  useEffect(() => {
    if (!connected) setTicks(({ chatgpt: _signedOut, ...rest }) => rest);
  }, [connected]);
  // A sign-in started from the dialog closes it once the subscription is connected.
  useEffect(() => {
    if (connected && editing?.kind === "new" && editing.preset === "chatgpt") setEditing(undefined);
  }, [connected, editing]);
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
        // A changed key, address or model changes what the provider lists on its card.
        void client.invalidateQueries({ queryKey: ["providers.catalog"] });
      }
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  function close() {
    setEditing(undefined);
    setError(undefined);
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
      setTicks(({ [id]: _removed, ...rest }) => rest);
      await list.refetch();
      void client.invalidateQueries({ queryKey: ["providers.catalog"] });
      close();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  async function saveTicks() {
    setSavingTicks(true);
    setError(undefined);
    try {
      await api.invoke("providers.models.enable", {
        providers: Object.entries(ticks).map(([id, models]) => ({
          id: id as ProviderId,
          models: models ?? null,
        })),
      });
      await list.refetch();
      setTicks({});
    } catch (failure) {
      setError(failure);
    } finally {
      setSavingTicks(false);
    }
  }
  const disabled = pending || savingTicks;
  const openai = list.data?.openai;
  const hasOpenai = !!(openai?.configured || openai?.model);
  const locked = disabled || !!editing;
  const newPreset =
    editing?.kind === "new"
      ? curatedProviderPresets.find((preset) => preset.id === editing.preset)
      : undefined;
  const models = (id: ProviderId, enabled: readonly string[] | undefined) => (
    <ProviderModels
      id={id}
      enabled={enabled}
      ticked={ticks[id]}
      disabled={disabled}
      change={(next) => setTicks((current) => ({ ...current, [id]: next }))}
    />
  );
  const editedName =
    editing?.kind === "openai"
      ? t("providers.openai")
      : editing?.kind === "custom"
        ? editing.provider.name
        : undefined;
  return (
    <section className="surface providers-page" id="section-providers" data-settings-section="providers">
      <SettingsPageHeader
        title={t("settings.providers")}
        i18n="settings.providers"
        dirty={dirty}
        saving={savingTicks}
        onCancel={() => setTicks({})}
        onSave={() => void saveTicks()}
      />
      <div className="workbench-actions">
        <button
          type="button"
          data-action="add-provider"
          disabled={locked || !list.data}
          onClick={() =>
            setEditing({ kind: "new", preset: connected ? (hasOpenai ? "ollama" : "openai") : "chatgpt" })
          }
        >
          {t("providers.add")}
        </button>
      </div>
      {list.isPending && <p role="status">{t("home.loading")}</p>}
      {((error !== undefined && !editing) || list.isError) && <ErrorMessage error={error ?? list.error} />}
      {list.isError && (
        <button type="button" onClick={() => void list.refetch()}>
          {t("settings.retry")}
        </button>
      )}
      {list.data && (
        <div className="provider-cards">
          {connected && (
            <article className="provider-card" data-provider="chatgpt">
              <Chatgpt disabled={disabled} />
              {models("chatgpt", list.data.chatgpt.enabledModels)}
            </article>
          )}
          {hasOpenai && openai && (
            <article className="provider-card" data-provider="openai">
              <header>
                <h3>{t("providers.openai")}</h3>
                <CredentialStatus provider={openai} />
              </header>
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
              {openai.configured && models("openai", openai.enabledModels)}
            </article>
          )}
          {list.data.custom.map((provider) => {
            const curated = curatedProviderPresets.find(({ id }) => id === provider.preset?.id);
            const binding = curated?.bindings.find(({ id }) => id === provider.preset?.binding);
            const id = provider.id as `custom:${string}`;
            return (
              <article key={provider.id} className="provider-card" data-provider={provider.id}>
                <header>
                  <h3>{provider.name}</h3>
                  {curated && (curated.label !== provider.name || binding?.label) && (
                    <p>{[curated.label, binding?.label].filter(Boolean).join(" · ")}</p>
                  )}
                  <CredentialStatus provider={provider} keyOptional={!provider.preset} />
                </header>
                <ProviderTest
                  name={provider.name}
                  id={id}
                  version={customVersion(provider)}
                  disabled={pending || !!editing || !provider.configured}
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
                      onClick={() => void remove(id)}
                    >
                      {t("providers.remove")}
                    </button>
                  }
                />
                {provider.configured && models(id, provider.enabledModels)}
              </article>
            );
          })}
        </div>
      )}
      {editing && list.data && (
        <ProviderDialog
          title={editedName ? t("providers.editNamed", { name: editedName }) : t("providers.add")}
          busy={pending}
          close={close}
        >
          {editing.kind === "new" && (
            <ProviderPresetSelector
              value={editing.preset}
              change={(preset) => setEditing({ kind: "new", preset })}
              disabled={disabled}
              hasOpenai={hasOpenai}
              hasChatgpt={connected}
            />
          )}
          {pending && <p role="status">{t("providers.saving")}</p>}
          {editing.kind === "new" && editing.preset === "chatgpt" ? (
            <Chatgpt disabled={disabled} />
          ) : editing.kind === "openai" || (editing.kind === "new" && editing.preset === "openai") ? (
            <OpenAIEditor
              key="openai"
              provider={list.data.openai}
              existing={editing.kind === "openai"}
              disabled={disabled}
              save={save}
              close={close}
              remove={() => void remove("openai")}
            />
          ) : editing.kind === "custom" ? (
            editing.provider.protocol === "lmstudio" ? (
              <LmStudioEditor initial={editing.provider} disabled={disabled} save={save} close={close} />
            ) : (
              <CustomEditor
                key={editing.provider.id}
                initial={editing.provider}
                preset="other"
                curated={curatedProviderPresets.find(({ id }) => id === editing.provider.preset?.id)}
                disabled={disabled}
                save={save}
                close={close}
                remove={() => void remove(editing.provider.id as `custom:${string}`)}
              />
            )
          ) : editing.preset === "lmstudio" ? (
            <LmStudioEditor initial={null} disabled={disabled} save={save} close={close} />
          ) : (
            <CustomEditor
              key={editing.preset}
              preset={editing.preset === "ollama" ? "ollama" : "other"}
              curated={newPreset}
              initial={null}
              disabled={disabled}
              save={save}
              close={close}
              remove={() => {}}
            />
          )}
          {error !== undefined && <ErrorMessage error={error} />}
        </ProviderDialog>
      )}
      {consent && <ConsentDialog pending={pending} choice={choice} cancel={cancelConsent} />}
    </section>
  );
}

/** A modal for one connection; Escape or the editor's Cancel closes it and focus returns to its opener. */
function ProviderDialog({
  title,
  busy,
  close,
  children,
}: {
  title: string;
  busy: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const node = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (node && !node.open) node.showModal();
    return () => {
      node?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="pinned-dialog provider-dialog"
      aria-labelledby={heading}
      data-provider-dialog
      onCancel={(event) => {
        event.preventDefault();
        // A save in progress finishes before the dialog can close.
        if (!busy) close();
      }}
    >
      <h3 id={heading}>{title}</h3>
      <div className="provider-dialog-body">{children}</div>
    </dialog>
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
