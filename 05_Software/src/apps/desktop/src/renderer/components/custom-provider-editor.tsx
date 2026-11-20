import {
  type CuratedDiscovery,
  type CuratedProviderPreset,
  type ProviderList,
  type ProviderSave,
  providerChoices,
  providerTokenDefaults,
  veraError,
} from "@vera/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { ProviderImageSwitch } from "./provider-image-switch.js";
import { ProviderTest } from "./provider-test.js";

type Custom = ProviderList["custom"][number];
export function customVersion(provider: Custom) {
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

export function CustomEditor({
  initial,
  preset,
  curated,
  remove,
  disabled,
  save,
  close,
}: {
  initial: Custom | null;
  preset: "ollama" | "other";
  curated?: CuratedProviderPreset | undefined;
  remove: () => void;
  disabled: boolean;
  save: Save;
  close: () => void;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const [name, setName] = useState(
    initial?.name ?? curated?.label ?? (preset === "ollama" ? providerChoices.ollama.label : ""),
  );
  const [bindingId, setBindingId] = useState(initial?.preset?.binding ?? curated?.bindings[0]?.id);
  const binding = curated?.bindings.find(({ id }) => id === bindingId);
  const selection = curated && binding ? { id: curated.id, binding: binding.id } : undefined;
  const [url, setUrl] = useState(initial?.baseUrl ?? providerChoices[preset].baseUrl);
  const [model, setModel] = useState(initial?.model ?? "");
  const [imageModels, setImageModels] = useState(initial?.imageModels ?? []);
  const [context, setContext] = useState(
    String(initial?.contextWindow ?? providerTokenDefaults.contextWindow),
  );
  const [output, setOutput] = useState(
    String(initial?.maxOutputTokens ?? providerTokenDefaults.maxOutputTokens),
  );
  const [key, setKey] = useState("");
  const [clear, setClear] = useState(false);
  const [discovery, setDiscovery] = useState<CuratedDiscovery>();
  const [discovering, setDiscovering] = useState(false);
  const profile = binding?.models?.find(({ id }) => id === model.trim());
  const discoveredNames = new Map(
    discovery?.status === "discovered" ? discovery.profiles?.map(({ id, name }) => [id, name]) : [],
  );
  const modelChoices = new Set([
    ...(binding?.qwenCloud && discovery?.status === "discovered"
      ? []
      : (binding?.models?.map(({ id }) => id) ?? [])),
    ...(discovery?.status === "discovered" ? discovery.models : []),
  ]);
  async function discover() {
    if (!selection) return;
    setDiscovering(true);
    setDiscovery(undefined);
    try {
      setDiscovery(
        await api.invoke("providers.presets.discover", {
          preset: selection,
          ...(key ? { apiKey: key } : {}),
          ...(initial ? { savedId: initial.id } : {}),
        }),
      );
    } catch {
      setDiscovery({ status: "failed", error: veraError("PROVIDER") });
    } finally {
      setDiscovering(false);
    }
  }
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
              baseUrl: binding?.inference ?? url,
              model,
              contextWindow: profile?.contextWindow ?? Number(context),
              maxOutputTokens: profile?.maxOutputTokens ?? Number(output),
              ...(selection ? { preset: selection } : { imageModels }),
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
      <fieldset disabled={disabled || discovering} className="provider-fields" aria-busy={discovering}>
        {curated && <p>{curated.label}</p>}
        {curated && binding && (curated.bindings.length > 1 || binding.label) && (
          <>
            <label htmlFor={`${prefix}-binding`}>{t("providers.serviceEndpoint")}</label>
            <select
              id={`${prefix}-binding`}
              value={binding.id}
              disabled={!!initial}
              onChange={(event) => {
                setBindingId(event.target.value);
                setKey("");
                setDiscovery(undefined);
              }}
            >
              {curated.bindings.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label ?? entry.id}
                </option>
              ))}
            </select>
          </>
        )}
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
          value={binding?.inference ?? url}
          readOnly={!!binding}
          onChange={(event) => setUrl(event.target.value)}
          required
          maxLength={2048}
        />
        <label htmlFor={`${prefix}-model`}>{t("providers.model")}</label>
        <input
          id={`${prefix}-model`}
          value={model}
          list={modelChoices.size ? `${prefix}-catalog` : undefined}
          onChange={(event) => setModel(event.target.value)}
          required
          maxLength={200}
        />
        {binding?.catalog.kind === "openai-models" && (
          <button
            type="button"
            data-action="discover-models"
            disabled={clear || (!key && !initial?.configured)}
            onClick={() => void discover()}
          >
            {discovering ? t("providers.discovering") : t("providers.discover")}
          </button>
        )}
        {modelChoices.size > 0 && (
          <datalist id={`${prefix}-catalog`}>
            {[...modelChoices].map((id) => (
              <option key={id} value={id} label={discoveredNames.get(id)} />
            ))}
          </datalist>
        )}
        {discovery?.status === "manual" && <p role="status">{t("providers.manualModel")}</p>}
        {discovery?.status === "failed" && <ErrorMessage error={discovery.error} />}
        {!curated && (
          <ProviderImageSwitch
            model={model.trim()}
            imageModels={imageModels}
            setImageModels={setImageModels}
          />
        )}
        <label htmlFor={`${prefix}-context`}>{t("providers.contextWindow")}</label>
        <input
          id={`${prefix}-context`}
          type="number"
          min={1}
          step={1}
          value={profile?.contextWindow ?? context}
          readOnly={profile?.contextWindow !== undefined}
          onChange={(event) => setContext(event.target.value)}
          required
        />
        <label htmlFor={`${prefix}-output`}>{t("providers.maxOutput")}</label>
        <input
          id={`${prefix}-output`}
          type="number"
          min={1}
          step={1}
          value={profile?.maxOutputTokens ?? output}
          readOnly={profile?.maxOutputTokens !== undefined}
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
            setDiscovery(undefined);
          }}
          disabled={clear}
          required={!!curated && !initial?.configured}
          maxLength={16384}
        />
        {!curated && <p className="muted">{t("providers.optionalKey")}</p>}
        {initial?.storage && (
          <label className="provider-checkbox">
            <input
              type="checkbox"
              checked={clear}
              onChange={(event) => {
                setClear(event.target.checked);
                setDiscovery(undefined);
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
              !initial.configured ||
              name !== initial.name ||
              url !== initial.baseUrl ||
              model !== initial.model ||
              (profile?.contextWindow ?? Number(context)) !== initial.contextWindow ||
              (profile?.maxOutputTokens ?? Number(output)) !== initial.maxOutputTokens ||
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
