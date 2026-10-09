// The web app's only data boundary: `httpApi` (HTTP + EventSource, P4b) or `mockApi` (src/mocks, `VITE_API=mock`),
// one method per route in 01 "HTTP API". Components never call fetch directly.
import type {
  AboutResponse,
  CatalogTestDetail,
  CatalogTestSummary,
  ChatgptAuthStart,
  ChatgptAuthStatus,
  CreateDocRequest,
  CreateSessionRequest,
  CreateTestbenchRequest,
  EvidenceResponse,
  ExportFormat,
  HealthResponse,
  LlmSettings,
  MetricSeries,
  PlanDecisionRequest,
  PostMessageRequest,
  PostMessageResponse,
  ReportDetail,
  ReportListItem,
  ResetResponse,
  SessionDetail,
  SessionEvent,
  SessionSummary,
  Skill,
  SkillSummary,
  TestbenchDetail,
  TestbenchDoc,
  TestbenchSimulation,
  TestbenchSummary,
  TestConnectionRequest,
  TestConnectionResponse,
  ToolMeta,
  TriageEvalResponse,
  UpdateDocRequest,
  UpdateLlmSettingsRequest,
  UpdateTestbenchRequest,
} from "@benchpilot/shared";

/** SSE connection state, for the reconnect banner (05 §4 states). */
export type StreamState = "open" | "reconnecting";

export interface SessionStreamHandlers {
  /** `seq` = the SSE event id (P3); the caller skips events at or below the seq its snapshot already holds. */
  onEvent(event: SessionEvent, seq: number): void;
  /** `reconnecting` → banner. The stream resumes after the last delivered seq by itself; no snapshot refetch. */
  onState(state: StreamState): void;
  /** The session no longer exists (its snapshot answers 404, e.g. after a demo reset): the stream has stopped for good. */
  onGone?(): void;
}

/** A downloadable export; `url` may be an object URL the caller must revoke. */
export interface Download {
  url: string;
  filename: string;
  revoke?: () => void;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BenchPilotApi {
  getHealth(): Promise<HealthResponse>;
  getAbout(): Promise<AboutResponse>;

  listTestbenches(): Promise<TestbenchSummary[]>;
  getTestbench(id: string): Promise<TestbenchDetail>;
  createTestbench(req: CreateTestbenchRequest): Promise<TestbenchDetail>;
  updateTestbench(id: string, req: UpdateTestbenchRequest): Promise<TestbenchDetail>;
  listDocs(testbenchId: string): Promise<TestbenchDoc[]>;
  createDoc(testbenchId: string, req: CreateDocRequest): Promise<TestbenchDoc>;
  updateDoc(testbenchId: string, docId: number, req: UpdateDocRequest): Promise<TestbenchDoc>;
  deleteDoc(testbenchId: string, docId: number): Promise<void>;
  getSimulation(testbenchId: string): Promise<TestbenchSimulation>;

  listCatalogTests(): Promise<CatalogTestSummary[]>;
  getCatalogTest(id: string): Promise<CatalogTestDetail>;
  listSkills(): Promise<SkillSummary[]>;
  getSkill(name: string): Promise<Skill>;
  listTools(): Promise<ToolMeta[]>;

  listSessions(): Promise<SessionSummary[]>;
  createSession(req: CreateSessionRequest): Promise<SessionSummary>;
  getSession(id: string): Promise<SessionDetail>;
  postMessage(sessionId: string, req: PostMessageRequest): Promise<PostMessageResponse>;
  stopTurn(sessionId: string): Promise<void>;
  decidePlan(planId: string, req: PlanDecisionRequest): Promise<void>;
  /**
   * Opens GET /sessions/:id/events?since=<since> — `since` is the snapshot's `seq`, so the stream carries exactly
   * the events after it. Reconnects resume after the last delivered event. Returns the unsubscribe function.
   */
  subscribeSessionEvents(sessionId: string, since: number, handlers: SessionStreamHandlers): () => void;

  listReports(): Promise<ReportListItem[]>;
  getReport(id: string): Promise<ReportDetail>;
  exportReport(id: string, format: ExportFormat): Promise<Download>;
  getRunMetrics(testRunId: string, name: string): Promise<MetricSeries>;
  getEvidence(ref: string): Promise<EvidenceResponse>;

  getLlmSettings(): Promise<LlmSettings>;
  updateLlmSettings(req: UpdateLlmSettingsRequest): Promise<LlmSettings>;
  testLlmConnection(req: TestConnectionRequest): Promise<TestConnectionResponse>;
  startChatgptAuth(): Promise<ChatgptAuthStart>;
  getChatgptAuthStatus(): Promise<ChatgptAuthStatus>;
  logoutChatgpt(): Promise<void>;

  /** P5 `POST /admin/reset`; the mock restores its seed state. */
  resetDemo(): Promise<ResetResponse>;
  /** P5 `GET /eval/triage`: saved analyses vs planted ground truth (demo admin, PoC only). */
  getTriageEval(): Promise<TriageEvalResponse>;
}
