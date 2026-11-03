import { createHash } from "node:crypto";
import {
  confirmationMatches,
  type PermissionMode,
  type ProgramPolicy,
  programPolicy,
  type SessionEvent,
  veraError,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { ulid } from "ulid";
import { programApproval } from "../plugins/program-request.js";
import type { ChangeRequest } from "../tools/changes.js";

/** Exact request serialization: object keys sorted recursively, array order preserved. */
export function requestJson(value: unknown): string {
  const ordered = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(ordered);
    if (input !== null && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, v]) => [key, ordered(v)]),
      );
    return input;
  };
  return JSON.stringify(ordered(value));
}
export function requestSha256(request: ChangeRequest): string {
  return createHash("sha256").update(requestJson(request), "utf8").digest("hex");
}
type Decision = "approved" | "denied" | "aborted";
export interface ApprovalDecision {
  sessionId: string;
  approvalId: string;
  requestSha256: string;
  decision: "approved" | "denied";
  switchToAutoEdit?: boolean | undefined;
  /** The typed confirmation of an irreversible program command. */
  confirmation?: string | undefined;
}
/** The program policy of a run_program request in `mode`; undefined for file and download requests. */
function policyOf(request: ChangeRequest, mode: PermissionMode): ProgramPolicy | undefined {
  return request.tool === "run_program" ? programPolicy(mode, request.risk, request.trial) : undefined;
}
/** Whether the current mode approves the request without asking the user. */
function byMode(request: ChangeRequest, mode: PermissionMode): boolean {
  if (request.tool === "plugin_install") return false;
  return request.tool === "run_program"
    ? policyOf(request, mode) === "mode"
    : mode === "bypass" || (mode === "auto-edit" && !request.protected);
}
interface Pending {
  request: ChangeRequest;
  digest: string;
  signal: AbortSignal;
  resolve(value: Decision): void;
  reject(error: unknown): void;
  cleanup(): void;
}
export interface ApprovalHost {
  db: Database.Database;
  now(): string;
  active(sessionId: string, turnId: string): boolean;
  mode(sessionId: string): PermissionMode;
  assertWritable(): void;
  /** Called inside the gate's transaction. Returns publication after commit. */
  record(sessionId: string, event: SessionEvent): () => void;
}
export class ApprovalGate {
  private readonly pending = new Map<string, Pending>();
  constructor(private readonly host: ApprovalHost) {}
  async request(request: ChangeRequest, signal: AbortSignal): Promise<Decision> {
    signal.throwIfAborted();
    this.host.assertWritable();
    if (!this.host.active(request.sessionId, request.turnId)) throw veraError("CONFLICT");
    const mode = this.host.mode(request.sessionId);
    const policy = policyOf(request, mode);
    // Safe program commands run without a record; refused ones never reach the user.
    if (policy === "run") return "approved";
    if (policy === "refuse") return "aborted";
    if (
      request.tool !== "run_program" &&
      (mode === "read-only" || (request.scope === "filesystem" && mode !== "bypass"))
    )
      return "aborted";
    const id = `apv_${ulid()}`,
      digest = requestSha256(request);
    let resolve!: (decision: Decision) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<Decision>((done, failed) => {
      resolve = done;
      reject = failed;
    });
    // AbortSignal dispatch must never throw outside the runtime's promise boundary.
    const abort = () => this.cancel(id, "user", false);
    const entry: Pending = {
      request,
      digest,
      signal,
      resolve,
      reject,
      cleanup: () => signal.removeEventListener("abort", abort),
    };
    // Register before observers see the request: a synchronous decision is valid.
    this.pending.set(id, entry);
    try {
      const publish = this.host.db.transaction(() => {
        this.host.db
          .prepare(
            "INSERT INTO approvals(id,session_id,turn_id,tool_call_id,request_sha256,request_json) VALUES (?,?,?,?,?,?)",
          )
          .run(id, request.sessionId, request.turnId, request.callId, digest, requestJson(request));
        return this.host.record(request.sessionId, {
          type: "approval.requested",
          approvalId: id,
          callId: request.callId,
          requestSha256: digest,
          tool: request.tool,
          ...(request.tool === "run_program"
            ? { path: request.program, diff: "", bytes: 0, program: programApproval(request) }
            : {
                path: request.path,
                diff: request.diff,
                bytes: request.bytes,
                ...(request.tool === "web_download" ? { download: request.download } : {}),
              }),
        });
      })();
      signal.addEventListener("abort", abort, { once: true });
      publish();
      if (signal.aborted) abort();
      else if (byMode(request, mode) && this.pending.has(id)) this.finish(id, "approved", "mode");
      return await result;
    } catch (error) {
      entry.cleanup();
      this.pending.delete(id);
      throw error;
    }
  }
  decide(input: ApprovalDecision): void {
    const entry = this.pending.get(input.approvalId);
    this.host.assertWritable();
    if (
      !entry ||
      entry.signal.aborted ||
      entry.request.sessionId !== input.sessionId ||
      entry.digest !== input.requestSha256 ||
      !this.host.active(input.sessionId, entry.request.turnId)
    )
      throw veraError("CONFLICT");
    if (input.decision !== "approved" && input.decision !== "denied") throw veraError("INVALID");
    if (input.switchToAutoEdit && (input.decision !== "approved" || entry.request.tool === "plugin_install"))
      throw veraError("INVALID");
    const mode = this.host.mode(input.sessionId);
    if (mode === "read-only") throw veraError("CONFLICT");
    // Core compares the typed word; a refusal leaves the approval pending for another try.
    if (
      input.decision === "approved" &&
      entry.request.tool === "run_program" &&
      policyOf(entry.request, mode) === "confirm"
    ) {
      if (input.switchToAutoEdit) throw veraError("INVALID");
      if (!confirmationMatches(entry.request.confirm, input.confirmation))
        throw { ...veraError("INVALID"), messageKey: "approval.confirmMismatch" };
    }
    this.finish(input.approvalId, input.decision, "user", input.switchToAutoEdit);
  }
  private finish(id: string, decision: Decision, by: "user" | "mode", switchMode = false): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.host.assertWritable();
    const publications = this.host.db.transaction(() => {
      const changed = this.host.db
        .prepare("UPDATE approvals SET decision=?,decided_by=?,decided_at=? WHERE id=? AND decision IS NULL")
        .run(decision, by, this.host.now(), id).changes;
      if (changed !== 1) throw veraError("CONFLICT");
      const publish = [
        this.host.record(entry.request.sessionId, { type: "approval.decided", approvalId: id, decision, by }),
      ];
      if (switchMode)
        publish.push(
          this.host.record(entry.request.sessionId, { type: "session.updated", mode: "auto-edit" }),
        );
      return publish;
    })();
    this.pending.delete(id);
    entry.cleanup();
    for (const publish of publications) publish();
    entry.resolve(decision);
  }
  abort(sessionId: string, by: "user" | "mode"): void {
    for (const [id, entry] of this.pending)
      if (entry.request.sessionId === sessionId) this.cancel(id, by, true);
  }
  approveBypass(sessionId: string): void {
    if (this.host.mode(sessionId) !== "bypass") return;
    for (const [id, entry] of this.pending)
      if (
        this.host.mode(sessionId) === "bypass" &&
        entry.request.sessionId === sessionId &&
        !entry.signal.aborted &&
        byMode(entry.request, "bypass")
      )
        this.finish(id, "approved", "mode");
  }
  private cancel(id: string, by: "user" | "mode", propagate: boolean): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    try {
      this.finish(id, "aborted", by);
    } catch (error) {
      // Release the waiter without unauthorized SQL/event writes. Writable startup
      // recovery repairs the durable undecided row after authority is restored.
      this.pending.delete(id);
      entry.cleanup();
      entry.reject(error);
      if (propagate) throw error;
    }
  }
  consume(request: ChangeRequest): void {
    this.assertGranted(request);
    if (policyOf(request, this.host.mode(request.sessionId)) === "run") return;
    const changed = this.host.db
      .prepare(
        "UPDATE approvals SET consumed_at=? WHERE session_id=? AND turn_id=? AND tool_call_id=? AND request_sha256=? AND decision='approved' AND consumed_at IS NULL",
      )
      .run(
        this.host.now(),
        request.sessionId,
        request.turnId,
        request.callId,
        requestSha256(request),
      ).changes;
    if (changed !== 1) throw veraError("CONFLICT");
  }
  assertGranted(request: ChangeRequest): void {
    this.host.assertWritable();
    const mode = this.host.mode(request.sessionId);
    const policy = policyOf(request, mode);
    if (!this.host.active(request.sessionId, request.turnId)) throw veraError("CONFLICT");
    // A safe program command has no record to check; it runs in every mode.
    if (policy === "run") return;
    if (mode === "read-only" || policy === "refuse") throw veraError("CONFLICT");
    const row = this.host.db
      .prepare(
        "SELECT decided_by FROM approvals WHERE session_id=? AND turn_id=? AND tool_call_id=? AND request_sha256=? AND decision='approved'",
      )
      .get(request.sessionId, request.turnId, request.callId, requestSha256(request)) as
      | { decided_by: string }
      | undefined;
    if (request.tool === "plugin_install") {
      if (row?.decided_by !== "user") throw veraError("CONFLICT");
      return;
    }
    if (request.tool === "run_program") {
      // A mode decision lasts only while the current mode would still decide it the same way.
      if (!row || (row.decided_by === "mode" && policy !== "mode")) throw veraError("CONFLICT");
      return;
    }
    if (
      !row ||
      (request.scope === "filesystem" && this.host.mode(request.sessionId) !== "bypass") ||
      (request.protected && row.decided_by !== "user" && this.host.mode(request.sessionId) !== "bypass") ||
      (row.decided_by === "mode" && !["auto-edit", "bypass"].includes(this.host.mode(request.sessionId)))
    )
      throw veraError("CONFLICT");
  }
}
