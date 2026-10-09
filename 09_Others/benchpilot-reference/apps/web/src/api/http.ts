// BenchPilotApi over the real server: fetch for REST (01 "HTTP API", prefix /api), EventSource for the session
// stream. Vite proxies /api in dev; the server serves the built app in prod, so every URL is same-origin.
// No credentials ever pass through here except the write-only `apiKey` of PUT /settings/llm (never logged).
import { API_PREFIX, type ExportFormat, type SessionEvent } from "@benchpilot/shared";
import { ApiRequestError, type BenchPilotApi, type Download, type SessionStreamHandlers, type StreamState } from "./client";

const enc = encodeURIComponent;

/** Parses `{error}` bodies into ApiRequestError; a missing server (proxy 5xx without JSON, network error) gets one plain message. */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, "The BenchPilot server is not reachable.");
  }
  const isJson = res.headers.get("Content-Type")?.includes("application/json") ?? false;
  if (!res.ok) {
    const err = isJson ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
    throw new ApiRequestError(res.status, err?.error ?? (res.status >= 500 ? "The BenchPilot server is not reachable." : `${res.status} ${res.statusText}`));
  }
  if (res.status === 204 || !isJson) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const put = <T>(path: string, body: unknown) => request<T>("PUT", path, body);

/** `attachment; filename="RPT-0009.md"` → `RPT-0009.md`. */
function filenameOf(res: Response, fallback: string): string {
  return /filename="?([^";]+)"?/i.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallback;
}

/** Backoff for re-opening a stream the browser gave up on (proxy 5xx while the server restarts). */
const REOPEN_MS = [1000, 2000, 3000, 5000];
/**
 * Liveness (P5): the server sends a named `ping` every 15 s. A socket that died without a FIN (laptop sleep, Wi-Fi
 * drop) never fires `onerror`, so a stream silent for three pings is closed and reopened with `?since=`.
 */
const SILENCE_MS = 45_000;
const WATCHDOG_TICK_MS = 5_000;

/**
 * One EventSource per subscription. Events are data-only (`onmessage`); `id` = seq.
 * - While the connection drops and the browser retries by itself, it resends `Last-Event-ID` and the server
 *   resumes after it (the header wins over `?since=`).
 * - When the browser gives up (readyState CLOSED: the dev proxy answered 5xx because the server was down), a new
 *   EventSource is opened with `?since=<last delivered seq>`.
 * - When nothing (event or `ping`) arrived for SILENCE_MS, the stream is presumed half-open and reopened the same way.
 * - Before such a reopen, a 404 snapshot (the session was deleted by a reset) ends the subscription: `onGone`.
 * Ids at or below the last delivered one are dropped, so a resumed stream never applies an event twice.
 */
function subscribe(sessionId: string, since: number, handlers: SessionStreamHandlers): () => void {
  let last = since;
  let es: EventSource | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: StreamState | null = null;
  let heardAt = Date.now();
  const setState = (next: StreamState) => {
    if (next === state) return;
    state = next;
    handlers.onState(next);
  };

  const open = () => {
    if (closed) return;
    const source = new EventSource(`${API_PREFIX}/sessions/${enc(sessionId)}/events?since=${last}`);
    es = source;
    heardAt = Date.now();
    source.onopen = () => {
      attempt = 0;
      heardAt = Date.now();
      setState("open");
    };
    source.addEventListener("ping", () => {
      heardAt = Date.now();
    });
    source.onmessage = (m: MessageEvent<string>) => {
      heardAt = Date.now();
      const seq = Number(m.lastEventId);
      if (!Number.isFinite(seq) || seq <= last) return;
      let event: SessionEvent;
      try {
        event = JSON.parse(m.data) as SessionEvent;
      } catch {
        return;
      }
      last = seq;
      handlers.onEvent(event, seq);
    };
    source.onerror = () => {
      if (closed) return;
      setState("reconnecting");
      if (source.readyState !== EventSource.CLOSED) return; // the browser retries itself, with Last-Event-ID
      source.close();
      timer = setTimeout(() => void reopen(), REOPEN_MS[Math.min(attempt++, REOPEN_MS.length - 1)]);
    };
  };

  const stop = () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(watchdog);
    es?.close();
  };

  /**
   * The browser gave up on the stream. If the session itself is gone (a demo reset deleted it, P5 open issue 4),
   * the snapshot answers 404 and every reopen would too: stop for good instead of backing off forever.
   */
  const reopen = async () => {
    if (closed) return;
    const gone = await fetch(`${API_PREFIX}/sessions/${enc(sessionId)}`).then(
      (r) => r.status === 404,
      () => false, // server unreachable: keep trying
    );
    if (closed) return;
    if (!gone) return open();
    stop();
    handlers.onGone?.();
  };

  open();
  const watchdog = setInterval(() => {
    if (closed || !es || es.readyState === EventSource.CLOSED || Date.now() - heardAt < SILENCE_MS) return;
    // Half-open: the browser still thinks it is connected. Drop it and resume after the last delivered id.
    es.close();
    setState("reconnecting");
    clearTimeout(timer);
    open();
  }, WATCHDOG_TICK_MS);
  return stop;
}

