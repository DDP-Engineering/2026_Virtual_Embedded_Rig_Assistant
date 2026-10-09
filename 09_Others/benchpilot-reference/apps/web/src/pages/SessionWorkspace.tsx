import { appendUserMessage, sessionStatus, type SessionDetail, type SessionEvent } from "@benchpilot/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, FlaskConical, GitCompareArrows, Play, Search, WifiOff } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/api";
import { qk, useReport, useSession, useTestbench } from "@/api/queries";
import { useSessionEvents } from "@/api/useSessionEvents";
import { EmptyState } from "@/components/common/Bits";
import { VerdictPill } from "@/components/common/Pills";
import { EvidenceOpenerProvider } from "@/components/evidence/EvidenceContext";
import { EvidenceViewer } from "@/components/evidence/EvidenceViewer";
import { ReportViewCompact } from "@/components/report/ReportView";
import { Composer } from "@/components/session/Composer";
import { ContextTab } from "@/components/session/ContextTab";
import { MonitorTab } from "@/components/session/MonitorTab";
import { SessionList } from "@/components/session/SessionList";
import { Transcript } from "@/components/session/Transcript";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveTestbench } from "@/hooks/use-active-testbench";
import { NotFoundPage } from "./NotFoundPage";

/** The demo prompts of 07, in order. */
export const DEMO_PROMPTS = [
  "Run the performance tests for firmware 2.1.0.",
  "Analyze the root cause of the failures in RPT-0009.",
  "Compare firmware 2.1.0 with 2.0.4. What changed, and is 2.1.0 release-ready?",
  "Re-run the throughput test to confirm the environment issue.",
  "Is TC-DNS-005 a reliable test?",
];

const STARTERS = [
  { prompt: DEMO_PROMPTS[0]!, icon: Play, note: "Plan a suite, approve it, watch it run." },
  { prompt: DEMO_PROMPTS[1]!, icon: Search, note: "Triage failures with evidence." },
  { prompt: DEMO_PROMPTS[2]!, icon: GitCompareArrows, note: "Regressions and release readiness." },
  { prompt: DEMO_PROMPTS[4]!, icon: FlaskConical, note: "Flaky-test check from history and packets." },
];

type PanelTab = "monitor" | "report" | "evidence" | "context";

