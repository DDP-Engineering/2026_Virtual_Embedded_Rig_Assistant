import type { DiscoveredModel, ModelProfile, ProviderList, ProviderSave } from "@vera/shared";
import { modelProfileSchema } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

type Custom = ProviderList["custom"][number];
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
  save: (request: ProviderSave, done: () => void) => Promise<void>;
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
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
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
        const saved = initial?.models?.find((m) => m.id === model.id);
        const candidate = saved
          ? { ...profile(model), reasoning: saved.reasoning, temperature: saved.temperature }
          : profile(model);
        if (candidate.reasoning && !model.reasoningOptions.includes(candidate.reasoning))
          delete candidate.reasoning;
        return candidate;
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
  const labels: Record<string, string> = {
    off: t("discovery.off"),
    on: t("discovery.on"),
    low: t("discovery.low"),
    medium: t("discovery.medium"),
    high: t("discovery.high"),
    xhigh: t("discovery.xhigh"),
  };
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
              protocol: "lmstudio",
              models,
              ...(current.supportsTools === undefined ? {} : { supportsTools: current.supportsTools }),
            },
            ...(clearKey ? { apiKey: "" } : key ? { apiKey: key } : {}),
          },
          done,
        );
      }}
    >
      <fieldset disabled={disabled} className="provider-fields">
        <label htmlFor={`${prefix}-endpoint`}>{t("providers.baseUrl")}</label>
        <input
          id={`${prefix}-endpoint`}
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
        <label htmlFor={`${prefix}-key`}>{t("providers.endpointKey")}</label>
        <input
          id={`${prefix}-key`}
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
        <p className="muted">{t("discovery.keyHelp")}</p>
        <div className="workbench-actions">
          <button
            type="button"
            data-action="discover-models"
            disabled={testing || !endpoint.trim()}
            onClick={() => void discover()}
          >
            {testing ? t("discovery.testing") : t("discovery.test")}
          </button>
        </div>
        {error !== undefined && <ErrorMessage error={error} />}
        {!testing && baseUrl && <p role="status">{t("discovery.found", { count: models.length })}</p>}
        {current && (
          <>
            <label htmlFor={`${prefix}-name`}>{t("providers.name")}</label>
            <input
              id={`${prefix}-name`}
              value={name}
              required
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            <label htmlFor={`${prefix}-model`}>{t("providers.model")}</label>
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
            <p className="muted">{t("discovery.perModel")}</p>
            {current.maxContextWindow && (
              <p data-model-maximum>{t("discovery.maximum", { count: current.maxContextWindow })}</p>
            )}
            {current.loadedContextWindow && (
              <p data-model-loaded>{t("discovery.loaded", { count: current.loadedContextWindow })}</p>
            )}
            {!current.maxContextWindow && <p>{t("discovery.unknownContext")}</p>}
            <label htmlFor={`${prefix}-context`}>{t("providers.contextWindow")}</label>
            <input
              id={`${prefix}-context`}
              type="number"
              required
              min={1}
              step={1}
              max={current.loadedContextWindow ?? current.maxContextWindow}
              value={current.contextWindow}
              onChange={(event) => change({ contextWindow: Number(event.target.value) })}
            />
            <label htmlFor={`${prefix}-output`}>{t("providers.maxOutput")}</label>
            <input
              id={`${prefix}-output`}
              type="number"
              required
              min={1}
              step={1}
              value={current.maxOutputTokens}
              onChange={(event) => change({ maxOutputTokens: Number(event.target.value) })}
            />
            {current.reasoningOptions.length > 0 && (
              <>
                <label htmlFor={`${prefix}-reasoning`}>{t("discovery.reasoning")}</label>
                <select
                  id={`${prefix}-reasoning`}
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
              </>
            )}
            <label htmlFor={`${prefix}-temperature`}>{t("discovery.temperature")}</label>
            <input
              id={`${prefix}-temperature`}
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
            <p className="muted">{t("discovery.defaultsHelp")}</p>
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
