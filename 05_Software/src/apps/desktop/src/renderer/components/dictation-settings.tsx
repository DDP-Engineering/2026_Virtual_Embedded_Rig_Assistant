import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DictationChange, type DictationModelState, dictationLanguageSchema } from "@vera/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import "./dictation-settings.css";

const queryKey = ["dictation.get"] as const;

export function DictationSettings() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const options = useMemo(() => {
    const names = new Intl.DisplayNames(locale, { type: "language" });
    const collator = new Intl.Collator(locale);
    return dictationLanguageSchema.options
      .filter((code) => code !== "auto")
      .map((code) => ({ code, name: names.of(code === "jw" ? "jv" : code) ?? code }))
      .sort((a, b) => collator.compare(a.name, b.name));
  }, [locale]);
  const client = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: () => api.invoke("dictation.get", {}),
    refetchOnMount: "always",
    refetchInterval: ({ state }) =>
      state.data?.models.some((model) => model.status === "downloading") ? 400 : false,
  });
  const change = useMutation({
    mutationFn: (action: DictationChange) => api.invoke("dictation.change", action),
    onMutate: () => client.cancelQueries({ queryKey }),
    onSuccess: async (snapshot) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData(queryKey, snapshot);
    },
    onError: () => client.invalidateQueries({ queryKey }),
  });

  const modelNames = { "whisper-base": t("dictation.base"), "whisper-small": t("dictation.small") };
  const selected = query.data?.selectedModel;
  const downloading = query.data?.models.some((model) => model.status === "downloading");
  return (
    <section id="section-dictation" className="surface" data-settings-section="dictation">
      <h2>{t("settings.dictation")}</h2>
      {query.isPending && <p role="status">{t("dictation.loading")}</p>}
      {query.error && <ErrorMessage error={query.error} />}
      {change.error && <ErrorMessage error={change.error} />}
      {query.data && (
        <>
          <div className="language-field">
            <label htmlFor="dictation-language">{t("dictation.language")}</label>
            <select
              id="dictation-language"
              value={query.data.language}
              disabled={change.isPending}
              onChange={(event) => {
                const language = dictationLanguageSchema.parse(event.currentTarget.value);
                change.mutate({ action: "language", language });
              }}
            >
              <option value="auto">{t("dictation.automatic")}</option>
              {options.map(({ code, name }) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <p role="status">
            {selected ? t("dictation.selected", { model: modelNames[selected] }) : t("dictation.noSelection")}
          </p>
          <div className="dictation-models">
            {query.data.models.map((model) => (
              <DictationModel
                key={model.id}
                model={model}
                name={modelNames[model.id]}
                selected={selected === model.id}
                downloading={downloading ?? false}
                pending={change.isPending}
                change={change.mutate}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function DictationModel({
  model,
  name,
  selected,
  downloading,
  pending,
  change,
}: {
  model: DictationModelState;
  name: string;
  selected: boolean;
  downloading: boolean;
  pending: boolean;
  change: (action: DictationChange) => void;
}) {
  const { t, i18n } = useTranslation();
  const { id, bytes, status } = model;
  const size = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1,
  }).format(bytes / 1e6);
  const statusLabel = {
    missing: t("dictation.missing"),
    installed: t("dictation.installed"),
    corrupt: t("dictation.corrupt"),
    "removal-failed": t("dictation.removalFailed"),
    downloading: t("dictation.downloading"),
  };
  const failures = {
    integrity: t("dictation.integrity"),
    network: t("dictation.network"),
    space: t("dictation.space"),
    storage: t("dictation.storage"),
  };
  const available = status === "installed";
  const removing = available || status === "corrupt" || (status === "failed" && model.canRemove);
  const active = status === "downloading";
  const action = active
    ? "cancel"
    : available
      ? "select"
      : status === "removal-failed"
        ? "remove"
        : "download";
  const actionLabel = active
    ? t("dictation.cancel")
    : available
      ? t("dictation.select")
      : status === "failed" || status === "corrupt" || status === "removal-failed"
        ? t("dictation.retry")
        : t("dictation.download");

  return (
    <article className="dictation-model" aria-labelledby={`dictation-${id}`}>
      <div>
        <h3 id={`dictation-${id}`}>{name}</h3>
        <div className="muted">
          {id === "whisper-small" ? t("dictation.recommended") : t("dictation.compact")}
        </div>
      </div>
      <div>
        <span>{size}</span>
        <div role="status">{status === "failed" ? failures[model.failure] : statusLabel[status]}</div>
        {active && (
          <progress
            value={model.receivedBytes}
            max={bytes}
            aria-label={t("dictation.progress", { model: name })}
          />
        )}
      </div>
      <div className="dictation-model-actions">
        <button
          type="button"
          className={active ? undefined : "primary"}
          aria-label={t("dictation.modelAction", { action: actionLabel, model: name })}
          disabled={pending || (!active && downloading) || selected}
          onClick={() => change({ action, id })}
        >
          {actionLabel}
        </button>
        {removing && (
          <button
            type="button"
            disabled={pending || downloading}
            aria-label={t("dictation.modelAction", { action: t("dictation.remove"), model: name })}
            onClick={() => change({ action: "remove", id })}
          >
            {t("dictation.remove")}
          </button>
        )}
      </div>
    </article>
  );
}
