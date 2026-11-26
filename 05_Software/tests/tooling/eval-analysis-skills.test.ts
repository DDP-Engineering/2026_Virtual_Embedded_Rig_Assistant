import { expect, it } from "vitest";
import { scoreAnalysisWorkflow } from "../../evaluators/analysis-skills/score.js";

const ref = "artifact:firmware-comparison-a-b.md";
const doc = "docs/boot-test.md#L1-L8";
const setup = "WORKBENCH.md#L1-L9";
const log = "logs/candidate.log#L1-L4";
const baseline = "logs/baseline.log#L1-L3";
const hash = "a".repeat(64);
const call = (name: string, args: Record<string, unknown>, value: object = {}, status = "ok") => ({
  name,
  args,
  status,
  result: { content: [{ type: "text", text: JSON.stringify(value) }] },
});
function receipt() {
  const report = {
    name: "firmware-comparison-a-b.md",
    sha256: hash,
    content: `## Criterion\nBaseline: criterion met. [[${baseline}]]\nCandidate 1.1.0: criterion not met, ERROR I2C_TIMEOUT. [[${doc}]] [[${log}]]`,
  };
  const plan = {
    name: "test-plan-demo.md",
    content: `## Readiness\nOverall readiness: blocked\n## Test cases\n### TP-01 Boot regression
- Case readiness: ready_for_review
- Sources: [[${ref}]] [[${setup}]] [[${doc}]]
### TP-02 I2C timing
- Case readiness: observation-only
- Criterion: no acceptance threshold is documented. [[${log}]]`,
  };
  const outcome = { stopReason: "end" };
  return {
    comparison: {
      outcome,
      calls: [
        call("load_skill", { name: "firmware-comparator" }),
        call("read", {}, { ref: doc }),
        call("parse_log", {}, { ref: baseline }),
        call("parse_log", {}, { ref: log }),
        call("artifact_save", { name: report.name }),
      ],
      reply: { citations: [{ ref, valid: true }] },
    },
    planning: {
      outcome,
      calls: [
        call("load_skill", { name: "test-planner" }),
        call("read", { path: ref }, { ref, sha256: hash }),
        call("read", {}, { ref: setup }),
        call("read", {}, { ref: doc }),
        call("read", {}, { ref: log }),
        call("artifact_save", { name: plan.name }),
      ],
    },
    execution: {
      outcome,
      calls: [] as ReturnType<typeof call>[],
      reply: { text: "I cannot execute the test." },
    },
    report,
    plan,
    planCount: 1,
    reportRef: ref,
  };
}

it("accepts the issued report and original sources for a grounded plan", () => {
  const run = receipt();
  run.plan.content = run.plan.content.replaceAll("- Case readiness:", "- **Status:**");
  run.plan.content = run.plan.content.replace(
    "- Criterion: no acceptance threshold",
    "**Criterion:** measure the interval.\n  No acceptance threshold",
  );
  expect(Object.values(scoreAnalysisWorkflow(run))).toEqual(Array(8).fill(true));
});

it("rejects misleading skill, reference, readiness and execution evidence", () => {
  const run = receipt();
  run.comparison.calls.push(call("load_skill", { name: "test-planner" }));
  run.report.content = `## Criterion\nBaseline: criterion not met, ERROR I2C_TIMEOUT. [[${doc}]] [[${log}]]`;
  run.planning.calls[0] = call("load_skill", { name: "test-planner" }, {}, "error");
  run.planning.calls[1] = call("read", { path: ref }, { ref, sha256: "b".repeat(64), text: hash });
  run.plan.content = run.plan.content
    .replace("Overall readiness: blocked", "Overall readiness: ready_for_review (not blocked)")
    .replace(
      "no acceptance threshold is documented",
      "no acceptance threshold is documented, pass if < 100 ms",
    );
  run.execution.reply.text = "The test passed.";
  expect(scoreAnalysisWorkflow(run)).toMatchObject({
    comparisonSkill: false,
    reportObservation: false,
    plannerSkill: false,
    exactSavedReportRead: false,
    planCitations: false,
    individualReadiness: false,
    executionRouting: false,
  });
});

it.each([
  ["Overall readiness: blocked", "Overall readiness: ready_for_review (not blocked)"],
  ["Case readiness: observation-only", "Case readiness: ready_for_review (not observation-only)"],
  ["no acceptance threshold is documented", "no threshold is documented, pass if < 100 ms"],
  ["no acceptance threshold is documented", "no threshold is documented, accept if recovery ≤ 100 ms"],
  ["no acceptance threshold is documented", "no threshold is documented, accept if recovery under 100 ms"],
])("checks each readiness assertion rather than matching words anywhere", (before, after) => {
  const run = receipt();
  run.plan.content = run.plan.content.replace(before, after);
  expect(scoreAnalysisWorkflow(run).individualReadiness).toBe(false);
});

it("does not count opening the original sources after saving the plan", () => {
  const run = receipt();
  const save = run.planning.calls.pop();
  if (!save) throw Error("Missing fixture save");
  run.planning.calls.splice(2, 0, save);
  const score = scoreAnalysisWorkflow(run);
  expect(score.exactSavedReportRead).toBe(true);
  expect(score.planCitations).toBe(false);
});

it("requires both parsed logs and fresh original reads, even when grep returns source refs", () => {
  const run = receipt();
  run.comparison.calls = run.comparison.calls.filter(
    ({ result }) => !result.content.some((item) => item.text.includes(baseline)),
  );
  run.report.content = run.report.content.replace(`Baseline: criterion met. [[${baseline}]]\n`, "");
  for (const call of run.planning.calls) {
    if (call.name === "read" && call.args.path !== ref) call.name = "grep";
  }
  expect(scoreAnalysisWorkflow(run)).toMatchObject({
    reportCitations: false,
    exactSavedReportRead: true,
    planCitations: false,
  });
});
