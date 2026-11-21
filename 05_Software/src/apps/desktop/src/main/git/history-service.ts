// REQ-SEC-5ac0eca4
import {
  type GitHistoryEligibility,
  type GitHistoryResult,
  type Request,
  type Response,
  veraError,
} from "@vera/shared";

type HistoryRequest = Request<"git.history">;
type Scope = Pick<HistoryRequest, "workbenchId" | "indexLease"> & { folder: string; enabled: boolean };
type Pending = { scope: Scope; controller: AbortController };
type Load<T> = (folder: string, path: string, signal: AbortSignal) => Promise<T>;
const matches = (scope: Scope, current: Scope | undefined) =>
  current?.workbenchId === scope.workbenchId &&
  current.indexLease === scope.indexLease &&
  current.folder === scope.folder;

/** Owns transient Files history and eligibility reads for the active workbench. */
export class GitHistoryService {
  private readonly pending = new Set<Pending>();

  constructor(
    private readonly options: {
      scope: () => Scope | undefined;
      resolve: (workbenchId: string, identity: string) => string;
      eligible: Load<GitHistoryEligibility>;
      read: Load<GitHistoryResult>;
      project: (
        workbenchId: string,
        path: string,
        result: GitHistoryResult,
      ) => Pick<Response<"git.history">, "displayPath" | "result">;
    },
  ) {}

  async eligibility(request: HistoryRequest): Promise<Response<"git.historyEligibility">> {
    return this.admit(request, "unavailable", this.options.eligible, (_path, eligibility) => ({
      ...request,
      eligibility,
    }));
  }

  async history(request: HistoryRequest): Promise<Response<"git.history">> {
    return this.admit(request, { state: "unavailable" }, this.options.read, (path, value) => ({
      ...request,
      ...this.options.project(request.workbenchId, path, value),
    }));
  }

  private async admit<T, R>(
    request: HistoryRequest,
    unavailable: T,
    load: Load<T>,
    project: (path: string, value: T) => R,
  ) {
    const scope = this.options.scope();
    if (scope?.workbenchId !== request.workbenchId || scope.indexLease !== request.indexLease)
      throw veraError("CONFLICT");
    if (!scope.enabled) throw veraError("DENIED");
    if (this.pending.size >= 4) throw veraError("BUSY");
    const path = this.options.resolve(request.workbenchId, request.path);
    const controller = new AbortController();
    const pending = { scope, controller };
    this.pending.add(pending);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
    let value = unavailable;
    try {
      const loaded = await load(scope.folder, path, signal);
      if (!signal.aborted) value = loaded;
    } catch {
      // Git errors may include original paths and diagnostics.
    } finally {
      this.pending.delete(pending);
    }
    const current = this.options.scope();
    if (controller.signal.aborted || !matches(scope, current)) throw veraError("CONFLICT");
    if (!current?.enabled) throw veraError("DENIED");
    return project(path, value);
  }

  reconcile() {
    const active = this.options.scope();
    for (const read of this.pending)
      if (!active?.enabled || !matches(read.scope, active)) read.controller.abort();
  }

  stop() {
    for (const { controller } of this.pending) controller.abort();
  }
}
