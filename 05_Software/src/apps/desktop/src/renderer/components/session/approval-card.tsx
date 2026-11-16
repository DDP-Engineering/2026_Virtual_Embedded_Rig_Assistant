import {
  commandPrefixes,
  type PluginRisk,
  type ProgramApproval,
  programCommandLine,
  type SessionState,
} from "@vera/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { BoundedText, PLAIN_TEXT_CHARS } from "./bounded-text.js";
import { DiffViewer } from "./diff-viewer.js";

function ProgramDetails({ program }: { program: ProgramApproval }) {
  const { t } = useTranslation();
  const risk: Record<PluginRisk, string> = {
    safe: t("approval.risk.safe"),
    "device-read": t("approval.risk.deviceRead"),
    "device-write": t("approval.risk.deviceWrite"),
    irreversible: t("approval.risk.irreversible"),
    blocked: t("approval.risk.blocked"),
  };
  return (
    <>
      <p className="approval-risk">
        <span className="risk-badge" data-risk={program.risk}>
          {risk[program.risk]}
        </span>
        {program.trial && (
          <span className="risk-badge" data-trial>
            {t("approval.trial")}
          </span>
        )}
      </p>
      <p>{t("approval.plugin", { plugin: program.pluginId })}</p>
      <p className="sr-only">{t("approval.command")}</p>
      <code className="approval-command" data-approval-command>
        {programCommandLine(program.program, program.args)}
      </code>
      <dl className="approval-program">
        <dt>{t("approval.cwd")}</dt>
        <dd>
          <code>{program.cwd}</code>
        </dd>
        <dt>{t("approval.executable")}</dt>
        <dd>
          <code>{program.executable}</code>
        </dd>
      </dl>
      {program.notes.length > 0 && (
        <ul className="approval-notes" aria-label={t("approval.notes")}>
          {program.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {program.files.length > 0 && (
        <ul className="approval-files" aria-label={t("approval.files")}>
          {program.files.map((file) => (
            <li key={file.arg}>
              <code>{file.path}</code> <span className="approval-sha">SHA-256 {file.sha256}</span>
            </li>
          ))}
        </ul>
      )}
      {program.resources && program.registry && (
        <ul className="approval-files" aria-label={t("approval.resources")} data-approval-resources>
          {program.resources.map((resource) => (
            <li key={resource.alias}>
              <code>{resource.alias}</code> {resource.kind} <code>{resource.resource}</code>
            </li>
          ))}
          <li>
            {t("approval.registry")} <code>{program.registry.path}</code>{" "}
            <span className="approval-sha">SHA-256 {program.registry.sha256}</span>
          </li>
        </ul>
      )}
      {!!program.directories?.length && (
        <ul className="approval-files" aria-label={t("approval.directories")} data-approval-directories>
          {program.directories.map((directory) => (
            <li key={directory.arg}>
              <code>{directory.path}</code>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ApprovalCard({
  approval,
  sessionId,
  disabled,
}: {
  approval: SessionState["approvals"][number];
  sessionId?: string | undefined;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [typed, setTyped] = useState("");
  const field = useId();
  const locked = disabled || pending || !!approval.decision || !sessionId;
  const program = approval.program;
  const prefixes = approval.tool === "run_command" ? commandPrefixes(program?.args[0] ?? "") : [];
  const [chosenPrefix, setChosenPrefix] = useState<string>();
  const prefix = prefixes.includes(chosenPrefix ?? "") ? chosenPrefix : prefixes.at(-1);
  // A pending irreversible program command always needs the typed word; core checks it.
  const word = program?.confirm ?? null;
  async function decide(decision: "approved" | "denied", switchToAutoEdit = false, commandPrefix?: string) {
    if (locked || !sessionId) return;
    setPending(true);
    setError(undefined);
    try {
      await api.invoke("session.approval.decide", {
        sessionId,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision,
        ...(switchToAutoEdit ? { switchToAutoEdit } : {}),
        ...(commandPrefix === undefined ? {} : { commandPrefix }),
        ...(word && decision === "approved" ? { confirmation: typed } : {}),
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  if (approval.tool === "web_download" && approval.decision)
    return (
      <p className="muted" data-approval-card={approval.approvalId}>
        {approval.decision === "approved"
          ? t("approval.approved")
          : approval.decision === "denied"
            ? t("approval.denied")
            : t("approval.aborted")}
        {" · "}
        {approval.by === "mode" ? t("approval.byMode") : t("approval.byUser")}
      </p>
    );
  return (
    <fieldset
      className={`approval-card${approval.tool === "web_download" ? " download-approval" : ""}${program ? " program-approval" : ""}`}
      data-approval-card={approval.approvalId}
      data-risk={program?.risk}
      aria-label={`${t("approval.card")}: ${approval.tool} · ${approval.path}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The whole approval group receives the documented A/D shortcuts with visible focus.
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          locked ||
          event.target instanceof HTMLInputElement ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.repeat ||
          event.nativeEvent.isComposing
        )
          return;
        const key = event.key.toLowerCase();
        // A follows the Approve button: it waits for the typed word when one is needed.
        if (key === "a" && word && !typed.trim()) return;
        if (key === "a" || key === "d") {
          event.preventDefault();
          void decide(key === "a" ? "approved" : "denied");
        }
      }}
    >
      <h4>
        {program
          ? `${approval.tool} · ${program.program}${program.programVersion ? ` ${program.programVersion}` : ""}`
          : `${approval.tool} · ${approval.path}`}
      </h4>
      {approval.tool === "plugin_install" ? (
        <>
          <p>{t("plugins.trialReview")}</p>
          <BoundedText
            sessionId={sessionId}
            itemId={approval.approvalId}
            field="diff"
            text={approval.diff}
            totalBytes={approval.truncated?.diff}
          >
            {(text) => (
              <pre className="approval-command" data-plugin-install-review>
                {text}
              </pre>
            )}
          </BoundedText>
        </>
      ) : program && approval.tool === "run_command" ? (
        <>
          <p className="sr-only">{t("approval.command")}</p>
          <code className="approval-command" data-approval-command>
            {program.args[0]}
          </code>
          <dl className="approval-program">
            <dt>{t("approval.cwd")}</dt>
            <dd>
              <code>{program.cwd}</code>
            </dd>
            <dt>{t("settings.commandShell")}</dt>
            <dd>
              <code>{program.executable}</code>
            </dd>
          </dl>
        </>
      ) : program ? (
        <ProgramDetails program={program} />
      ) : approval.download ? (
        <>
          <p className="download-source">{t("downloads.approvalSource", { url: approval.download.url })}</p>
          <p>{t("downloads.maximum", { count: approval.download.maxBytes / (1024 * 1024) })}</p>
        </>
      ) : (
        <>
          <p>{t("approval.bytes", { count: approval.bytes })}</p>
          <p className="sr-only">{t("approval.diff")}</p>
          <BoundedText
            sessionId={sessionId}
            itemId={approval.approvalId}
            field="diff"
            text={approval.diff}
            totalBytes={approval.truncated?.diff}
          >
            {(text) =>
              text.length > PLAIN_TEXT_CHARS ? (
                <pre className="approval-diff">{text}</pre>
              ) : (
                <DiffViewer diff={text} identity={approval.approvalId} />
              )
            }
          </BoundedText>
        </>
      )}
      {error !== undefined && <ErrorMessage error={error} />}
      {approval.decision ? (
        <p role="status">
          {approval.decision === "approved"
            ? t("approval.approved")
            : approval.decision === "denied"
              ? t("approval.denied")
              : t("approval.aborted")}{" "}
          · {approval.by === "mode" ? t("approval.byMode") : t("approval.byUser")}
        </p>
      ) : (
        <>
          {word && (
            <label className="approval-confirm" htmlFor={field}>
              <span>{t("approval.typeToConfirm", { word })}</span>
              <input
                id={field}
                data-approval-confirmation
                value={typed}
                disabled={locked}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing && typed.trim()) {
                    event.preventDefault();
                    void decide("approved");
                  }
                }}
              />
            </label>
          )}
          <div className="workbench-actions">
            <button
              type="button"
              disabled={locked || (!!word && !typed.trim())}
              onClick={() => void decide("approved")}
            >
              {t("approval.approve")}
            </button>
            <button type="button" disabled={locked} onClick={() => void decide("denied")}>
              {t("approval.deny")}
            </button>
            {prefix !== undefined && (
              <>
                <label>
                  {t("approval.commandPrefix")}
                  <select
                    data-command-prefix
                    value={prefix}
                    disabled={locked}
                    onChange={(event) => setChosenPrefix(event.target.value)}
                  >
                    {prefixes.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  data-command-always-allow
                  disabled={locked}
                  onClick={() => void decide("approved", false, prefix)}
                >
                  {t("approval.alwaysAllow")}
                </button>
              </>
            )}
            {approval.tool !== "web_download" &&
              approval.tool !== "plugin_install" &&
              approval.tool !== "run_command" &&
              !word && (
                <button type="button" disabled={locked} onClick={() => void decide("approved", true)}>
                  {t("approval.switch")}
                </button>
              )}
          </div>
          <p className="muted">{t("approval.keys")}</p>
        </>
      )}
    </fieldset>
  );
}
