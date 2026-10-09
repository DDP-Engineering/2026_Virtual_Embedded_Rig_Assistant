import type { ReportSummary, RunState, RunTestState } from "@benchpilot/shared";
import { useNavigate } from "react-router";
import { VerdictPill, type PillState } from "@/components/common/Pills";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function testPillState(t: RunTestState, run: RunState): PillState {
  if (t.verdict) return t.verdict;
  if (run.status === "aborted") return "aborted";
  return t.status === "running" ? "running" : "queued";
}

export function ProgressBar({ pct, verdict, label }: { pct: number; verdict: RunTestState["verdict"]; label: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <i
        className={cn("block h-full rounded-full transition-[width] duration-150", verdict === "fail" ? "bg-fail" : verdict === "pass" ? "bg-pass" : verdict === "error" ? "bg-warn" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** 05 RunCard: compact progress with verdict pills; clicking it focuses Monitor. */
export function RunCard({ run, onFocus }: { run: RunState; onFocus: () => void }) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <button
        type="button"
        onClick={onFocus}
        aria-label={`Run ${run.reportId}: show in Monitor`}
        className="grid grid-cols-[minmax(0,1fr)] gap-[9px] rounded-[10px] border bg-card px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(20,32,34,.06)] hover:border-border-strong dark:shadow-none"
      >
        <span className="flex flex-wrap items-center gap-2.5">
          <b className="font-mono font-semibold">{run.reportId}</b>
          <span className="text-[12.5px] text-muted-foreground">
            {run.device} · fw {run.fw} · TB-01
          </span>
          <span className="flex-1" />
          <span className="text-xs text-faint-foreground">{run.status === "running" ? "Running · open Monitor" : run.status === "aborted" ? "Stopped" : "Finished"}</span>
        </span>
        {run.tests.map((t) => (
          <span key={t.testRunId} className="grid grid-cols-[minmax(0,1fr)_110px_64px] items-center gap-2.5 text-[13px]">
            <span className="truncate">
              <span className="font-mono">{t.testId}</span> <span className="text-muted-foreground">{t.name}</span>
            </span>
            <ProgressBar pct={t.pct} verdict={t.verdict} label={`${t.testId} progress`} />
            <span className="justify-self-end">
              <VerdictPill state={testPillState(t, run)} />
            </span>
          </span>
        ))}
      </button>
      {run.status === "completed" && run.summary && <ReportCard reportId={run.reportId} fw={run.fw} summary={run.summary} />}
    </div>
  );
}

/** 05 ReportCard: KPIs + verdict pills + Open report. */
export function ReportCard({ reportId, fw, summary }: { reportId: string; fw: string; summary: ReportSummary }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-[10px] border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(20,32,34,.06)] dark:shadow-none">
      <div>
        <div className="font-mono text-[15px] leading-tight font-semibold">{reportId}</div>
        <div className="text-xs text-muted-foreground">
          fw {fw} · {summary.total} tests
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {summary.passed > 0 && <VerdictPill state="pass" count={summary.passed} />}
        {summary.failed > 0 && <VerdictPill state="fail" count={summary.failed} />}
        {summary.errored > 0 && <VerdictPill state="error" count={summary.errored} />}
      </div>
      <span className="min-w-[120px] flex-1" />
      <Button variant="outline" onClick={() => navigate(`/reports/${reportId}`)}>
        Open report
      </Button>
    </div>
  );
}
