import type { MonitorEvent, RunState, RunTestState } from "@benchpilot/shared";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { MetricChart } from "@/components/charts/MetricChart";
import { EmptyState, SectionTitle } from "@/components/common/Bits";
import { VerdictPill } from "@/components/common/Pills";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { ChartCard } from "@/components/report/ReportCharts";
import { formatClock, formatSimProgress, metricDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProgressBar, testPillState } from "./RunCard";

/** Per-metric chart settings for the live monitor. */
const CHARTS: Record<string, { title: string; threshold?: (testId: string) => number | undefined; yDomain?: [number, number]; dots?: boolean }> = {
  mem_free_kb: { title: "free memory (MB)", yDomain: [0, 200] },
  throughput_mbps: { title: "throughput (Mbps)", threshold: (t) => (t === "TC-PERF-003" ? 900 : t === "TC-END-004" ? 800 : undefined), yDomain: [0, 1000] },
  dns_response_ms: { title: "DNS response (ms)", threshold: () => 50, dots: true },
};

const SOURCE_LABEL: Record<string, string> = { "switch-syslog": "sw-01", "dut-syslog": "dut" };

const markerLabel = (e: MonitorEvent) => (/out of memory/i.test(e.message) ? "OOM" : /down/i.test(e.message) ? "link down" : "error");

function TestCharts({ run, test }: { run: RunState; test: RunTestState }) {
  const metrics = run.metrics[test.testRunId] ?? {};
  const names = Object.keys(CHARTS).filter((n) => metrics[n]?.length);
  if (!names.length) return null;
  const startTs = Math.min(...names.map((n) => metrics[n]![0]!.ts));
  const markers = run.events.filter((e) => e.testRunId === test.testRunId && e.severity === "error").map((e) => ({ ts: e.ts, label: markerLabel(e) }));
  return (
    <>
      {names.map((name) => {
        const cfg = CHARTS[name]!;
        const d = metricDisplay(name);
        const threshold = cfg.threshold?.(test.testId);
        return (
          <ChartCard key={name} title={`${test.testId} · ${cfg.title}`} note={threshold !== undefined ? `threshold ${threshold}` : `${formatSimProgress(test.simTime, test.simDurationS).split(" / ")[1]} simulated`}>
            <MetricChart
              ariaLabel={`${test.testId} ${cfg.title}, live`}
              series={[{ name, points: metrics[name]!, color: "var(--primary)", fill: !cfg.dots, dots: cfg.dots }]}
              startTs={startTs}
              span={test.simDurationS || 1}
              divisor={d.div}
              threshold={threshold}
              yDomain={cfg.yDomain}
              markers={markers}
              height={130}
            />
          </ChartCard>
        );
      })}
    </>
  );
}

const SEVERITY = {
  error: { icon: CircleAlert, className: "text-fail" },
  warning: { icon: TriangleAlert, className: "text-warn" },
  info: { icon: Info, className: "text-muted-foreground" },
};

/** 05 Monitor: per-test progress with simulated clock, live charts, event feed. */
export function MonitorTab({ runs }: { runs: RunState[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const run = runs.find((r) => r.reportId === picked) ?? runs.at(-1);

  if (!run)
    return (
      <EmptyState>
        No run in progress.
        <span className="text-faint-foreground">Approve a test plan in the conversation to start. Progress, live metrics, and lab events appear here.</span>
      </EmptyState>
    );

  const done = run.tests.filter((t) => t.status === "done").length;
  const current = Math.min(done + 1, run.tests.length);
  const passed = run.tests.filter((t) => t.verdict === "pass").length;
  const failed = run.tests.filter((t) => t.verdict === "fail").length;
  // A stopped run still completes: the runner marks the remaining tests `error` and builds the report.
  const errored = run.tests.length - passed - failed;

  return (
    <div className="grid gap-3.5">
      {runs.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Runs in this session">
          {runs.map((r) => (
            <button
              key={r.reportId}
              type="button"
              onClick={() => setPicked(r.reportId)}
              aria-pressed={r === run}
              className={cn("rounded-md border px-2 py-0.5 font-mono text-xs", r === run ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:bg-accent")}
            >
              {r.reportId}
            </button>
          ))}
        </div>
      )}
      <SectionTitle>
        {run.reportId} ·{" "}
        {run.status === "running"
          ? `running ${current}/${run.tests.length}`
          : run.status === "aborted"
            ? "stopped"
            : errored === run.tests.length
              ? "stopped · no verdicts"
              : `finished · ${passed} pass / ${failed} fail${errored ? ` / ${errored} error` : ""}`}
      </SectionTitle>

      <div className="grid gap-3">
        {run.tests.map((t) => (
          <div key={t.testRunId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-[13px]">
            <span className="truncate">
              <span className="font-mono">{t.testId}</span> <span className="text-muted-foreground">{t.name}</span>
            </span>
            <VerdictPill state={testPillState(t, run)} />
            <div className="col-span-2">
              <ProgressBar pct={t.pct} verdict={t.verdict} label={`${t.testId} progress`} />
            </div>
            <small className="font-mono text-[11px] text-faint-foreground">{t.status === "queued" ? "queued" : `${formatSimProgress(t.simTime, t.simDurationS)} sim`}</small>
          </div>
        ))}
      </div>

      {run.tests.map((t) => (
        <TestCharts key={t.testRunId} run={run} test={t} />
      ))}

      <SectionTitle>
        Lab events <span className="tracking-normal normal-case">· test time (UTC)</span>
      </SectionTitle>
      <div className="overflow-hidden rounded-[9px] border" aria-live="polite">
        {run.events.length === 0 ? (
          <div className="px-2.5 py-2 text-xs text-muted-foreground">No notable events yet.</div>
        ) : (
          run.events.map((e, i) => {
            const sev = SEVERITY[e.severity];
            const Icon = sev.icon;
            return (
              <div key={`${e.ev}-${i}`} className="grid grid-cols-[60px_minmax(0,1fr)] gap-x-2 gap-y-1 border-b px-2.5 py-[7px] text-xs last:border-b-0">
                <span className="pt-px font-mono text-[11px] text-faint-foreground" title="Test time: when the dataset was recorded (UTC), not the wall clock">
                  {formatClock(e.ts)}
                </span>
                <span className="min-w-0 font-mono text-[11.5px] break-words">
                  <Icon className={cn("mr-1 inline size-3.5 align-[-2px]", sev.className)} aria-label={e.severity} />
                  <span className={cn("mr-1.5 font-semibold", sev.className)}>{SOURCE_LABEL[e.source] ?? e.source}</span>
                  {e.message}
                </span>
                <span className="col-start-2 flex items-center gap-1.5">
                  <span className="font-mono text-[11px] text-faint-foreground">{e.testId}</span>
                  <EvidenceChip evidenceRef={e.ev} />
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
