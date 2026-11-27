// REQ-UX-9ea9184f REQ-UX-032aab57 REQ-UX-8663749f REQ-UX-91d7a481
import { type AdvancedKey, type AdvancedScope, type AdvancedValue, advancedSettings } from "@vera/shared";
import { Zap } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

export interface InheritedValue {
  value: AdvancedValue;
  source: AdvancedScope | "default";
}

/** A stored value of the setting's own type, or undefined (inherit) for anything else. */
export function advancedFieldValue(setting: AdvancedKey, stored: unknown): AdvancedValue | undefined {
  const wanted = advancedSettings[setting].kind === "switch" ? "boolean" : "number";
  return typeof stored === wanted ? (stored as AdvancedValue) : undefined;
}

/**
 * One Advanced setting at one scope, edited in a draft that the page or dialog Save writes (REQ-UX-032aab57).
 * Empty means "inherit" and shows the inherited value and its source; every entry is reported, valid or not,
 * so Save can wait for a valid value. A switch is a choice of inherit, on or off (REQ-UX-91d7a481).
 */
export function AdvancedField({
  setting,
  value,
  inherited,
  disabled = false,
  onChange,
}: {
  setting: AdvancedKey;
  value: AdvancedValue | undefined;
  inherited: InheritedValue;
  disabled?: boolean;
  onChange: (value: AdvancedValue | null) => void;
}) {
  const { t } = useTranslation();
  const spec = advancedSettings[setting];
  const id = useId();
  const [text, setText] = useState(typeof value === "number" ? String(value) : "");
  useEffect(() => {
    setText((current) =>
      current.trim() !== "" && Number(current.trim()) === value
        ? current
        : typeof value === "number"
          ? String(value)
          : "",
    );
  }, [value]);
  const timings = {
    live: t("advanced.timing.live"),
    new: t("advanced.timing.new"),
    nextOperation: t("advanced.timing.nextOperation"),
    reindex: t("advanced.timing.reindex"),
    reopen: t("advanced.timing.reopen"),
    restart: t("advanced.timing.restart"),
  };
  const timing = timings[spec.applies];
  // One literal key per registered setting, so the translation check sees every one.
  const labels: Record<AdvancedKey, { name: string; about: string }> = {
    toolCallsPerTurn: {
      name: t("advanced.settings.toolCallsPerTurn"),
      about: t("advanced.about.toolCallsPerTurn"),
    },
    noOutputTimeout: {
      name: t("advanced.settings.noOutputTimeout"),
      about: t("advanced.about.noOutputTimeout"),
    },
    headerWait: { name: t("advanced.settings.headerWait"), about: t("advanced.about.headerWait") },
    providerDiscoveryTimeout: {
      name: t("advanced.settings.providerDiscoveryTimeout"),
      about: t("advanced.about.providerDiscoveryTimeout"),
    },
    backgroundCompaction: {
      name: t("advanced.settings.backgroundCompaction"),
      about: t("advanced.about.backgroundCompaction"),
    },
    summaryToolResultChars: {
      name: t("advanced.settings.summaryToolResultChars"),
      about: t("advanced.about.summaryToolResultChars"),
    },
    summaryPasses: { name: t("advanced.settings.summaryPasses"), about: t("advanced.about.summaryPasses") },
    calibrationMargin: {
      name: t("advanced.settings.calibrationMargin"),
      about: t("advanced.about.calibrationMargin"),
    },
    providerTokenCounts: {
      name: t("advanced.settings.providerTokenCounts"),
      about: t("advanced.about.providerTokenCounts"),
    },
    delegations: { name: t("advanced.settings.delegations"), about: t("advanced.about.delegations") },
    concurrentTurns: {
      name: t("advanced.settings.concurrentTurns"),
      about: t("advanced.about.concurrentTurns"),
    },
    compactionTrigger: {
      name: t("advanced.settings.compactionTrigger"),
      about: t("advanced.about.compactionTrigger"),
    },
    recentTailTokens: {
      name: t("advanced.settings.recentTailTokens"),
      about: t("advanced.about.recentTailTokens"),
    },
    autoCompaction: {
      name: t("advanced.settings.autoCompaction"),
      about: t("advanced.about.autoCompaction"),
    },
    toolResultChars: {
      name: t("advanced.settings.toolResultChars"),
      about: t("advanced.about.toolResultChars"),
    },
    readLines: { name: t("advanced.settings.readLines"), about: t("advanced.about.readLines") },
    readChars: { name: t("advanced.settings.readChars"), about: t("advanced.about.readChars") },
    grepResults: { name: t("advanced.settings.grepResults"), about: t("advanced.about.grepResults") },
    grepFileMB: { name: t("advanced.settings.grepFileMB"), about: t("advanced.about.grepFileMB") },
    globResults: { name: t("advanced.settings.globResults"), about: t("advanced.about.globResults") },
    workerDeadline: {
      name: t("advanced.settings.workerDeadline"),
      about: t("advanced.about.workerDeadline"),
    },
    webSearchResults: {
      name: t("advanced.settings.webSearchResults"),
      about: t("advanced.about.webSearchResults"),
    },
    webReadChars: { name: t("advanced.settings.webReadChars"), about: t("advanced.about.webReadChars") },
    imagesPerMessage: {
      name: t("advanced.settings.imagesPerMessage"),
      about: t("advanced.about.imagesPerMessage"),
    },
    imageFileMB: { name: t("advanced.settings.imageFileMB"), about: t("advanced.about.imageFileMB") },
    webTimeout: { name: t("advanced.settings.webTimeout"), about: t("advanced.about.webTimeout") },
    browserNavigationTimeout: {
      name: t("advanced.settings.browserNavigationTimeout"),
      about: t("advanced.about.browserNavigationTimeout"),
    },
    downloadMB: { name: t("advanced.settings.downloadMB"), about: t("advanced.about.downloadMB") },
    downloadTimeout: {
      name: t("advanced.settings.downloadTimeout"),
      about: t("advanced.about.downloadTimeout"),
    },
    backgroundPrograms: {
      name: t("advanced.settings.backgroundPrograms"),
      about: t("advanced.about.backgroundPrograms"),
    },
    runLogsKept: { name: t("advanced.settings.runLogsKept"), about: t("advanced.about.runLogsKept") },
    runLogMB: { name: t("advanced.settings.runLogMB"), about: t("advanced.about.runLogMB") },
    programTimeout: {
      name: t("advanced.settings.programTimeout"),
      about: t("advanced.about.programTimeout"),
    },
    commandTimeout: {
      name: t("advanced.settings.commandTimeout"),
      about: t("advanced.about.commandTimeout"),
    },
    textFileMB: { name: t("advanced.settings.textFileMB"), about: t("advanced.about.textFileMB") },
    docVolumeFiles: {
      name: t("advanced.settings.docVolumeFiles"),
      about: t("advanced.about.docVolumeFiles"),
    },
    docVolumeMB: { name: t("advanced.settings.docVolumeMB"), about: t("advanced.about.docVolumeMB") },
    docsResults: { name: t("advanced.settings.docsResults"), about: t("advanced.about.docsResults") },
    extractionTimeout: {
      name: t("advanced.settings.extractionTimeout"),
      about: t("advanced.about.extractionTimeout"),
    },
    indexingPause: {
      name: t("advanced.settings.indexingPause"),
      about: t("advanced.about.indexingPause"),
    },
    embeddingIdle: {
      name: t("advanced.settings.embeddingIdle"),
      about: t("advanced.about.embeddingIdle"),
    },
    dictationTranscriptionTimeout: {
      name: t("advanced.settings.dictationTranscriptionTimeout"),
      about: t("advanced.about.dictationTranscriptionTimeout"),
    },
    terminals: { name: t("advanced.settings.terminals"), about: t("advanced.about.terminals") },
    terminalBufferK: {
      name: t("advanced.settings.terminalBufferK"),
      about: t("advanced.about.terminalBufferK"),
    },
    terminalScrollback: {
      name: t("advanced.settings.terminalScrollback"),
      about: t("advanced.about.terminalScrollback"),
    },
    terminalAgentChars: {
      name: t("advanced.settings.terminalAgentChars"),
      about: t("advanced.about.terminalAgentChars"),
    },
    updateInterval: {
      name: t("advanced.settings.updateInterval"),
      about: t("advanced.about.updateInterval"),
    },
    catalogInterval: {
      name: t("advanced.settings.catalogInterval"),
      about: t("advanced.about.catalogInterval"),
    },
    logDays: { name: t("advanced.settings.logDays"), about: t("advanced.about.logDays") },
    transcriptRows: {
      name: t("advanced.settings.transcriptRows"),
      about: t("advanced.about.transcriptRows"),
    },
    transcriptChunkRows: {
      name: t("advanced.settings.transcriptChunkRows"),
      about: t("advanced.about.transcriptChunkRows"),
    },
    pageSize: { name: t("advanced.settings.pageSize"), about: t("advanced.about.pageSize") },
  };
  const sources = {
    default: t("advanced.source.default"),
    app: t("advanced.source.app"),
    workbench: t("advanced.source.workbench"),
    session: t("advanced.source.session"),
  };
  const shown = (current: AdvancedValue) =>
    typeof current === "boolean" ? (current ? t("advanced.on") : t("advanced.off")) : current;
  const inheritedText = t("advanced.inherited", {
    value:
      setting === "browserNavigationTimeout" && inherited.source === "default"
        ? t("advanced.automatic")
        : shown(inherited.value),
    source: sources[inherited.source],
  });
  const reset = (
    <button
      type="button"
      data-advanced-reset
      disabled={disabled || (value === undefined && text === "")}
      onClick={() => {
        setText("");
        onChange(null);
      }}
    >
      {t("advanced.reset")}
    </button>
  );
  const head = (
    <>
      <label htmlFor={id} title={labels[setting].about}>
        {labels[setting].name}
      </label>
      <span className="advanced-timing" data-advanced-timing title={timing}>
        <Zap aria-hidden="true" size={16} />
        <span className="sr-only">{timing}</span>
      </span>
    </>
  );
  if (spec.kind === "switch")
    return (
      <div className="advanced-field" data-advanced-field={setting}>
        {head}
        <select
          id={id}
          data-advanced-switch
          value={value === undefined ? "" : value ? "on" : "off"}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === "" ? null : event.target.value === "on")}
        >
          <option value="">{t("advanced.inherit", { value: inheritedText })}</option>
          <option value="on">{t("advanced.on")}</option>
          <option value="off">{t("advanced.off")}</option>
        </select>
        {reset}
      </div>
    );
  if (spec.kind === "choice")
    return (
      <div className="advanced-field" data-advanced-field={setting}>
        {head}
        <select
          id={id}
          data-advanced-choice
          value={value === undefined ? "" : String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        >
          <option value="">{t("advanced.inherit", { value: inheritedText })}</option>
          {spec.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {reset}
      </div>
    );
  const entered = text.trim() === "" ? null : Number(text.trim());
  const invalid =
    entered !== null && !(Number.isInteger(entered) && entered >= spec.min && entered <= spec.max);
  return (
    <div className="advanced-field" data-advanced-field={setting}>
      {head}
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={spec.min}
        max={spec.max}
        step={1}
        value={text}
        disabled={disabled}
        placeholder={inheritedText}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-range` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value.trim() === "" ? null : Number(event.target.value.trim()));
        }}
      />
      {reset}
      {invalid && (
        <p className="advanced-range" role="alert" id={`${id}-range`}>
          {t("advanced.range", { min: spec.min, max: spec.max })}
        </p>
      )}
    </div>
  );
}
