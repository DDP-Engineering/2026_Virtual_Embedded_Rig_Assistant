import type { DiscoveredModel, ModelProfile, ProviderList, ProviderSave } from "@vera/shared";
import { modelProfileSchema } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { ProviderImageSwitch } from "./provider-image-switch.js";

type Custom = ProviderList["custom"][number];
type Save = (request: ProviderSave, done: () => void) => Promise<void>;
function profile(model: DiscoveredModel): ModelProfile {
  const contextWindow = model.loadedContextWindow ?? model.maxContextWindow ?? 32768;
  return { ...model, contextWindow, maxOutputTokens: Math.min(4096, Math.floor(contextWindow / 4)) };
}
export function LmStudioEditor({
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
  const [endpoint, setEndpoint] = useState(initial?.baseUrl ?? "http://localhost:1234");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [name, setName] = useState(initial?.name ?? "LM Studio");
  const [models, setModels] = useState<ModelProfile[]>(initial?.models ?? []);
  const [selected, setSelected] = useState(initial?.model ?? "");
  const [imageModels, setImageModels] = useState(initial?.imageModels ?? []);
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [waitSeconds, setWaitSeconds] = useState(String(initial?.responseTimeoutSeconds ?? 300));
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<unknown>();
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function invalidate() {
    generation.current++;
    setModels([]);
    setSelected("");
    setBaseUrl("");
    setError(undefined);
    setTesting(false);
  }
  async function discover() {
    const current = ++generation.current;
    setTesting(true);
    setError(undefined);
    setModels([]);
    setSelected("");
    try {
      // Imperative call keeps the draft key out of query/mutation caches.
      const result = await api.invoke("providers.discover", {
        endpoint,
        ...(clearKey
          ? { apiKey: "" }
          : key
            ? { apiKey: key }
            : initial && endpoint.replace(/\/$/, "") === initial.baseUrl.replace(/\/$/, "")
              ? { savedId: initial.id as `custom:${string}` }
              : {}),
      });
      if (generation.current !== current) return;
      const next = result.models.map((model) => {
        const saved = (
          baseUrl === result.baseUrl
            ? models
            : initial?.baseUrl === result.baseUrl
              ? initial.models
              : undefined
        )?.find((m) => m.id === model.id);
        const defaults = profile(model);
        if (!saved) return defaults;
        const reasoning =
          saved.reasoning && model.reasoningOptions.includes(saved.reasoning) ? saved.reasoning : undefined;
        const preferences = { reasoning, temperature: saved.temperature };
        const candidate = {
          ...defaults,
          ...preferences,
          contextWindow: saved.contextWindow,
          maxOutputTokens: saved.maxOutputTokens,
        };
        return modelProfileSchema.safeParse(candidate).success ? candidate : { ...defaults, ...preferences };
      });
      setModels(next);
      setBaseUrl(result.baseUrl);
      setSelected(
        next.find((m) => m.id === initial?.model)?.id ??
          next.find((m) => m.loadedContextWindow)?.id ??
          next[0]?.id ??
          "",
      );
    } catch (failure) {
      if (generation.current === current) setError(failure);
    } finally {
      if (generation.current === current) setTesting(false);
    }
  }
  const current = models.find((m) => m.id === selected);
  function change(patch: Partial<ModelProfile>) {
    setModels((all) => all.map((m) => (m.id === selected ? { ...m, ...patch } : m)));
  }
  function done() {
    setKey("");
    generation.current++;
    close();
  }
  const valid = !!current && models.every((m) => modelProfileSchema.safeParse(m).success);
  return (
    <form
      className="workbench-form provider-editor"
      data-provider-editor="lmstudio"
      onSubmit={(event) => {
        event.preventDefault();
        if (!current || !valid) return;
        void save(
          {
            provider: "custom",
            ...(initial ? { id: initial.id as `custom:${string}` } : {}),
            config: {
              name,
              baseUrl,
              model: selected,
              contextWindow: current.contextWindow,
              maxOutputTokens: current.maxOutputTokens,
              responseTimeoutSeconds: Number(waitSeconds),
              protocol: "lmstudio",
              models,
              imageModels,
              ...(current.supportsTools === undefined ? {} : { supportsTools: current.supportsTools }),
            },
            ...(clearKey ? { apiKey: "" } : key ? { apiKey: key } : {}),
          },
          done,
        );
      }}
    >
      <fieldset disabled={disabled} className="provider-fields">
        <div className="provider-connection-grid">
          <label>
            {t("providers.name")}
            <input value={name} required maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            {t("providers.responseTimeout")}
            <input
              type="number"
              min={10}
              max={3600}
              step={1}
              value={waitSeconds}
              onChange={(event) => setWaitSeconds(event.target.value)}
              required
            />
          </label>
          <label>
            {t("providers.baseUrl")}
            <input
              data-discovery-endpoint
              type="url"
              required
              maxLength={2048}
              value={endpoint}
              onChange={(event) => {
                invalidate();
                setEndpoint(event.target.value);
              }}
            />
          </label>
          <label>
            {t("providers.endpointKey")}
            <input
              type="password"
              disabled={clearKey}
              autoComplete="off"
              spellCheck={false}
              maxLength={16384}
              value={key}
              onChange={(event) => {
                invalidate();
                setKey(event.target.value);
              }}
            />
          </label>
        </div>
        {initial?.storage && (
          <label className="provider-checkbox">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(event) => {
                invalidate();
                setKey("");
                setClearKey(event.target.checked);
              }}
            />
            {t("providers.clearKey")}
          </label>
        )}
        <div className="workbench-actions provider-actions">
          <button
            type="button"
            data-action="discover-models"
            disabled={testing || !endpoint.trim()}
            onClick={() => void discover()}
          >
            {t("discovery.test")}
          </button>
          <span role="status">
            {testing ? t("discovery.testing") : baseUrl ? t("discovery.found", { count: models.length }) : ""}
          </span>
        </div>
        {error !== undefined && <ErrorMessage error={error} />}
        {current && (
          <>
            <label className="provider-connection-model" htmlFor={`${prefix}-model`}>
              {t("providers.model")}
              <select
                id={`${prefix}-model`}
                data-discovered-model
                value={selected}
                onChange={(event) => setSelected(event.target.value)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            {!initial && (
              <details className="provider-model-options">
                <summary>{t("providers.modelSettings")}</summary>
                <ModelProfileFields
                  current={current}
                  change={change}
                  imageModels={imageModels}
                  setImageModels={setImageModels}
                />
              </details>
            )}
            {!valid && <p role="alert">{t("discovery.invalidLimits")}</p>}
          </>
        )}
        <div className="workbench-actions">
          <button type="submit" data-provider-action="save-lmstudio" disabled={!valid || testing}>
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

/** Edits one saved model profile without changing the connection's selected model. */
export function LmStudioModelEditor({
  provider,
  model,
  disabled,
  save,
  close,
}: {
  provider: Custom;
  model: ModelProfile;
  disabled: boolean;
  save: Save;
  close: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(model);
  const [imageModels, setImageModels] = useState(provider.imageModels ?? []);
  const valid = modelProfileSchema.safeParse(draft).success;
  const changed =
    JSON.stringify(draft) !== JSON.stringify(model) ||
    JSON.stringify(imageModels) !== JSON.stringify(provider.imageModels ?? []);
  return (
    <form
      className="workbench-form provider-editor"
      data-provider-editor="model"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || !changed) return;
        const {
          id,
          slug: _slug,
          configured: _configured,
          storage: _storage,
          hint: _hint,
          ...config
        } = provider;
        if (config.model === draft.id) {
          config.contextWindow = draft.contextWindow;
          config.maxOutputTokens = draft.maxOutputTokens;
        }
        void save(
          {
            provider: "custom",
            id: id as `custom:${string}`,
            config: {
              ...config,
              models: config.models?.map((item) => (item.id === draft.id ? draft : item)),
              imageModels,
            },
          },
          close,
        );
      }}
    >
      <fieldset className="provider-fields" disabled={disabled}>
        <ModelProfileFields
          current={draft}
          change={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          imageModels={imageModels}
          setImageModels={setImageModels}
        />
        {!valid && <p role="alert">{t("discovery.invalidLimits")}</p>}
        <div className="workbench-actions">
          <button type="submit" className="primary" disabled={!valid || !changed}>
            {t("providers.save")}
          </button>
          <button type="button" onClick={close}>
            {t("providers.cancel")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function ModelProfileFields({
  current,
  change,
  imageModels,
  setImageModels,
}: {
  current: ModelProfile;
  change: (patch: Partial<ModelProfile>) => void;
  imageModels: string[];
  setImageModels: (models: string[]) => void;
}) {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    off: t("discovery.off"),
    on: t("discovery.on"),
    low: t("discovery.low"),
    medium: t("discovery.medium"),
    high: t("discovery.high"),
    xhigh: t("discovery.xhigh"),
  };
  return (
    <>
      <div className="provider-parameter-grid">
        <label>
          <span>{t("providers.contextWindow")}</span>
          <input
            type="number"
            required
            min={1}
            step={1}
            max={current.loadedContextWindow ?? current.maxContextWindow}
            value={current.contextWindow}
            onChange={(event) => change({ contextWindow: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>{t("providers.maxOutput")}</span>
          <input
            type="number"
            required
            min={1}
            step={1}
            value={current.maxOutputTokens}
            onChange={(event) => change({ maxOutputTokens: Number(event.target.value) })}
          />
        </label>
        {current.reasoningOptions.length > 0 && (
          <label>
            <span>{t("discovery.reasoning")}</span>
            <select
              data-model-reasoning
              value={current.reasoning ?? ""}
              onChange={(event) => change({ reasoning: event.target.value || undefined })}
            >
              <option value="">
                {t("discovery.default")}
                {current.reasoningDefault
                  ? ` (${labels[current.reasoningDefault] ?? current.reasoningDefault})`
                  : ""}
              </option>
              {current.reasoningOptions.map((option) => (
                <option key={option} value={option}>
                  {labels[option] ?? option}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{t("discovery.temperature")}</span>
          <input
            data-model-temperature
            type="number"
            min={0}
            max={2}
            step="any"
            value={current.temperature ?? ""}
            onChange={(event) =>
              change({ temperature: event.target.value === "" ? undefined : Number(event.target.value) })
            }
          />
        </label>
        <ProviderImageSwitch model={current.id} imageModels={imageModels} setImageModels={setImageModels} />
      </div>
      {(current.maxContextWindow || current.loadedContextWindow) && (
        <div className="provider-context-info muted">
          {current.maxContextWindow && (
            <span data-model-maximum>{t("discovery.maximum", { count: current.maxContextWindow })}</span>
          )}
          {current.loadedContextWindow && (
            <span data-model-loaded>{t("discovery.loaded", { count: current.loadedContextWindow })}</span>
          )}
        </div>
      )}
    </>
  );
}
