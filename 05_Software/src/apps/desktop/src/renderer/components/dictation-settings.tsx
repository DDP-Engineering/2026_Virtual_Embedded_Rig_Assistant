import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type DictationChange,
  type DictationModelId,
  type DictationModelState,
  type DictationRecordingMode,
  defaultDictationRecordingMode,
  dictationLanguageSchema,
  dictationRecordingModeSchema,
  type SettingsPatch,
  type ShortcutOverrides,
} from "@vera/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { KeyboardShortcuts } from "./keyboard-shortcuts.js";
import { Pager, usePaged } from "./pager.js";
import "./dictation-settings.css";

const queryKey = ["dictation.get"] as const;

/**
 * What a user weighs when choosing a model, shown beside each one. Every model in the catalog needs an entry,
 * so a model added later states its languages, relative speed and relative accuracy here.
 */
const modelFacts: Record<
  DictationModelId,
  { languages: number; speed: "fast" | "moderate" | "slow"; accuracy: "basic" | "good" | "high" }
> = {
  "whisper-base": { languages: 99, speed: "fast", accuracy: "basic" },
  "whisper-small": { languages: 99, speed: "moderate", accuracy: "good" },
};

export function DictationSettings({
  mode = defaultDictationRecordingMode,
  bindings,
  saving,
  update,
}: {
  mode?: DictationRecordingMode | undefined;
  bindings?: ShortcutOverrides | undefined;
  saving: boolean;
  update: (patch: SettingsPatch) => void;
}) {
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
  // Desktop main opens the file picker; the renderer names only the model.
  const installFile = useMutation({
    // Offline benches report no network; the request goes to Desktop main, not to a server.
    networkMode: "always",
    mutationFn: (id: DictationModelId) => api.invoke("dictation.installFile", { id }),
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
  const { rows, pager } = usePaged(query.data?.models ?? []);
  return (
    <section id="section-dictation" className="surface" data-settings-section="dictation">
      <h2>{t("settings.dictation")}</h2>
      <div className="dictation-options">
        <div className="dictation-field">
          <label htmlFor="dictation-recording-mode">{t("dictation.recordingMode")}</label>
          <select
            id="dictation-recording-mode"
            value={mode}
            disabled={saving}
            onChange={(event) =>
              update({
                dictationRecordingMode: dictationRecordingModeSchema.parse(event.currentTarget.value),
              })
            }
          >
            <option value="hold">{t("dictation.holdMode")}</option>
            <option value="toggle">{t("dictation.toggleMode")}</option>
          </select>
        </div>
        <div className="dictation-field dictation-shortcut">
          <KeyboardShortcuts
            only="dictate"
            bindings={bindings}
            disabled={saving}
            update={(keyboardShortcuts) => update({ keyboardShortcuts })}
          />
        </div>
        {query.data && (
          <div className="dictation-field">
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
        )}
      </div>
      {query.isPending && <p role="status">{t("dictation.loading")}</p>}
      {query.error && <ErrorMessage error={query.error} />}
      {change.error && <ErrorMessage error={change.error} />}
      {installFile.error && <ErrorMessage error={installFile.error} />}
      {query.data && (
        <>
          <p className="dictation-current" role="status" data-dictation-current={selected ?? ""}>
            <span>{t("dictation.inUse")}</span>
            <strong>{selected ? modelNames[selected] : t("dictation.noSelection")}</strong>
          </p>
          <div className="dictation-models-scroll">
            <table className="dictation-models">
              <thead>
                <tr>
                  <th scope="col">{t("dictation.columns.model")}</th>
                  <th scope="col">{t("dictation.columns.languages")}</th>
                  <th scope="col">{t("dictation.columns.speed")}</th>
                  <th scope="col">{t("dictation.columns.accuracy")}</th>
                  <th scope="col">{t("dictation.columns.size")}</th>
                  <th scope="col">{t("dictation.columns.status")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("dictation.columns.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((model) => (
                  <DictationModel
                    key={model.id}
                    model={model}
                    name={modelNames[model.id]}
                    selected={selected === model.id}
                    downloading={downloading ?? false}
                    pending={change.isPending || installFile.isPending}
                    change={change.mutate}
                    installFile={installFile.mutate}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pager {...pager} />
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
  installFile,
}: {
  model: DictationModelState;
  name: string;
  selected: boolean;
  downloading: boolean;
  pending: boolean;
  change: (action: DictationChange) => void;
  installFile: (id: DictationModelId) => void;
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

  const facts = modelFacts[id];
  const speeds = {
    fast: t("dictation.speeds.fast"),
    moderate: t("dictation.speeds.moderate"),
    slow: t("dictation.speeds.slow"),
  };
  const accuracies = {
    basic: t("dictation.accuracies.basic"),
    good: t("dictation.accuracies.good"),
    high: t("dictation.accuracies.high"),
  };
  return (
    <tr className="dictation-model" aria-current={selected || undefined} aria-labelledby={`dictation-${id}`}>
      <th scope="row">
        <span id={`dictation-${id}`} className="dictation-model-name">
          {name}
        </span>
        <span className="muted">
          {id === "whisper-small" ? t("dictation.recommended") : t("dictation.compact")}
        </span>
        {selected && <span className="dictation-in-use">{t("dictation.inUseBadge")}</span>}
      </th>
      <td>{new Intl.NumberFormat(i18n.resolvedLanguage).format(facts.languages)}</td>
      <td>{speeds[facts.speed]}</td>
      <td>{accuracies[facts.accuracy]}</td>
      <td>{size}</td>
      <td>
        <div role="status">
          {status === "failed"
            ? failures[model.failure]
            : active && model.fromFile
              ? t("dictation.installingFile")
              : statusLabel[status]}
        </div>
        {active &&
          (model.fromFile ? (
            <progress aria-label={t("dictation.progress", { model: name })} />
          ) : (
            <progress
              value={model.receivedBytes}
              max={bytes}
              aria-label={t("dictation.progress", { model: name })}
            />
          ))}
      </td>
      <td>
        <div className="dictation-model-actions">
          <button
            type="button"
            className={active || selected ? undefined : "primary"}
            aria-label={t("dictation.modelAction", { action: actionLabel, model: name })}
            disabled={pending || (!active && downloading) || selected}
            onClick={() => change({ action, id })}
          >
            {actionLabel}
          </button>
          {action === "download" && (
            <button
              type="button"
              data-action="dictation-install-file"
              disabled={pending || downloading}
              aria-label={t("dictation.modelAction", { action: t("dictation.installFile"), model: name })}
              onClick={() => installFile(id)}
            >
              {t("dictation.installFile")}
            </button>
          )}
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
      </td>
    </tr>
  );
}
