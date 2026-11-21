// REQ-SEC-0634fcfa
import {
  type GitComparison,
  type GitDiffResponse,
  type GitDiffResult,
  type Request,
  veraError,
} from "@vera/shared";

type Scope = Pick<Request<"git.diff">, "workbenchId" | "indexLease"> & { folder: string; enabled: boolean };
type Pending = { scope: Scope; controller: AbortController };

const sameActivation = (first: Scope, second: Scope | undefined) =>
  second?.workbenchId === first.workbenchId &&
  second.indexLease === first.indexLease &&
  second.folder === first.folder;

/** Resolves Display identities and owns bounded diff reads for the current workbench activation. */
export class GitDiffService {
  private readonly pending = new Set<Pending>();

  constructor(
    private readonly options: {
      scope: () => Scope | undefined;
      resolve: (id: string, path: string) => string;
      read: (
        folder: string,
        path: string,
        comparison: GitComparison,
        signal: AbortSignal,
      ) => Promise<GitDiffResult>;
      project: (
        id: string,
        path: string,
        result: GitDiffResult,
      ) => Pick<GitDiffResponse, "displayPath" | "result">;
    },
  ) {}

  async request(request: Request<"git.diff">): Promise<GitDiffResponse> {
    this.reconcile();
    const { workbenchId, indexLease, comparison } = request;
    const scope = this.options.scope();
    if (scope?.workbenchId !== workbenchId || scope.indexLease !== indexLease) throw veraError("CONFLICT");
    if (!scope.enabled) throw veraError("DENIED");
    if (this.pending.size >= 4) throw veraError("BUSY");
    const path = this.options.resolve(workbenchId, request.path);
    const controller = new AbortController();
    const pending = { scope, controller };
    this.pending.add(pending);
    let result: GitDiffResult = { state: "unavailable", base: comparison === "staged" ? "unknown" : "index" };
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
      const value = await this.options.read(scope.folder, path, comparison, signal);
      if (!signal.aborted) result = value;
    } catch {
      // Diagnostics may contain host paths. Only the bounded result state crosses IPC.
    } finally {
      this.pending.delete(pending);
    }
    const current = this.options.scope();
    if (controller.signal.aborted || !sameActivation(scope, current)) throw veraError("CONFLICT");
    if (!current?.enabled) throw veraError("DENIED");
    return { ...request, ...this.options.project(workbenchId, path, result) };
  }

  reconcile() {
    const active = this.options.scope();
    for (const read of this.pending)
      if (!active?.enabled || !sameActivation(read.scope, active)) read.controller.abort();
  }

  stop() {
    for (const { controller } of this.pending) controller.abort();
  }
}
