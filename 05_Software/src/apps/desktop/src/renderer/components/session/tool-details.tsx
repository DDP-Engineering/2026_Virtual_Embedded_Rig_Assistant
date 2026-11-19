import { todoItemsSchema } from "@vera/shared";
import { Check, ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pager, usePaged } from "../pager.js";
import { BoundedText, ToolOutput } from "./bounded-text.js";
import { Disclosure } from "./disclosure.js";
import { PlanItems } from "./plan-tab.js";
import type { ToolItem } from "./transcript-projection.js";

function defineTranslationKeys<const T extends readonly string[]>(keys: T): T {
  return keys;
}
const actionKeys = defineTranslationKeys([
  "toolActivity.operation",
  "toolActivity.readFile",
  "toolActivity.listFiles",
  "toolActivity.findFiles",
  "toolActivity.searchFiles",
  "toolActivity.changeFile",
  "toolActivity.saveArtifact",
  "toolActivity.updatePlan",
  "toolActivity.searchDocs",
  "toolActivity.readDocument",
  "toolActivity.loadSkill",
  "toolActivity.searchWeb",
  "toolActivity.readWeb",
  "toolActivity.download",
  "toolActivity.searchParts",
  "toolActivity.runProgram",
  "toolActivity.runCommand",
  "toolActivity.programOutput",
  "toolActivity.stopProgram",
  "toolActivity.readTerminal",
  "toolActivity.help",
  "toolActivity.validatePlugin",
  "toolActivity.installPlugin",
  "toolActivity.analyseLog",
  "toolActivity.decodeRegister",
  "toolActivity.electrical",
]);
const actionIndex = {
  read: 1,
  list: 2,
  glob: 3,
  grep: 4,
  write: 5,
  edit: 5,
  apply_candidate: 5,
  artifact_save: 6,
  todo: 7,
  search_docs: 8,
  read_doc: 9,
  load_skill: 10,
  web_search: 11,
  web_read: 12,
  web_download: 13,
  parts_search: 14,
  run_program: 15,
  run_command: 16,
  program_output: 17,
  program_stop: 18,
  terminal_read: 19,
  help: 20,
  plugin_validate: 21,
  plugin_install: 22,
  parse_log: 23,
  decode_register: 24,
  electrical_model: 25,
  electrical_model_change: 25,
  industrial_catalog: 25,
  electrical_network: 25,
  protection_coordination: 25,
  motor_drives: 25,
  power_quality: 25,
  lighting_design: 25,
} as const;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const string = (value: unknown) => (typeof value === "string" ? value : undefined);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** Presentation hints are optional: excerpts and unfamiliar results stay available in technical details. */
function resultRecord(item: ToolItem) {
  for (const text of [item.preview, item.summary]) {
    if (!text || text.length > 64 * 1024) continue;
    try {
      const result = record(JSON.parse(text));
      if (result) return result;
    } catch {}
  }
  return undefined;
}

