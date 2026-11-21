import {
  bindProviderWorkspace,
  type CuratedDiscovery,
  type CuratedProviderPreset,
  type ProviderList,
  type ProviderSave,
  providerChoices,
  providerTokenDefaults,
  validWorkspaceId,
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
    provider.responseTimeoutSeconds,
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
  const hasCodingPlanNotice = curated?.id === "zai-coding-plan";
  const prefix = useId();
  const [name, setName] = useState(
    initial?.name ?? curated?.label ?? (preset === "ollama" ? providerChoices.ollama.label : ""),
  );
  const [bindingId, setBindingId] = useState(initial?.preset?.binding ?? curated?.bindings[0]?.id);
  const definition = curated?.bindings.find(({ id }) => id === bindingId);
  const [workspaceId, setWorkspaceId] = useState(initial?.preset?.workspaceId ?? "");
  const binding =
    definition && bindProviderWorkspace(definition, definition.workspace ? workspaceId : undefined);
  const selection =
    curated && binding
      ? { id: curated.id, binding: binding.id, ...(definition?.workspace ? { workspaceId } : {}) }
      : undefined;
  const regionLabels = {
    global: t("providers.regions.global"),
    china: t("providers.regions.china"),
    singapore: t("providers.regions.singapore"),
    europe: t("providers.regions.europe"),
    beijing: t("providers.regions.beijing"),
    hongKong: t("providers.regions.hongKong"),
    frankfurt: t("providers.regions.frankfurt"),
    tokyo: t("providers.regions.tokyo"),
    virginia: t("providers.regions.virginia"),
  };
  const invalidWorkspace = !!definition?.workspace && !!workspaceId && !validWorkspaceId(workspaceId);
  const [url, setUrl] = useState(initial?.baseUrl ?? providerChoices[preset].baseUrl);
  const [model, setModel] = useState(initial?.model ?? "");
  const [imageModels, setImageModels] = useState(initial?.imageModels ?? []);
  const [context, setContext] = useState(
    String(initial?.contextWindow ?? providerTokenDefaults.contextWindow),
  );
  const [output, setOutput] = useState(
    String(initial?.maxOutputTokens ?? providerTokenDefaults.maxOutputTokens),
  );
  const [waitSeconds, setWaitSeconds] = useState(String(initial?.responseTimeoutSeconds ?? 300));
  const [key, setKey] = useState("");
  const [clear, setClear] = useState(false);
  const [discovery, setDiscovery] = useState<CuratedDiscovery>();
  const [discovering, setDiscovering] = useState(false);
  const profile = binding?.models?.find(({ id }) => id === model.trim());
  const profileOutput = profile?.outputBudget ?? profile?.maxOutputTokens;
  const directCatalog = binding?.catalog.kind === "openai-models" && binding.catalog.metadata;
  const discoveredProfile =
    directCatalog && discovery?.status === "discovered"
      ? discovery.profiles?.find(({ id }) => id === model.trim())
      : undefined;
  const profileContext = discoveredProfile?.contextWindow ?? profile?.contextWindow;
  const discoveredNames = new Map(
    discovery?.status === "discovered" ? discovery.profiles?.map(({ id, name }) => [id, name]) : [],
  );
  const modelChoices = new Set([
    ...((discovery?.status === "discovered" && (binding?.qwenCloud || directCatalog || binding?.keyScope)) ||
    ((directCatalog || binding?.keyScope) && discovery?.status === "manual" && discovery.reason === "empty")
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
      aria-describedby={hasCodingPlanNotice ? `${prefix}-coding-plan` : undefined}
      className="workbench-form provider-editor"
      data-provider-editor="custom"
      onSubmit={(event) => {
        event.preventDefault();
        if (curated && !selection) return;
        void save(
          {
            provider: "custom",
            ...(initial ? { id: initial.id as `custom:${string}` } : {}),
            config: {
              name,
              baseUrl: binding?.inference ?? url,
              model,
              contextWindow: profileContext ?? Number(context),
              maxOutputTokens: profileOutput ?? Number(output),
              responseTimeoutSeconds: Number(waitSeconds),
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
      {hasCodingPlanNotice && (
        <p id={`${prefix}-coding-plan`} role="note">
          {t("providers.zaiCodingPlanEligibility")}
        </p>
      )}
      <fieldset disabled={disabled || discovering} className="provider-fields" aria-busy={discovering}>
        {curated && <p>{curated.label}</p>}
        {curated && definition && (curated.bindings.length > 1 || definition.label || definition.region) && (
          <>
            <label htmlFor={`${prefix}-binding`}>
              {definition.region ? t("providers.region") : t("providers.serviceEndpoint")}
            </label>
            <select
              id={`${prefix}-binding`}
              value={definition.id}
              disabled={!!initial || curated.bindings.length === 1}
              onChange={(event) => {
                setBindingId(event.target.value);
                setKey("");
                setDiscovery(undefined);
              }}
            >
              {curated.bindings.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.region ? regionLabels[entry.region] : (entry.label ?? entry.id)}
                </option>
              ))}
            </select>
          </>
        )}
        {definition?.workspace && (
          <>
            <label htmlFor={`${prefix}-workspace`}>{t("providers.workspaceId")}</label>
            <input
              id={`${prefix}-workspace`}
              value={workspaceId}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              required
              maxLength={63}
              aria-invalid={invalidWorkspace}
              aria-describedby={invalidWorkspace ? `${prefix}-workspace-error` : undefined}
              readOnly={!!initial}
              onChange={(event) => {
                setWorkspaceId(event.target.value);
                setKey("");
                setDiscovery(undefined);
              }}
            />
            {invalidWorkspace && (
              <p id={`${prefix}-workspace-error`} role="alert">
                {t("provider.workspaceInvalid")}
              </p>
            )}
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
          value={curated ? (binding?.inference ?? "") : url}
          readOnly={!!curated}
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
        {binding && binding.catalog.kind !== "manual" && (
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
          value={profileContext ?? context}
          readOnly={profileContext !== undefined}
          onChange={(event) => setContext(event.target.value)}
          required
        />
        <label htmlFor={`${prefix}-output`}>{t("providers.maxOutput")}</label>
        <input
          id={`${prefix}-output`}
          type="number"
          min={1}
          step={1}
          value={profileOutput ?? output}
          readOnly={profileOutput !== undefined}
          onChange={(event) => setOutput(event.target.value)}
          required
        />
        <label htmlFor={`${prefix}-timeout`}>{t("providers.responseTimeout")}</label>
        <input
          id={`${prefix}-timeout`}
          type="number"
          min={10}
          max={3600}
          step={1}
          value={waitSeconds}
          onChange={(event) => setWaitSeconds(event.target.value)}
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
              (profileContext ?? Number(context)) !== initial.contextWindow ||
              (profileOutput ?? Number(output)) !== initial.maxOutputTokens ||
              Number(waitSeconds) !== (initial.responseTimeoutSeconds ?? 300) ||
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
            <button type="submit" data-provider-action="save-custom" disabled={!!curated && !selection}>
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