export const httpApi: BenchPilotApi = {
  getHealth: () => get("/health"),
  getAbout: () => get("/about"),

  listTestbenches: () => get("/testbenches"),
  getTestbench: (id) => get(`/testbenches/${enc(id)}`),
  createTestbench: (req) => post("/testbenches", req),
  updateTestbench: (id, req) => put(`/testbenches/${enc(id)}`, req),
  listDocs: (testbenchId) => get(`/testbenches/${enc(testbenchId)}/docs`),
  createDoc: (testbenchId, req) => post(`/testbenches/${enc(testbenchId)}/docs`, req),
  updateDoc: (testbenchId, docId, req) => put(`/testbenches/${enc(testbenchId)}/docs/${docId}`, req),
  deleteDoc: (testbenchId, docId) => request("DELETE", `/testbenches/${enc(testbenchId)}/docs/${docId}`),
  getSimulation: (testbenchId) => get(`/testbenches/${enc(testbenchId)}/simulation`),

  listCatalogTests: () => get("/catalog/tests"),
  getCatalogTest: (id) => get(`/catalog/tests/${enc(id)}`),
  listSkills: () => get("/skills"),
  getSkill: (name) => get(`/skills/${enc(name)}`),
  listTools: () => get("/tools"),

  listSessions: () => get("/sessions"),
  createSession: (req) => post("/sessions", req),
  getSession: (id) => get(`/sessions/${enc(id)}`),
  postMessage: (sessionId, req) => post(`/sessions/${enc(sessionId)}/messages`, req),
  stopTurn: (sessionId) => post(`/sessions/${enc(sessionId)}/stop`),
  decidePlan: (planId, req) => post(`/plans/${enc(planId)}/decision`, req),
  subscribeSessionEvents: subscribe,

  listReports: () => get("/reports"),
  getReport: (id) => get(`/reports/${enc(id)}`),
  async exportReport(id: string, format: ExportFormat): Promise<Download> {
    // Fetched (not a bare link) so a failure shows as a toast instead of a broken download.
    const res = await fetch(`${API_PREFIX}/reports/${enc(id)}/export?format=${format}`).catch(() => null);
    if (!res?.ok) {
      const err = (await res?.json().catch(() => null)) as { error?: string } | null;
      throw new ApiRequestError(res?.status ?? 0, err?.error ?? "The BenchPilot server is not reachable.");
    }
    const url = URL.createObjectURL(await res.blob());
    return { url, filename: filenameOf(res, `${id}.${format === "junit" ? "junit.xml" : format}`), revoke: () => URL.revokeObjectURL(url) };
  },
  getRunMetrics: (testRunId, name) => get(`/runs/${enc(testRunId)}/metrics?name=${enc(name)}`),
  getEvidence: (ref) => get(`/evidence?ref=${enc(ref)}`),

  getLlmSettings: () => get("/settings/llm"),
  updateLlmSettings: (req) => put("/settings/llm", req),
  testLlmConnection: (req) => post("/settings/llm/test", req),
  startChatgptAuth: () => post("/auth/chatgpt/start"),
  getChatgptAuthStatus: () => get("/auth/chatgpt/status"),
  logoutChatgpt: () => post("/auth/chatgpt/logout"),

  resetDemo: () => post("/admin/reset"),
  getTriageEval: () => get("/eval/triage"),
};
