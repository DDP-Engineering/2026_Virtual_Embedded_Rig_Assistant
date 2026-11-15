// The Markdown report of a stored electrical result (spec REQ-DATA-42ce122f "Report"): one renderer for every
// plugin's result, built only from the result document and its freshness against the current model.
import type { ElectricalModel, ElectricalResult } from "@vera/shared";
import type { Freshness } from "./results.js";

const REPORT_LIMIT = 64 * 1024;
const cell = (text: string) => text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
const amount = (entry: { value: number | null; unit: string } | undefined) =>
  entry === undefined ? "" : entry.value === null ? `unknown ${entry.unit}` : `${entry.value} ${entry.unit}`;

/** Markdown for one result; `model` (the current one, if any) supplies the visible references of subjects. */
export function renderResultReport(
  result: ElectricalResult,
  freshness: Freshness,
  model: ElectricalModel | null,
): string {
  const refs = new Map(
    (model?.objects ?? []).flatMap((object) => (object.ref ? [[object.id, object.ref] as const] : [])),
  );
  const subject = (id: string | undefined) =>
    id === undefined ? "-" : refs.has(id) ? `${refs.get(id)} (${id})` : id;
  const lines: string[] = [
    `# ${result.method.title}`,
    "",
    `Run ${result.runId} - ${result.producer.plugin} ${result.producer.operation} - engine ${result.producer.engine.name} ${result.producer.engine.version} - status **${result.status}** - ${result.startedAt}`,
    "",
  ];
  if (result.preliminary)
    lines.push(
      "> Preliminary result: engineering support, not a verified design, no conformity statement and no safety certification.",
      "",
    );
  lines.push(
    freshness.freshness === "current"
      ? "Freshness: current (every input is unchanged in the model)."
      : `Freshness: **Stale** - changed: ${freshness.changed.map(subject).join(", ") || "none"}; removed: ${freshness.removed.map(subject).join(", ") || "none"}. Run the calculation again before relying on it.`,
    "",
    `Method: ${result.method.id}${result.method.reference ? ` - ${result.method.reference}` : ""}`,
    `Model: ${result.model.path} sha256 ${result.model.sha256}${result.catalog ? `; catalog ${result.catalog.id} ${result.catalog.version}` : ""}`,
    "",
  );
  const list = (title: string, items: readonly string[]) => {
    if (!items.length) return;
    lines.push(`## ${title}`, "", ...items.map((item) => `- ${item}`), "");
  };
  list(
    "Conditions",
    Object.entries(result.conditions).map(
      ([key, condition]) =>
        `${key}: ${"text" in condition ? condition.text : `${condition.value} ${condition.unit}`}`,
    ),
  );
  list("Assumptions", result.assumptions);
  list("Sources", result.sources);
  if (result.criteria.length) {
    lines.push(
      "## Criteria",
      "",
      "| Subject | Criterion | Verdict | Measured | Limit | Note |",
      "|---|---|---|---|---|---|",
    );
    for (const entry of result.criteria)
      lines.push(
        `| ${cell(subject(entry.subject))} | ${cell(entry.id)} | ${entry.verdict} | ${cell(amount(entry.measured))} | ${cell(amount(entry.limit))} | ${cell(entry.note ?? "")} |`,
      );
    lines.push("");
  }
  if (result.intermediate.length) {
    lines.push("## Values", "", "| Subject | Name | Value |", "|---|---|---|");
    for (const entry of result.intermediate)
      lines.push(`| ${cell(subject(entry.subject))} | ${cell(entry.name)} | ${cell(amount(entry))} |`);
    lines.push("");
  }
  list("Limits", result.limits);
  list("Messages", result.messages);
  const text = lines.join("\n");
  return text.length <= REPORT_LIMIT
    ? text
    : `${text.slice(0, REPORT_LIMIT)}\n\n… the report is cut at 64 KiB.\n`;
}
