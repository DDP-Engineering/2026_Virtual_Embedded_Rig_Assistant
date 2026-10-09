// Domain entities shared by server and web (01 data model, 03 content formats, 04 tools).
// IDs: testbench `TB-01`, session `S-0001`, plan `PLAN-0001`, report `RPT-0001`, test run `RUN-0001`, dataset `DS-0001`.

export type Verdict = "pass" | "fail" | "error";

/** Triage categories (03 rubric). `security` is a finding, not a failure class, but uses the same badge. */
export type Category = "product_bug" | "environment" | "test_issue" | "security";
export type Confidence = "high" | "medium" | "low";

/** ISO-8601 UTC string, e.g. `2026-10-08T09:18:00Z`. */
export type IsoDate = string;
/** Data-clock time in epoch seconds (01: test_runs timestamps are data clock, not wall clock). */
export type EpochSeconds = number;

// ---------------------------------------------------------------- testbench

export type TopologyNodeType = "dut" | "client" | "server" | "switch" | "probe" | "cloud";

export interface TopologyNode {
  id: string;
  type: TopologyNodeType;
  label: string;
  addr?: string;
  notes?: string;
  /** Diagram position from topology.yaml (UI extension; optional in the file). */
  position?: { x: number; y: number };
}

export interface TopologyLink {
  a: string;
  b: string;
  port?: string;
  vlan?: number;
  /** `wifi` and `mirror` links are drawn dashed. */
  kind?: "wired" | "wifi" | "mirror" | "uplink";
}

export interface CapturePoint {
  name: string;
  source: string;
  vlan?: number;
}

export interface Topology {
  nodes: TopologyNode[];
  links: TopologyLink[];
  capture_points: CapturePoint[];
}

export interface DeviceInfo {
  model: string;
  firmware: string[];
}

/** `testbench.yaml` (03 §1) as stored in `testbenches.config_json`. */
export interface TestbenchConfig {
  id: string;
  name: string;
  description: string;
  device: DeviceInfo;
  enabled_tools: string[];
  enabled_skills: string[];
  enabled_tests: string[];
  simulation: { pools: string };
}

export interface TestbenchDoc {
  id: number;
  testbenchId: string;
  /** Path relative to the testbench folder, e.g. `docs/lab-notes.md`. */
  path: string;
  title: string;
  content: string;
  /** `TESTBENCH.md` only: always in the system prompt. */
  pinned: boolean;
}

// ---------------------------------------------------------------- catalog

export type EventMatcher = { source: string; regex: string } | { source: string; display_filter: string };
export type CompareOp = "==" | "!=" | ">" | ">=" | "<" | "<=";

/** The six check types (03 §2). */
export type CheckDefinition =
  | { id: string; title: string; type: "interval_between_events"; start: EventMatcher; end: EventMatcher; max_s?: number; min_s?: number }
  | { id: string; title: string; type: "packet_count"; source: string; display_filter: string; min?: number; max?: number }
  | { id: string; title: string; type: "packet_field_all"; source: string; display_filter: string; field: string; op: CompareOp; value: number | string }
  | { id: string; title: string; type: "metric_threshold"; metric: string; agg: "avg" | "min" | "max" | "p95" | "last"; op: CompareOp; value: number; unit: string }
  | { id: string; title: string; type: "metric_trend"; metric: string; max_decline_per_hour: number }
  | { id: string; title: string; type: "log_absent"; source: string; regex: string };

export type CheckType = CheckDefinition["type"];

/** `catalog/tests/*.yaml` (03 §2). */
export interface TestDefinition {
  id: string;
  name: string;
  version: number;
  area: string[];
  owner: string;
  description: string;
  procedure: string;
  inputs: string[];
  duration: { sim_s: number; demo_s: number };
  checks: CheckDefinition[];
}

/** Evaluated check (03: `{id, title, pass, measured, expected, evidence}`). */
export interface CheckResult {
  id: string;
  title: string;
  pass: boolean;
  /** Human-readable measured value, e.g. `845.0 Mbps`. */
  measured: string;
  /** Human-readable expectation, e.g. `≥ 900 Mbps`. */
  expected: string;
  /** Evidence refs (`ev:…`) that decided the check. */
  evidence: string[];
}

// ---------------------------------------------------------------- skills and tools

export interface Skill {
  name: string;
  description: string;
  /** Markdown body of SKILL.md (loaded by `load_skill`). */
  body: string;
}

export type ToolGroup =
  | "skills"
  | "knowledge"
  | "catalog"
  | "execution"
  | "history"
  | "logs"
  | "packets"
  | "metrics"
  | "correlation"
  | "compare"
  | "reporting";

export interface ToolMeta {
  name: string;
  group: ToolGroup;
  description: string;
  requiresApproval: boolean;
}

// ---------------------------------------------------------------- plans, runs, reports

export type PlanStatus = "pending" | "approved" | "rejected" | "running" | "done";
export type PlanDecision = "approve" | "reject";

export interface PlanItem {
  testId: string;
  rationale: string;
  /** Enriched from the catalog by the server, so the approval card needs no extra fetch. */
  name: string;
  version: number;
  duration: { sim_s: number; demo_s: number };
}

export interface Plan {
  id: string;
  sessionId: string;
  testbenchId: string;
  title: string;
  device: string;
  fw: string;
  items: PlanItem[];
  rationale: string;
  status: PlanStatus;
  decidedAt?: IsoDate;
  comment?: string;
}

export type ReportKind = "live" | "history";

export interface TestRun {
  id: string;
  reportId: string;
  datasetId: string;
  testId: string;
  testName: string;
  testVersion: number;
  device: string;
  fw: string;
  testbenchId: string;
  verdict: Verdict;
  checks: CheckResult[];
  startedAt: EpochSeconds;
  endedAt: EpochSeconds;
  /** Downloadable raw artifacts (pcapng, syslog, iperf3 JSON). */
  artifacts: { name: string; type: string; path: string }[];
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  /** Sum of simulated test durations. */
  simDurationS: number;
}

export interface Cluster {
  title: string;
  category: Category;
  confidence: Confidence;
  tests: string[];
  rootCause: string;
  evidence: string[];
  recommendation: string;
}

export interface ReportAnalysis {
  summaryMd: string;
  clusters: Cluster[];
  /** Skill that produced it, shown as "AI analysis · failure-analyzer". */
  skill?: string;
  savedAt: IsoDate;
}

export type TicketSeverity = "critical" | "major" | "minor";

export interface TicketDraft {
  id: string;
  reportId: string;
  clusterTitle: string;
  title: string;
  bodyMd: string;
  component: string;
  severity: TicketSeverity;
  createdAt: IsoDate;
}

export interface Report {
  id: string;
  planId: string | null;
  testbenchId: string;
  device: string;
  fw: string;
  kind: ReportKind;
  createdAt: IsoDate;
  summary: ReportSummary;
}

// ---------------------------------------------------------------- sessions and LLM

export type ProviderId = "anthropic" | "openai" | "custom" | "chatgpt" | "replay";

export interface Session {
  id: string;
  testbenchId: string;
  title: string;
  provider: ProviderId | null;
  model: string | null;
  createdAt: IsoDate;
}
