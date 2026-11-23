// REQ-UX-fe31a037
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  curatedProviderPresets,
  type ModelProfile,
  type ProviderList,
  type ProviderSave,
} from "@vera/shared";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { Chatgpt } from "./chatgpt.js";
import { ConsentDialog } from "./consent-dialog.js";
import { CustomEditor, customVersion } from "./custom-provider-editor.js";
import { ErrorMessage } from "./error-message.js";
import { LmStudioEditor, LmStudioModelEditor } from "./lmstudio-editor.js";
import { OpenAIEditor } from "./openai-provider-editor.js";
import { type ProviderId, ProviderModels } from "./provider-models.js";
import { ProviderPresetSelector } from "./provider-preset-selector.js";
import { ProviderTest } from "./provider-test.js";
import { SettingsPageHeader } from "./settings-page-header.js";
import "./providers.css";

type Custom = ProviderList["custom"][number];
type Editor =
  | { kind: "new"; preset: string }
  | { kind: "openai" }
  | { kind: "custom"; provider: Custom }
  | { kind: "model"; provider: Custom; model: ModelProfile };

export function Providers({
  defaultModel = null,
  dirtyChanged,
}: {
  defaultModel?: string | null;
  dirtyChanged?: ((dirty: boolean) => void) | undefined;
}) {
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
  const [selectedId, setSelectedId] = useState<ProviderId>();
  const [draftDefault, setDraftDefault] = useState<string | null>();
  const [ticks, setTicks] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [savingTicks, setSavingTicks] = useState(false);
  const proposed = useRef<{ request: ProviderSave; done: () => void } | undefined>(undefined);
  const effectiveDefault = draftDefault === undefined ? defaultModel : draftDefault;
  const changedDefault = draftDefault !== undefined && draftDefault !== defaultModel;
  const dirty = Object.keys(ticks).length > 0 || changedDefault;
  useEffect(() => dirtyChanged?.(dirty), [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type === "settings.changed")
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
    if (!connected) {
      setTicks(({ chatgpt: _signedOut, ...rest }) => rest);
      setDraftDefault((current) => (current?.startsWith("chatgpt/") ? undefined : current));
    }
  }, [connected]);
  // A sign-in started from the dialog closes it once the subscription is connected.
  useEffect(() => {
    if (connected && editing?.kind === "new" && editing.preset === "chatgpt") {
      setSelectedId("chatgpt");
      setEditing(undefined);
    }
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
        const fresh = await list.refetch();
        if (request.provider === "openai") setSelectedId("openai");
        else {
          const id =
            request.id ?? fresh.data?.custom.find(({ name }) => name === request.config.name.trim())?.id;
          if (id) setSelectedId(id as `custom:${string}`);
        }
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
      setDraftDefault((current) => (current?.startsWith(`${id}/`) ? undefined : current));
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
        ...(changedDefault ? { defaultModel: draftDefault } : {}),
      });
      await Promise.all([list.refetch(), client.invalidateQueries({ queryKey: ["app.settings"] })]);
      setTicks({});
      setDraftDefault(undefined);
    } catch (failure) {
      setError(failure);
    } finally {
      setSavingTicks(false);
    }
  }
  const disabled = pending || savingTicks;
  const openai = list.data?.openai;
  const hasOpenai = openai?.configured === true;
  const locked = disabled || !!editing;
  const custom = list.data?.custom ?? [];
  const connectedProviders: { id: ProviderId; name: string }[] = [
    ...(connected ? [{ id: "chatgpt" as const, name: t("chatgpt.title") }] : []),
    ...(hasOpenai ? [{ id: "openai" as const, name: t("providers.openai") }] : []),
    ...custom.map(({ id, name }) => ({ id: id as `custom:${string}`, name })),
  ];
  const selected = connectedProviders.find(({ id }) => id === selectedId) ?? connectedProviders[0];
  const connection = custom.find(({ id }) => id === selected?.id);
  const curated = curatedProviderPresets.find(({ id }) => id === connection?.preset?.id);
  const binding = curated?.bindings.find(({ id }) => id === connection?.preset?.binding);
  const newPreset =
    editing?.kind === "new"
      ? curatedProviderPresets.find((preset) => preset.id === editing.preset)
      : undefined;
  const editedName =
    editing?.kind === "openai"
      ? t("providers.openai")
      : editing?.kind === "custom"
        ? editing.provider.name
        : undefined;
  const providerEnabled =
    selected?.id === "chatgpt"
      ? list.data?.chatgpt.enabledModels
      : selected?.id === "openai"
        ? openai?.enabledModels
        : connection?.enabledModels;
  const testModel =
    selected && defaultModel?.startsWith(`${selected.id}/`)
      ? defaultModel.slice(selected.id.length + 1)
      : undefined;
  const editModel = (id: string) => {
    const model = connection?.models?.find((item) => item.id === id);
    if (model && connection) setEditing({ kind: "model", model, provider: connection });
  };
  return (
    <section className="surface providers-page" id="section-providers" data-settings-section="providers">
      <SettingsPageHeader
        title={t("settings.providers")}
        i18n="settings.providers"
        dirty={dirty}
        valid={!locked}
        saving={savingTicks}
        onCancel={() => {
          setTicks({});
          setDraftDefault(undefined);
        }}
        onSave={() => void saveTicks()}
      />
      {list.isPending && <p role="status">{t("home.loading")}</p>}
      {((error !== undefined && !editing) || list.isError) && <ErrorMessage error={error ?? list.error} />}
      {list.isError && (
        <button type="button" onClick={() => void list.refetch()}>
          {t("settings.retry")}
        </button>
      )}
      {list.data && (
        <div className="provider-workspace">
          <div className="provider-directory">
            <button
              type="button"
              data-action="add-provider"
              disabled={locked}
              onClick={() =>
                setEditing({ kind: "new", preset: connected ? (hasOpenai ? "ollama" : "openai") : "chatgpt" })
              }
            >
              {t("providers.add")}
            </button>
            <ul aria-label={t("providers.connectedList")}>
              {connectedProviders.map(({ id, name }) => (
                <li key={id}>
                  <button
                    type="button"
                    data-provider-option={id}
                    aria-current={selected?.id === id || undefined}
                    onClick={() => setSelectedId(id)}
                  >
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {selected && (
            <article className="provider-detail" data-provider={selected.id} key={selected.id}>
              {selected.id === "chatgpt" ? (
                <Chatgpt disabled={locked} test={{ model: testModel }} />
              ) : (
                <>
                  <header>
                    <h3>{selected.name}</h3>
                    {curated && (curated.label !== selected.name || binding?.label) && (
                      <p>{[curated.label, binding?.label].filter(Boolean).join(" · ")}</p>
                    )}
                    {connection && (
                      <CredentialStatus provider={connection} keyOptional={!connection.preset} />
                    )}
                    {selected.id === "openai" && openai && <CredentialStatus provider={openai} />}
                  </header>
                  <ProviderTest
                    id={selected.id}
                    name={selected.name}
                    model={testModel}
                    version={
                      connection
                        ? customVersion(connection, testModel)
                        : JSON.stringify([openai?.model, openai?.configured, openai?.hint])
                    }
                    disabled={
                      locked ||
                      (selected.id === "openai"
                        ? !openai?.configured || !(openai?.model || testModel)
                        : connection?.configured === false)
                    }
                    before={
                      <button
                        type="button"
                        disabled={locked}
                        aria-label={t("providers.editNamed", { name: selected.name })}
                        onClick={() =>
                          setEditing(
                            connection ? { kind: "custom", provider: connection } : { kind: "openai" },
                          )
                        }
                      >
                        {t("providers.edit")}
                      </button>
                    }
                    after={
                      <button
                        type="button"
                        disabled={locked}
                        aria-label={t("providers.removeNamed", { name: selected.name })}
                        onClick={() => {
                          if (selected.id !== "chatgpt") void remove(selected.id);
                        }}
                      >
                        {t("providers.remove")}
                      </button>
                    }
                  />
                </>
              )}
              {(selected.id === "chatgpt" ||
                (openai?.configured && selected.id === "openai") ||
                connection?.configured) && (
                <ProviderModels
                  id={selected.id}
                  enabled={providerEnabled}
                  ticked={ticks[selected.id]}
                  defaultModel={effectiveDefault}
                  setDefault={setDraftDefault}
                  profiles={connection?.protocol === "lmstudio" ? connection.models : undefined}
                  editModel={editModel}
                  disabled={disabled}
                  change={(next) => setTicks((current) => ({ ...current, [selected.id]: next }))}
                />
              )}
            </article>
          )}
        </div>
      )}
      {editing && list.data && (
        <ProviderDialog
          title={
            editing.kind === "model"
              ? t("providers.modelSettingsNamed", { name: editing.model.name })
              : editedName
                ? t("providers.editNamed", { name: editedName })
                : t("providers.add")
          }
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
          {editing.kind === "model" ? (
            <LmStudioModelEditor
              provider={editing.provider}
              model={editing.model}
              disabled={disabled}
              save={save}
              close={close}
            />
          ) : editing.kind === "new" && editing.preset === "chatgpt" ? (
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
  const storageWarning = provider.storage === "memory" || provider.storage === "unprotected";
  if (provider.configured && !provider.hint && !storageWarning) return null;
  return (
    <div role="status" className="provider-status">
      {!provider.configured && (
        <span>{keyOptional ? t("providers.noKey") : t("providers.notConfigured")}</span>
      )}
      {provider.hint && <code data-provider-hint>{provider.hint}</code>}
      {provider.storage === "memory" && <span>{t("providers.memory")}</span>}
      {provider.storage === "unprotected" && <span>{t("providers.unprotected")}</span>}
    </div>
  );
}
