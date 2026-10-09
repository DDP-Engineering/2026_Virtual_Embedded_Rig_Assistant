// reports + test_runs (01 data model) ↔ domain types.
import type { CheckResult, Report, ReportKind, ReportSummary, TestRun, Verdict } from "@benchpilot/shared";
import type { Db } from "../index.ts";

interface ReportRow {
  id: string;
  plan_id: string | null;
  testbench_id: string;
  device: string;
  fw: string;
  kind: ReportKind;
  created_at: string;
  summary_json: string;
}

interface TestRunRow {
  id: string;
  report_id: string;
  dataset_id: string;
  test_id: string;
  test_name: string;
  test_version: number;
  device: string;
  fw: string;
  testbench_id: string;
  verdict: Verdict | null;
  checks_json: string;
  measured_json: string;
  started_at: number;
  ended_at: number;
  artifacts_json: string;
}

export const EMPTY_SUMMARY: ReportSummary = { total: 0, passed: 0, failed: 0, errored: 0, simDurationS: 0 };

export function insertReport(db: Db, r: Report): void {
  db.prepare(
    `INSERT INTO reports(id, plan_id, testbench_id, device, fw, kind, created_at, summary_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.id, r.planId, r.testbenchId, r.device, r.fw, r.kind, r.createdAt, JSON.stringify(r.summary));
}

export function updateReportSummary(db: Db, id: string, summary: ReportSummary): void {
  db.prepare("UPDATE reports SET summary_json = ? WHERE id = ?").run(JSON.stringify(summary), id);
}

const toReport = (r: ReportRow): Report => ({
  id: r.id,
  planId: r.plan_id,
  testbenchId: r.testbench_id,
  device: r.device,
  fw: r.fw,
  kind: r.kind,
  createdAt: r.created_at,
  summary: JSON.parse(r.summary_json) as ReportSummary,
});

export function getReport(db: Db, id: string): Report | null {
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as ReportRow | undefined;
  return row ? toReport(row) : null;
}

export function listReports(db: Db): Report[] {
  return (db.prepare("SELECT * FROM reports ORDER BY id").all() as ReportRow[]).map(toReport);
}

/** A test run row before evaluation (verdict NULL = in progress). */
export type NewTestRun = Omit<TestRun, "verdict" | "checks">;

export function insertTestRun(db: Db, t: NewTestRun): void {
  db.prepare(
    `INSERT INTO test_runs(id, report_id, dataset_id, test_id, test_name, test_version, device, fw, testbench_id,
       started_at, ended_at, artifacts_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id,
    t.reportId,
    t.datasetId,
    t.testId,
    t.testName,
    t.testVersion,
    t.device,
    t.fw,
    t.testbenchId,
    t.startedAt,
    t.endedAt,
    JSON.stringify(t.artifacts),
  );
}

export function finishTestRun(db: Db, id: string, verdict: Verdict, checks: CheckResult[], measured: Record<string, number | null>): void {
  db.prepare("UPDATE test_runs SET verdict = ?, checks_json = ?, measured_json = ? WHERE id = ?").run(
    verdict,
    JSON.stringify(checks),
    JSON.stringify(measured),
    id,
  );
}

const toTestRun = (r: TestRunRow): TestRun => ({
  id: r.id,
  reportId: r.report_id,
  datasetId: r.dataset_id,
  testId: r.test_id,
  testName: r.test_name,
  testVersion: r.test_version,
  device: r.device,
  fw: r.fw,
  testbenchId: r.testbench_id,
  // NULL only while the run is in progress; every finished run carries a verdict.
  verdict: r.verdict ?? "error",
  checks: JSON.parse(r.checks_json) as CheckResult[],
  startedAt: r.started_at,
  endedAt: r.ended_at,
  artifacts: JSON.parse(r.artifacts_json) as TestRun["artifacts"],
});

export function getTestRun(db: Db, id: string): TestRun | null {
  const row = db.prepare("SELECT * FROM test_runs WHERE id = ?").get(id) as TestRunRow | undefined;
  return row ? toTestRun(row) : null;
}

export function listTestRuns(db: Db, reportId: string): TestRun[] {
  return (db.prepare("SELECT * FROM test_runs WHERE report_id = ? ORDER BY id").all(reportId) as TestRunRow[]).map(toTestRun);
}

export function getMeasured(db: Db, id: string): Record<string, number | null> {
  const row = db.prepare("SELECT measured_json FROM test_runs WHERE id = ?").get(id) as { measured_json: string } | undefined;
  return row ? (JSON.parse(row.measured_json) as Record<string, number | null>) : {};
}

export function summarize(runs: Pick<TestRun, "verdict">[], simDurationS: number): ReportSummary {
  return {
    total: runs.length,
    passed: runs.filter((r) => r.verdict === "pass").length,
    failed: runs.filter((r) => r.verdict === "fail").length,
    errored: runs.filter((r) => r.verdict === "error").length,
    simDurationS,
  };
}
