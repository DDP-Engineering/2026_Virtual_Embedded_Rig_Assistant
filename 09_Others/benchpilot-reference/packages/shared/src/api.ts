// HTTP API DTOs (01 "HTTP API", prefix /api). One section per route group.
import type {
  Category,
  CheckResult,
  Cluster,
  DeviceInfo,
  EpochSeconds,
  IsoDate,
  PlanDecision,
  PlanItem,
  ProviderId,
  Report,
  ReportAnalysis,
  Session,
  Skill,
  TestbenchConfig,
  TestbenchDoc,
  TestDefinition,
  TestRun,
  TicketDraft,
  Topology,
  ToolMeta,
  Verdict,
} from "./domain.ts";
import type { SessionState } from "./session.ts";

export const API_PREFIX = "/api";

/** GET /api/health */
export interface HealthResponse {
  ok: boolean;
  /** First line of `tshark -v`, or null when tshark is not reachable. */
  tshark: string | null;
}

/** GET /api/about (Settings → About; 08 Licensing). */
export interface AboutResponse {
  /** Root package.json version. */
  version: string;
  /** Short git sha the Windows bundle was built from; null when running from source. */
  gitSha: string | null;
  /** UTC build date (YYYY-MM-DD) of the Windows bundle; null when running from source. */
  buildDate: string | null;
  /** `bundle` = the Windows demo zip (08); `source` = `npm run dev` / `npm start`. */
  distribution: "bundle" | "source";
  /** Node.js version running the server, e.g. `v24.18.0`. */
  node: string;
  /** True when GET /api/about/notices serves THIRD-PARTY-NOTICES.txt (the Windows bundle). */
  notices: boolean;
}

/** Error body for every non-2xx JSON response. */
export interface ApiError {
  error: string;
}

// ---------------------------------------------------------------- testbenches

export interface TestbenchCounts {
  docs: number;
  tools: number;
  skills: number;
  tests: number;
}

/** GET /testbenches → TestbenchSummary[] */
export interface TestbenchSummary {
  id: string;
  name: string;
  description: string;
  device: DeviceInfo;
  counts: TestbenchCounts;
  lastReport: { id: string; verdict: "pass" | "fail"; fw: string; createdAt: IsoDate } | null;
}

/** GET /testbenches/:id */
export interface TestbenchDetail {
  config: TestbenchConfig;
  topology: Topology;
  createdAt: IsoDate;
}

/** POST /testbenches (from template, 03: new testbenches share TB-01's simulation pools). */
export interface CreateTestbenchRequest {
  name: string;
  description?: string;
  device: DeviceInfo;
  /** `tb-01` copies TB-01's documents; `empty` starts with TESTBENCH.md only. */
  template: "tb-01" | "empty";
  /** Extra documents uploaded in the wizard. */
  docs?: { path: string; content: string }[];
  enabled_tools: string[];
  enabled_skills: string[];
  enabled_tests: string[];
}

/** PUT /testbenches/:id — config toggles and basics. */
export type UpdateTestbenchRequest = Partial<
  Pick<TestbenchConfig, "name" | "description" | "device" | "enabled_tools" | "enabled_skills" | "enabled_tests">
>;

/** GET /testbenches/:id/docs → TestbenchDoc[] · POST → TestbenchDoc */
export interface CreateDocRequest {
  path: string;
  content: string;
}

/** PUT /testbenches/:id/docs/:docId → TestbenchDoc (re-indexes FTS). */
export interface UpdateDocRequest {
  content: string;
}

export type { TestbenchDoc };

/** One live pool of pre-generated datasets (02 "Live pools"). */
export interface SimulationPool {
  fw: string;
  testId: string;
  /** Dataset ids in consumption order. */
  datasets: string[];
  /** Index into `datasets` the next run takes (the last one repeats once the pool is exhausted). */
  next: number;
}

/** GET /testbenches/:id/simulation (P4b, read-only) — the Simulation tab's pool table. */
export interface TestbenchSimulation {
  /** Pools file named in the testbench config, e.g. `data/pools.json`. */
  poolsFile: string;
  pools: SimulationPool[];
}

// ---------------------------------------------------------------- catalog, skills, tools

/** GET /catalog/tests → CatalogTestSummary[] */
export interface CatalogTestSummary {
  id: string;
  name: string;
  version: number;
  area: string[];
  owner: string;
  duration: { sim_s: number; demo_s: number };
  /** Last 8 verdicts, oldest first. */
  lastVerdicts: Verdict[];
  /** Firmware of those runs when they share one, else null. */
  lastVerdictsFw: string | null;
}

