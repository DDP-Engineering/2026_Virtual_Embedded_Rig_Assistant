interface Call {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  status: string;
}

interface Turn {
  calls: readonly Call[];
  outcome?: { stopReason?: string } | null | undefined;
  reply?: { text?: string; citations?: readonly { ref: string; valid: boolean }[] } | undefined;
}

interface Workflow {
  comparison: Turn;
  planning: Turn;
  execution: Turn;
  report: { name: string; content: string; sha256: string };
  plan?: { name: string; content: string } | null | undefined;
  planCount: number;
  reportRef: string;
}

function payloads(call: Call): unknown[] {
  const result = call.result as { isError?: boolean; content?: unknown } | null;
  if (call.status !== "ok" || result?.isError || !Array.isArray(result?.content)) return [];
  return result.content.flatMap((block: { type?: unknown; text?: unknown } | null) => {
    if (block?.type !== "text" || typeof block.text !== "string") return [];
    try {
      return [JSON.parse(block.text)];
    } catch {
      return [];
    }
  });
}

function resultRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(resultRefs);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === "ref" && typeof child === "string" ? [child] : resultRefs(child),
  );
}

function artifactRefs(content: string): string[] {
  return [...content.matchAll(/\[\[([^\]\n]+)\]\]/g)].flatMap((match) => match[1] ?? []);
}

function exactCitations(content: string, calls: readonly Call[]) {
  const refs = artifactRefs(content);
  const issued = new Set(calls.flatMap(payloads).flatMap(resultRefs));
  return refs.length > 0 && refs.every((ref) => issued.has(ref));
}

function citedSource(
  refs: readonly string[],
  calls: readonly Call[],
  path: string,
  tools: readonly string[],
) {
  const issued = new Set(
    calls
      .filter((call) => tools.includes(call.name))
      .flatMap(payloads)
      .flatMap(resultRefs),
  );
  return refs.some((ref) => ref.startsWith(`${path}#`) && issued.has(ref));
}

function beforeSave(calls: readonly Call[], name: string | undefined) {
  const index = calls.findIndex(
    (call) => call.name === "artifact_save" && call.status === "ok" && call.args.name === name,
  );
  return index < 0 ? [] : calls.slice(0, index);
}

function selectedSkill(calls: readonly Call[], expected: string) {
  const loads = calls.filter(({ name }) => name === "load_skill");
  return (
    loads.every((call) => call.args.name === expected && call.status === "ok") &&
    loads.some((call) => call.args.file === undefined)
  );
}

