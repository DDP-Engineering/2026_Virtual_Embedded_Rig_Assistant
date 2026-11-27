import { addAbortListener } from "node:events";
import { type DelegatedTurnStatus, type SessionState, type StopReason, veraError } from "@vera/shared";
import type { DelegatedTurnIdentity } from "./delegation.js";
import type { SessionListener } from "./hub.js";

interface DelegatedTurnView {
  launch: DelegatedTurnIdentity;
  snapshot: SessionState;
  seq: number;
}

/** Keep the Desktop link and agent monitoring labels tied to the same turn outcome. */
export function delegatedTurnStatus(
  outcome: StopReason | "interrupted" | null,
  awaitingApproval: boolean,
): DelegatedTurnStatus {
  if (outcome === "end") return "completed";
  if (outcome === "aborted") return "stopped";
  return outcome ?? (awaitingApproval ? "awaiting_approval" : "running");
}

interface DelegatedTurnResult {
  sessionId: string;
  turnId: string;
  status: DelegatedTurnStatus;
  toolSteps: number;
  reply?: string;
  /** Why the turn failed or met a limit: the code the child recorded and whether trying again can help. */
  error?: { code: string; retryable: boolean };
  timedOut?: true;
}

/** Project the addressed turn and disclose only the final assistant text of a completed turn. */
export function projectDelegatedTurn(
  { launch: { sessionId, turnId }, snapshot }: DelegatedTurnView,
  mask: (text: string) => string,
): DelegatedTurnResult {
  const turn = snapshot.turns.find((entry) => entry.turnId === turnId);
  if (!turn) throw veraError("INTERNAL");
  const progress = { sessionId, turnId, toolSteps: turn.steps };
  if (snapshot.interrupted.includes(turnId)) return { ...progress, status: "interrupted" };
  if (turn.stopReason === "end") {
    const final = snapshot.items.findLast(
      (item) => item.kind === "assistant" && item.turnId === turnId && !item.streaming,
    );
    return {
      ...progress,
      status: "completed",
      ...(final?.kind === "assistant" && final.text ? { reply: mask(final.text) } : {}),
    };
  }
  if (turn.stopReason) {
    // The view holds this turn's events only, so its last error is the one that ended it.
    const failure =
      turn.stopReason === "aborted" ? undefined : snapshot.items.findLast((item) => item.kind === "error");
    return {
      ...progress,
      status: delegatedTurnStatus(turn.stopReason, false),
      ...(failure?.kind === "error" && { error: { code: failure.code, retryable: failure.retryable } }),
    };
  }

  return { ...progress, status: delegatedTurnStatus(null, pendingApproval(snapshot, turnId) !== undefined) };
}

/** The approval the addressed turn is waiting on, if any. */
function pendingApproval(snapshot: SessionState, turnId: string): string | undefined {
  if (snapshot.activeTurnId !== turnId) return undefined;
  return snapshot.approvals.find(
    (approval) =>
      approval.decision === null &&
      snapshot.items.some(
        (item) => item.kind === "tool" && item.turnId === turnId && item.id === approval.callId,
      ),
  )?.approvalId;
}

/**
 * Bridge a snapshot revision to the sequenced stream, including synchronous replay. The wait ends with the
 * turn, with an approval request the caller has not been told of, or at the deadline. `reported` holds the
 * approvals already returned to the caller: such an approval is the user's to decide, so a further wait
 * lasts until the turn moves on instead of returning at once on every call. Without it every pending
 * approval is news.
 */
export async function waitForDelegatedTurn(
  inspect: () => DelegatedTurnView,
  subscribe: (sinceSeq: number, listener: SessionListener) => () => void,
  mask: (text: string) => string,
  waitMs: number,
  signal: AbortSignal,
  reported?: Set<string>,
): Promise<DelegatedTurnResult> {
  signal.throwIfAborted();
  /** The view's result, and whether the wait goes on: the turn runs, or waits on a reported approval. */
  const read = () => {
    const view = inspect();
    const result = projectDelegatedTurn(view, mask);
    const approval =
      result.status === "awaiting_approval" ? pendingApproval(view.snapshot, result.turnId) : undefined;
    const known = approval !== undefined && reported?.has(approval) === true;
    if (approval !== undefined) reported?.add(approval);
    return { view, result, waiting: result.status === "running" || known };
  };
  const first = read();
  if (!first.waiting) return first.result;
  if (waitMs === 0) return { ...first.result, timedOut: true };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: ReturnType<typeof addAbortListener> | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    const outcome = await new Promise<DelegatedTurnResult>((resolve, reject) => {
      let settled = false;
      const refresh = (deadline: boolean) => {
        if (settled) return;
        try {
          signal.throwIfAborted();
          const current = read();
          if (current.waiting && !deadline) return;
          settled = true;
          resolve(current.waiting ? { ...current.result, timedOut: true } : current.result);
        } catch (error) {
          settled = true;
          reject(error);
        }
      };
      abortListener = addAbortListener(signal, () => {
        settled = true;
        reject(signal.reason);
      });
      timer = setTimeout(() => refresh(true), waitMs);
      unsubscribe = subscribe(first.view.seq, (seq, event) => {
        if (seq === undefined) return;
        // Mode decisions can settle in the same stack that first publishes the request.
        if (event.type === "approval.requested" || event.type === "approval.decided")
          queueMicrotask(() => refresh(false));
        if (event.type === "turn.done" && event.turnId === first.result.turnId) refresh(false);
      });
    });
    signal.throwIfAborted();
    return outcome;
  } finally {
    clearTimeout(timer);
    abortListener?.[Symbol.dispose]();
    unsubscribe?.();
  }
}
