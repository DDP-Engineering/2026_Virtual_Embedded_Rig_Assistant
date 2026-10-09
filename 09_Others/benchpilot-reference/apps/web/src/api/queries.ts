// TanStack Query bindings (05 "Implementation notes"). Keys are shared with useSessionEvents for cache writes.
import type { CreateTestbenchRequest, PlanDecisionRequest, SessionDetail, UpdateDocRequest, UpdateLlmSettingsRequest, UpdateTestbenchRequest } from "@benchpilot/shared";
import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "./index";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 404 is an answer, not a transient failure.
      retry: (count, err) => !(err instanceof ApiRequestError && err.status === 404) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const qk = {
  health: ["health"] as const,
  about: ["about"] as const,
  testbenches: ["testbenches"] as const,
  testbench: (id: string) => ["testbenches", id] as const,
  docs: (id: string) => ["testbenches", id, "docs"] as const,
  catalog: ["catalog"] as const,
  catalogTest: (id: string) => ["catalog", id] as const,
  skills: ["skills"] as const,
  skill: (name: string) => ["skills", name] as const,
  tools: ["tools"] as const,
  sessions: ["sessions"] as const,
  session: (id: string) => ["session", id] as const,
  reports: ["reports"] as const,
  report: (id: string) => ["reports", id] as const,
  metrics: (runId: string, name: string) => ["metrics", runId, name] as const,
  evidence: (ref: string) => ["evidence", ref] as const,
  simulation: (id: string) => ["simulation", id] as const,
  llm: ["settings", "llm"] as const,
  chatgpt: ["auth", "chatgpt"] as const,
  triage: ["eval", "triage"] as const,
};

export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: () => api.getHealth(), retry: 0 });
export const useAbout = () => useQuery({ queryKey: qk.about, queryFn: () => api.getAbout(), staleTime: Infinity });
export const useTestbenches = () => useQuery({ queryKey: qk.testbenches, queryFn: () => api.listTestbenches() });
export const useTestbench = (id: string) => useQuery({ queryKey: qk.testbench(id), queryFn: () => api.getTestbench(id) });
export const useDocs = (id: string) => useQuery({ queryKey: qk.docs(id), queryFn: () => api.listDocs(id) });
export const useCatalog = () => useQuery({ queryKey: qk.catalog, queryFn: () => api.listCatalogTests() });
export const useCatalogTest = (id: string | null) =>
  useQuery({ queryKey: qk.catalogTest(id ?? ""), queryFn: () => api.getCatalogTest(id!), enabled: !!id });
export const useSkills = () => useQuery({ queryKey: qk.skills, queryFn: () => api.listSkills() });
export const useSkill = (name: string | null) => useQuery({ queryKey: qk.skill(name ?? ""), queryFn: () => api.getSkill(name!), enabled: !!name });
export const useTools = () => useQuery({ queryKey: qk.tools, queryFn: () => api.listTools() });
/** Always fresh: analyses change as the demo runs, and the page is opened rarely. */
export const useTriageEval = () => useQuery({ queryKey: qk.triage, queryFn: () => api.getTriageEval(), staleTime: 0, refetchOnMount: "always" });
export const useSessions = () => useQuery({ queryKey: qk.sessions, queryFn: () => api.listSessions() });
export const useSession = (id: string | undefined) =>
  useQuery({ queryKey: qk.session(id ?? ""), queryFn: () => api.getSession(id!), enabled: !!id, staleTime: Infinity, structuralSharing: keepNewerSession });
/**
 * `structuralSharing` for the session query: a refetched snapshot never replaces a cache the stream has already
 * advanced past (same session, higher seq) — otherwise events applied in between would be lost.
 */
function keepNewerSession(old: unknown, next: unknown): unknown {
  const o = old as SessionDetail | undefined;
  const n = next as SessionDetail;
  if (o?.seq !== undefined && n?.seq !== undefined && o.session.createdAt === n.session.createdAt && o.seq > n.seq) return o;
  return n;
}

export const useReports = () => useQuery({ queryKey: qk.reports, queryFn: () => api.listReports() });
export const useReport = (id: string | null | undefined) =>
  useQuery({ queryKey: qk.report(id ?? ""), queryFn: () => api.getReport(id!), enabled: !!id, placeholderData: keepPreviousData });
export const useRunMetrics = (runId: string, name: string, enabled = true) =>
  useQuery({ queryKey: qk.metrics(runId, name), queryFn: () => api.getRunMetrics(runId, name), enabled, staleTime: Infinity });
export const useEvidence = (ref: string | null) =>
  useQuery({ queryKey: qk.evidence(ref ?? ""), queryFn: () => api.getEvidence(ref!), enabled: !!ref, staleTime: Infinity, retry: 0 });
export const useSimulation = (testbenchId: string) => useQuery({ queryKey: qk.simulation(testbenchId), queryFn: () => api.getSimulation(testbenchId) });
export const useLlmSettings = () => useQuery({ queryKey: qk.llm, queryFn: () => api.getLlmSettings() });

export function useUpdateTestbench(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateTestbenchRequest) => api.updateTestbench(id, req),
    onSuccess: (data) => {
      qc.setQueryData(qk.testbench(id), data);
      void qc.invalidateQueries({ queryKey: qk.testbenches, exact: true });
    },
  });
}

export function useCreateTestbench() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateTestbenchRequest) => api.createTestbench(req),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.testbenches }),
  });
}

export function useSaveDoc(testbenchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, ...req }: UpdateDocRequest & { docId: number }) => api.updateDoc(testbenchId, docId, req),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.docs(testbenchId) }),
  });
}

export function useCreateDoc(testbenchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { path: string; content: string }) => api.createDoc(testbenchId, req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.docs(testbenchId) });
      void qc.invalidateQueries({ queryKey: qk.testbenches, exact: true });
    },
  });
}

export function useDecidePlan() {
  return useMutation({ mutationFn: ({ planId, ...req }: PlanDecisionRequest & { planId: string }) => api.decidePlan(planId, req) });
}

export function useUpdateLlmSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateLlmSettingsRequest) => api.updateLlmSettings(req),
    onSuccess: (data) => qc.setQueryData(qk.llm, data),
  });
}