function section(text: string, heading: string) {
  return text.split(/^## +/m).find((part) => part.split("\n", 1)[0]?.trim().toLowerCase() === heading) ?? "";
}

function status(sectionText: string, field: string) {
  const plain = sectionText.replace(/[*\x60]/g, "");
  const values = [
    ...plain.matchAll(
      new RegExp(`^\\s*(?:- *)?(?:${field}):\\s*(ready_for_review|observation-only|blocked)\\b`, "gim"),
    ),
  ].map((match) => match[1]?.toLowerCase());
  return values.length === 1 ? values[0] : undefined;
}

function caseReadiness(plan: string) {
  const cases = section(plan, "test cases")
    .split(/^### +/m)
    .slice(1);
  const boot = cases.find((part) => /^\*{0,2}TP-0[12]\b[^\n]*boot/i.test(part));
  const timing = cases.find((part) => /^\*{0,2}TP-0[12]\b[^\n]*I2C/i.test(part));
  const criterion =
    timing
      ?.match(/^[ \t]*(?:-[ \t]+)?(?:\*\*)?criterion\b[^\n]*(?:\n[ \t]{2,}[^\n]+)*/im)?.[0]
      ?.replace(/\n[ \t]+/g, " ") ?? "";
  const noThreshold =
    /\b(?:no|absent|missing)\b[^.\n]{0,90}\b(?:limit|threshold)\b|\b(?:limit|threshold)\b[^.\n]{0,50}\b(?:missing|unknown|not specified|not provided)\b/i;
  const inventedLimit =
    /(?:[<>≤≥]=?|\b(?:within|under|over|below|above|less than|more than|at most|at least|must be|shall be))\s*\d+(?:[.,]\d+)?\s*(?:ms|milliseconds?)/i;
  return (
    cases.length === 2 &&
    !!boot &&
    !!timing &&
    boot !== timing &&
    status(section(plan, "readiness"), "overall(?: readiness)?|status") === "blocked" &&
    status(boot, "case (?:readiness|status)|status") === "ready_for_review" &&
    status(timing, "case (?:readiness|status)|status") === "observation-only" &&
    noThreshold.test(criterion) &&
    !inventedLimit.test(timing.replace(/[*\x60]/g, ""))
  );
}

/** Scores the fixed two-run and two-case fixture from the actual model calls and persisted artifacts. */
export function scoreAnalysisWorkflow({
  comparison,
  planning,
  execution,
  report,
  plan,
  planCount,
  reportRef,
}: Workflow) {
  const comparisonSources = beforeSave(comparison.calls, report.name);
  const reportRefs = artifactRefs(report.content);
  const planText = plan?.content ?? "";
  const planSources = beforeSave(planning.calls, plan?.name);
  const reportReadIndex = planSources.findIndex(
    (call) =>
      call.name === "read" &&
      call.args.path === reportRef &&
      payloads(call).some(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          "ref" in value &&
          "sha256" in value &&
          value.ref === reportRef &&
          value.sha256 === report.sha256,
      ),
  );
  const planRefs = artifactRefs(planText);
  const fresh = planSources.slice(reportReadIndex + 1);
  const criterion = section(report.content, "criterion");
  const criterionText = criterion.replace(/\[\[[^\]\n]+\]\]/g, "");
  const reply = execution.reply?.text ?? "";
  return {
    comparisonSkill:
      comparison.outcome?.stopReason === "end" && selectedSkill(comparison.calls, "firmware-comparator"),
    reportCitations:
      exactCitations(report.content, comparisonSources) &&
      ["logs/baseline.log", "logs/candidate.log"].every((path) =>
        citedSource(reportRefs, comparisonSources, path, ["parse_log"]),
      ) &&
      comparison.reply?.citations?.some(({ ref, valid }) => ref === reportRef && valid) === true,
    reportObservation:
      /I2C_TIMEOUT/.test(report.content) &&
      /^[| \t*-]*(?:candidate\b|(?:firmware )?1\.1\.0\b)(?=.*\bnot met\b)(?=.*(?:error|I2C_TIMEOUT)).+$/im.test(
        criterionText,
      ) &&
      artifactRefs(criterion).some((ref) => ref.startsWith("docs/boot-test.md#")),
    plannerSkill: planning.outcome?.stopReason === "end" && selectedSkill(planning.calls, "test-planner"),
    exactSavedReportRead: reportReadIndex >= 0,
    planCitations:
      reportReadIndex >= 0 &&
      exactCitations(planText, planSources) &&
      planRefs.includes(reportRef) &&
      citedSource(planRefs, fresh, "WORKBENCH.md", ["read", "read_doc"]) &&
      citedSource(planRefs, fresh, "docs/boot-test.md", ["read", "read_doc"]) &&
      citedSource(planRefs, fresh, "logs/candidate.log", ["read", "parse_log"]),
    individualReadiness: planCount === 1 && caseReadiness(planText),
    executionRouting:
      execution.outcome?.stopReason === "end" &&
      execution.calls.every((call) => call.name !== "load_skill" && call.name !== "artifact_save") &&
      /\b(?:cannot|can['’]t|unable to)\s+(?:execute|run|perform)\b/i.test(reply) &&
      !/\b(?:I|we) (?:ran|executed|completed)\b|\btest (?:passed|was executed)\b/im.test(reply) &&
      !/^\s*(?:\d+\.\s|#{1,6}.*\btest plan\b)/im.test(reply),
  };
}