export interface TestHistoryEntry {
  date: IsoDate;
  fw: string;
  testVersion: number;
  verdict: Verdict;
  /** Check id → measured value (display string). */
  measured: Record<string, string>;
  /** Numeric headline value for charts (e.g. p95 ms, lease s), if the test has one. */
  value?: number;
  testRunId: string;
  reportId: string;
}

/** GET /catalog/tests/:id */
export interface CatalogTestDetail extends TestDefinition {
  history: TestHistoryEntry[];
  /** Verdict flips in the last 8 runs (03 test-policy: flaky ≥ 2 with no firmware change). */
  flips: number;
}

/** GET /skills → SkillSummary[] · GET /skills/:name → Skill */
export type SkillSummary = Omit<Skill, "body">;
export type { Skill, ToolMeta };

// ---------------------------------------------------------------- sessions

export type SessionStatus = "idle" | "running" | "awaiting_approval";

/** GET /sessions → SessionSummary[] (newest first) */
export interface SessionSummary extends Session {
  updatedAt: IsoDate;
  lastReportId: string | null;
  status: SessionStatus;
}

/** POST /sessions */
export interface CreateSessionRequest {
  testbenchId: string;
}

/** GET /sessions/:id — the snapshot the client resumes the SSE stream from (01 "Reconnect"). */
export interface SessionDetail extends SessionState {
  session: SessionSummary;
  /**
   * P3 addition: SSE id of the last event folded into this snapshot. Open the stream with
   * `GET /sessions/:id/events?since=<seq>` (or ignore events with id ≤ seq) so no event is lost or applied twice.
   */
  seq?: number;
}

/** POST /sessions/:id/messages → 202 (409 when a turn is running). */
export interface PostMessageRequest {
  text: string;
}
export interface PostMessageResponse {
  turnId: string;
  messageId: string;
}

/** An edited plan item: the server reads only these two fields and re-enriches the rest from the catalog (P3). */
export type PlanDecisionItem = Pick<PlanItem, "testId" | "rationale">;

/** POST /plans/:id/decision. `items` = user-edited plan (01). An invalid edit → 400 with a readable `{error}`. */
export interface PlanDecisionRequest {
  decision: PlanDecision;
  items?: PlanDecisionItem[];
  /** P4a addition: firmware changed on the approval card. */
  fw?: string;
  /** P4a addition: reject comment. */
  comment?: string;
}

// ---------------------------------------------------------------- reports and runs

/** GET /reports → ReportListItem[] (newest first) */
export interface ReportListItem extends Report {
  verdict: "pass" | "fail";
  hasAnalysis: boolean;
}

/** GET /reports/:id */
export interface ReportDetail extends ReportListItem {
  runs: TestRun[];
  analysis: ReportAnalysis | null;
  tickets: TicketDraft[];
}

export type ExportFormat = "md" | "html" | "junit";

export interface MetricPoint {
  ts: EpochSeconds;
  value: number;
}

export interface MetricStats {
  min: number;
  max: number;
  avg: number;
  p95: number;
  slope_per_hour: number;
}

/** GET /runs/:id/metrics?name= */
export interface MetricSeries {
  testRunId: string;
  name: string;
  unit: string;
  startTs: EpochSeconds;
  endTs: EpochSeconds;
  points: MetricPoint[];
  stats: MetricStats;
  /** Notable events on the same run (OOM, link down), drawn as vertical markers. */
  markers: { ts: EpochSeconds; label: string; ev?: string }[];
}

// ---------------------------------------------------------------- evidence

export interface PacketRow {
  no: number;
  time: string;
  src: string;
  dst: string;
  proto: string;
  length: number;
  info: string;
}

/** One line of `tshark -V`, nested by indentation. */
export interface PacketTreeNode {
  label: string;
  highlight?: boolean;
  children?: PacketTreeNode[];
}

interface EvidenceBase {
  ref: string;
  title: string;
}