/** Human-readable activity, with exact arguments/output loaded only when technical details are opened. */
export const ToolDetails = memo(function ToolDetails({
  item,
  update,
  sessionId,
}: {
  item: ToolItem;
  update: string | undefined;
  sessionId: string | undefined;
}) {
  const { t } = useTranslation();
  const action = Object.hasOwn(actionIndex, item.name)
    ? actionIndex[item.name as keyof typeof actionIndex]
    : 0;
  const args = item.truncated?.args === undefined ? (record(item.args) ?? {}) : {};
  const result = resultRecord(item);
  const program = ["run_command", "run_program", "program_output", "program_stop"].includes(item.name);
  const exitCode = program ? number(result?.exitCode) : undefined;
  const failed = item.status === "error" || (program && (result?.timedOut === true || !!result?.error));
  const stopped = !failed && program && result?.stopped === true;
  const background = !failed && program && item.status === "ok" && typeof result?.handle === "string";
  const error = failed || (!stopped && exitCode !== undefined && exitCode !== 0);
  const running = !error && !stopped && item.status === "running";
  const status = error
    ? result?.timedOut === true
      ? t("runs.state.timedOut")
      : t("chat.error")
    : stopped
      ? t("runs.state.stopped")
      : background
        ? t("toolActivity.background")
        : running
          ? t("chat.running")
          : program && result?.running === true
            ? t("toolActivity.stillRunning")
            : t("chat.toolOk");
  const Icon = error ? CircleAlert : running ? LoaderCircle : Check;
  const target =
    (item.name === "help" ? string(result?.title) : undefined) ??
    string(args.command) ??
    string(args.path) ??
    string(args.ref) ??
    string(args.query) ??
    string(args.pattern) ??
    string(args.name) ??
    string(args.page) ??
    string(args.plugin) ??
    string(args.program) ??
    string(args.url) ??
    string(args.mpn) ??
    string(args.terminalId) ??
    string(args.handle);
  const results = result?.results ?? result?.matches ?? result?.paths ?? result?.entries;
  const plan =
    item.name === "todo" && item.status === "ok" ? todoItemsSchema.safeParse(result?.items) : undefined;
  const { rows, pager } = usePaged(Array.isArray(results) ? results : []);
  const caption = plan?.success
    ? plan.data.length
      ? t("toolActivity.planSteps", { count: plan.data.length })
      : t("toolActivity.planCleared")
    : exitCode !== undefined
      ? t("toolActivity.exitCode", { code: exitCode })
      : item.name === "web_download" && item.status === "ok"
        ? t("downloads.saved")
        : Array.isArray(results)
          ? t("toolActivity.resultCount", { count: results.length })
          : number(result?.added) !== undefined && number(result?.removed) !== undefined
            ? t("toolActivity.changedLines", { added: result?.added, removed: result?.removed })
            : undefined;
  const output =
    item.name === "search_docs" && result?.ranking === "embedding-rebuild"
      ? t("toolActivity.embeddingRebuild")
      : (string(result?.error) ?? string(result?.output) ?? string(result?.text) ?? string(result?.message));
  const raw = item.preview ?? update ?? item.summary;
  return (
    <Disclosure
      tool={item.name}
      className="tool-activity"
      title={
        <span className="tool-activity-title" data-tool-status={error ? "error" : running ? "running" : "ok"}>
          <Icon aria-hidden="true" />
          <span className="tool-activity-description">
            <strong>{t(actionKeys[action])}</strong>
            {target && (
              <span className="tool-activity-target" title={target}>
                {target.slice(0, 140)}
              </span>
            )}
            {caption && <span className="tool-activity-caption">{caption}</span>}
          </span>
          <span className="tool-activity-status">{status}</span>
          <ChevronRight className="tool-activity-chevron" aria-hidden="true" />
        </span>
      }
    >
      <div className="tool-activity-body">
        {plan?.success && <PlanItems items={plan.data} />}
        {typeof args.command === "string" && <pre className="tool-command">{args.command}</pre>}
        {typeof args.cwd === "string" && <p>{t("toolActivity.folder", { path: args.cwd })}</p>}
        {rows.length > 0 && (
          <>
            <ol className="tool-result-list">
              {rows.map((row, index) => {
                const entry = record(row);
                const name =
                  string(row) ??
                  string(entry?.title) ??
                  string(entry?.ref) ??
                  string(entry?.path) ??
                  string(entry?.name) ??
                  string(entry?.url);
                const snippet = string(entry?.snippet) ?? string(entry?.text);
                return name || snippet ? (
                  <li key={String(index)}>
                    {name && <strong>{name}</strong>}
                    {snippet && <pre>{snippet.slice(0, 2000)}</pre>}
                  </li>
                ) : null;
              })}
            </ol>
            <Pager {...pager} />
          </>
        )}
        {output?.trim() ? (
          <>
            <pre>{output.slice(0, 12000)}</pre>
            {output.length > 12000 && <p>{t("toolActivity.moreInTechnical")}</p>}
          </>
        ) : (
          raw?.trim() &&
          !result &&
          !/^\s*[{[]/.test(raw) && (
            <BoundedText
              sessionId={sessionId}
              itemId={item.id}
              field="preview"
              text={raw}
              totalBytes={item.truncated?.preview}
            >
              {(text) => <pre>{text}</pre>}
            </BoundedText>
          )
        )}
        <Disclosure
          title={
            <>
              {t("toolActivity.technical")}
              <ChevronRight aria-hidden="true" />
            </>
          }
          className="tool-technical"
        >
          <p>{t("toolActivity.toolName", { name: item.name })}</p>
          {item.durationMs !== undefined && <p>{t("toolActivity.duration", { ms: item.durationMs })}</p>}
          <ToolOutput item={item} update={update} sessionId={sessionId} />
        </Disclosure>
      </div>
    </Disclosure>
  );
});
