import { addAbortListener } from "node:events";
import { type DelegatedTurnStatus, type SessionState, type StopReason, veraError } from "@vera/shared";
import type { DelegatedLaunch } from "./delegation.js";
import type { SessionListener } from "./hub.js";

interface DelegatedTurnView {
  launch: DelegatedLaunch;
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
  if (turn.stopReason) return { ...progress, status: delegatedTurnStatus(turn.stopReason, false) };

  const approvalPending =
    snapshot.activeTurnId === turnId &&
    snapshot.approvals.some(
      (approval) =>
        approval.decision === null &&
        snapshot.items.some(
          (item) => item.kind === "tool" && item.turnId === turnId && item.id === approval.callId,
        ),
    );
  return { ...progress, status: delegatedTurnStatus(null, approvalPending) };
}

/** Bridge a snapshot revision to the sequenced stream, including synchronous replay. */
export async function waitForDelegatedTurn(
  inspect: () => DelegatedTurnView,
  subscribe: (sinceSeq: number, listener: SessionListener) => () => void,
  mask: (text: string) => string,
  waitMs: number,
  signal: AbortSignal,
): Promise<DelegatedTurnResult> {
  signal.throwIfAborted();
  const first = inspect();
  const initial = projectDelegatedTurn(first, mask);
  if (initial.status !== "running") return initial;
  if (waitMs === 0) return { ...initial, timedOut: true };

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
          const current = projectDelegatedTurn(inspect(), mask);
          if (current.status === "running" && !deadline) return;
          settled = true;
          resolve(current.status === "running" ? { ...current, timedOut: true } : current);
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
      unsubscribe = subscribe(first.seq, (seq, event) => {
        if (seq === undefined) return;
        // Mode decisions can settle in the same stack that first publishes the request.
        if (event.type === "approval.requested") queueMicrotask(() => refresh(false));
        if (event.type === "turn.done" && event.turnId === initial.turnId) refresh(false);
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