/** GET /evidence?ref= (05 §6). Malformed or unresolvable refs → 404 ApiError. */
export type EvidenceResponse =
  | (EvidenceBase & {
      kind: "pcap";
      testRunId: string;
      capture: string;
      frame: number;
      /** ±15 frames around the target. */
      rows: PacketRow[];
      detail: PacketTreeNode[];
      /** Display filter for Wireshark, e.g. `frame.number == 1532`. */
      filter: string;
      downloadUrl: string;
    })
  | (EvidenceBase & {
      kind: "log";
      testRunId: string;
      source: string;
      host: string;
      /** ±10 lines around the target. */
      lines: { no: number; text: string }[];
      target: number;
    })
  | (EvidenceBase & {
      kind: "metric";
      testRunId: string;
      series: MetricSeries;
      markerTs: EpochSeconds;
      /** Optional baseline series for comparison (e.g. same test on the previous firmware). */
      baseline?: { label: string; points: MetricPoint[] };
      note?: string;
    })
  | (EvidenceBase & { kind: "check"; testRunId: string; testId: string; check: CheckResult })
  | (EvidenceBase & {
      kind: "doc";
      testbenchId: string;
      path: string;
      heading: string | null;
      markdown: string;
      /** Passage to highlight inside `markdown`. */
      highlight?: string;
    });

export type EvidenceResponseKind = EvidenceResponse["kind"];

// ---------------------------------------------------------------- LLM settings and auth

export interface ProviderView {
  id: ProviderId;
  configured: boolean;
  /** Write-only key, returned masked: `••••1234`. */
  keyMasked: string | null;
  model: string | null;
  baseUrl: string | null;
}

/** GET /settings/llm — never contains a key. */
export interface LlmSettings {
  active: ProviderId | null;
  providers: Record<ProviderId, ProviderView>;
  models: Partial<Record<ProviderId, string[]>>;
  chatgpt: ChatgptAuthStatus;
}

/** PUT /settings/llm */
export interface UpdateLlmSettingsRequest {
  active?: ProviderId | null;
  provider?: { id: ProviderId; apiKey?: string; model?: string; baseUrl?: string };
}

/** POST /settings/llm/test — omitted fields fall back to the saved config. */
export interface TestConnectionRequest {
  provider: ProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}
export interface TestConnectionResponse {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

/** POST /auth/chatgpt/start */
export interface ChatgptAuthStart {
  url: string;
}
/** GET /auth/chatgpt/status */
export interface ChatgptAuthStatus {
  connected: boolean;
  account?: string;
  expiresAt?: IsoDate;
}

// ---------------------------------------------------------------- admin + eval (P5)

/** POST /admin/reset */
export interface ResetResponse {
  ok: true;
  /** History reports restored by the seed (8). */
  reports: number;
  /** The id the next live run will get (`RPT-0009`). */
  nextReport: string;
}

/**
 * Where a saved analysis came from. `replay_handwritten` = the scripted fixtures written by hand from 07, so the
 * accuracy is not a model measurement; `replay_recorded` = a promoted real-model take; `live` = a real provider.
 */
export type TriageSourceKind = "replay_handwritten" | "replay_recorded" | "live" | "unknown";

export interface TriageSource {
  reportId: string;
  sessionId: string | null;
  kind: TriageSourceKind;
  provider: string | null;
  model: string | null;
  /** For replay: the model the promoted take was recorded with, when known. */
  recordedWith?: string;
}

/** One failed test run of a report that has a saved analysis. */
export interface TriageRow {
  reportId: string;
  testRunId: string;
  testId: string;
  fw: string;
  /** Planted cause (non-security defects of the run's dataset). */
  expected: { category: Category | null; cluster: string | null; defects: string[] };
  /** The analysis cluster that covers this test (first non-security one), or null when none does. */
  predicted: { category: Category; clusterTitle: string; confidence: string } | null;
  categoryOk: boolean;
  /** Grouped with exactly the failures of the same report that share its planted cluster. */
  clusterOk: boolean;
  /** Why a miss is a miss (empty when both are right). */
  note: string;
}

/** A planted security finding on an analysed run, and whether a `security` cluster covered it. */
export interface TriageFindingRow {
  reportId: string;
  testId: string;
  defect: string;
  found: boolean;
  clusterTitle: string | null;
}

/** GET /eval/triage — saved analyses scored against planted ground truth (PoC only, agent-invisible). */
export interface TriageEvalResponse {
  analysedReports: number;
  failedRuns: number;
  categoryCorrect: number;
  clusterCorrect: number;
  /** null when there is nothing to score yet. */
  categoryAccuracy: number | null;
  clusterAccuracy: number | null;
  findings: TriageFindingRow[];
  /** Analysis clusters that cover no planted defect of their tests. */
  extraClusters: { reportId: string; title: string; category: Category }[];
  rows: TriageRow[];
  sources: TriageSource[];
  /** Set when any scored analysis is not a model measurement (hand-written fixtures). */
  caveat: string | null;
}

export type { Category, Cluster };