function EmptySession({ onPick, disabled }: { onPick: (p: string) => void; disabled: boolean }) {
  return (
    <div className="mx-auto grid max-w-[640px] gap-4 pt-[8vh]">
      <div className="grid gap-1 text-center">
        <h2 className="text-lg font-semibold">What should BenchPilot do on this testbench?</h2>
        <p className="text-muted-foreground">It plans runs, asks for your approval, monitors, reports, and investigates failures with evidence.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {STARTERS.map(({ prompt, icon: Icon, note }) => (
          <button
            key={prompt}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className="grid gap-1.5 rounded-[10px] border bg-card p-3.5 text-left hover:border-primary disabled:opacity-60"
          >
            <Icon className="size-4 text-primary" aria-hidden="true" />
            <span className="font-medium">{prompt}</span>
            <span className="text-[12.5px] text-muted-foreground">{note}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReportTab({ reportId, onAsk }: { reportId: string | null; onAsk: (p: string) => void }) {
  const navigate = useNavigate();
  const { data } = useReport(reportId);
  if (!reportId)
    return (
      <EmptyState>
        No report yet in this session.
        <span className="text-faint-foreground">Approve a test plan to create one.</span>
      </EmptyState>
    );
  if (!data || data.id !== reportId) return <Skeleton className="h-48" />;
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2.5">
        <b className="font-mono text-base">{data.id}</b>
        <VerdictPill state={data.verdict} />
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => navigate(`/reports/${data.id}`)}>
          Full page
          <ArrowUpRight aria-hidden="true" />
        </Button>
      </div>
      <ReportViewCompact report={data} onAsk={onAsk} />
    </div>
  );
}

/** Main demo screen (05 §4): sessions | conversation | Monitor/Report/Evidence/Context, all resizable. */
export function SessionWorkspace() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTb] = useActiveTestbench();
  const [tab, setTab] = useState<PanelTab>("context");
  const [evidenceRef, setEvidenceRef] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const { data: detail, isError } = useSession(id);
  const onEvent = useCallback((e: SessionEvent) => {
    if (e.type === "run.started") setTab("monitor");
  }, []);
  const stream = useSessionEvents(id, onEvent);
  const { data: tb } = useTestbench(detail?.session.testbenchId ?? activeTb);

  // `?prompt=` (from "Ask BenchPilot to analyse this report") pre-fills the composer once.
  useEffect(() => {
    const prompt = params.get("prompt");
    if (prompt === null) return;
    setDraft(prompt);
    setParams({}, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    setEvidenceRef(null);
    setTab("context");
    stick.current = true;
  }, [id]);

  const openEvidence = useCallback((ref: string) => {
    setEvidenceRef(ref);
    setTab("evidence");
  }, []);

  const status = detail ? sessionStatus(detail) : "idle";
  const runs = useMemo(() => (detail ? detail.items.flatMap((i) => (i.kind === "run" && detail.runs[i.reportId] ? [detail.runs[i.reportId]!] : [])) : []), [detail]);
  const latestReport = [...runs].reverse().find((r) => r.status === "completed")?.reportId ?? detail?.session.lastReportId ?? null;
  const asked = new Set(detail?.items.flatMap((i) => (i.kind === "user" ? [i.text] : [])));
  const chips = detail?.items.length ? DEMO_PROMPTS.filter((p) => !asked.has(p)).slice(0, 2) : [];

  // Follow the conversation while the user is at the bottom.
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const send = async (text: string) => {
    setDraft("");
    stick.current = true;
    try {
      if (!id) {
        // Post before navigating: the session's first snapshot then already holds the user message (it has no
        // SSE event), and the stream continues from that snapshot's seq.
        setCreating(true);
        const s = await api.createSession({ testbenchId: activeTb });
        await api.postMessage(s.id, { text });
        void qc.invalidateQueries({ queryKey: qk.sessions });
        navigate(`/sessions/${s.id}`);
        return;
      }
      qc.setQueryData<SessionDetail>(qk.session(id), (old) => (old ? appendUserMessage(old, `local-${Date.now()}`, text) : old));
      await api.postMessage(id, { text });
      void qc.invalidateQueries({ queryKey: qk.sessions });
    } catch (e) {
      toast.error((e as Error).message);
      if (id) void qc.invalidateQueries({ queryKey: qk.session(id) });
    } finally {
      setCreating(false);
    }
  };

  const retry = () => {
    const last = [...(detail?.items ?? [])].reverse().find((i) => i.kind === "user");
    if (last?.kind === "user") void send(last.text);
  };

  const ask = (prompt: string) => {
    setDraft(prompt);
    toast.info("Prompt ready in the composer");
  };

  if (id && isError) return <NotFoundPage />;

  return (
    <EvidenceOpenerProvider open={openEvidence}>
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel defaultSize="240px" minSize="200px" maxSize="320px">
          <SessionList activeId={id} onNew={() => navigate("/sessions")} creating={creating} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize="480px">
          <section aria-label="Conversation" className="flex h-full min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2.5 border-b px-6 py-3">
              <h1 className="min-w-0 truncate text-[15px] font-semibold">{id ? (detail?.session.title ?? " ") : "New session"}</h1>
              <span className="text-[12.5px] text-muted-foreground">
                {tb?.config.device.model ?? "RTR-AX3000"} · {detail?.session.testbenchId ?? activeTb}
              </span>
            </div>
            {stream === "reconnecting" && (
              <div role="status" className="flex items-center gap-2 border-b border-warn/40 bg-warn-soft px-6 py-2 text-[13px] text-warn">
                <WifiOff className="size-4" aria-hidden="true" />
                Connection to the event stream lost. Reconnecting…
              </div>
            )}
            <div
              ref={chatRef}
              className="min-h-0 flex-1 overflow-auto px-6 pt-5 pb-2"
              onScroll={(e) => {
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              <div className="mx-auto max-w-[760px]">
                {!id || (detail && detail.items.length === 0) ? (
                  <EmptySession onPick={(p) => void send(p)} disabled={creating} />
                ) : detail ? (
                  <Transcript detail={detail} firmware={tb?.config.device.firmware ?? []} onFocusMonitor={() => setTab("monitor")} onRetry={retry} />
                ) : (
                  <div className="grid gap-4">
                    <Skeleton className="ml-auto h-10 w-2/3" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                )}
              </div>
            </div>
            <Composer value={draft} onChange={setDraft} onSend={(t) => void send(t)} onStop={() => id && void api.stopTurn(id).catch((e: Error) => toast.error(e.message))} status={status} chips={chips} disabled={creating} />
          </section>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="400px" minSize="340px" maxSize="45%">
          <aside aria-label="Context panel" className="flex h-full flex-col bg-card">
            <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)} className="flex h-full min-h-0 flex-col gap-0">
              <TabsList variant="line" className="w-full shrink-0 justify-start gap-0.5 border-b px-2.5 pt-2">
                <TabsTrigger value="monitor" className="flex-none px-2.5">
                  Monitor
                  {runs.some((r) => r.status === "running") && <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-label="running" />}
                </TabsTrigger>
                <TabsTrigger value="report" className="flex-none px-2.5">
                  Report
                </TabsTrigger>
                <TabsTrigger value="evidence" className="flex-none px-2.5">
                  Evidence
                </TabsTrigger>
                <TabsTrigger value="context" className="flex-none px-2.5">
                  Context
                </TabsTrigger>
              </TabsList>
              <div className="min-h-0 flex-1 overflow-auto p-3.5">
                <TabsContent value="monitor">
                  <MonitorTab runs={runs} />
                </TabsContent>
                <TabsContent value="report">
                  <ReportTab reportId={latestReport} onAsk={ask} />
                </TabsContent>
                <TabsContent value="evidence">
                  {evidenceRef ? (
                    <EvidenceViewer evidenceRef={evidenceRef} />
                  ) : (
                    <EmptyState>Click an evidence chip in the conversation to inspect the packet, log line, metric, or document behind a claim.</EmptyState>
                  )}
                </TabsContent>
                <TabsContent value="context">
                  {detail ? (
                    <ContextTab detail={detail} />
                  ) : (
                    <EmptyState>Start a session to see what the agent can see: testbench instructions, skills, tools and model.</EmptyState>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </EvidenceOpenerProvider>
  );
}
