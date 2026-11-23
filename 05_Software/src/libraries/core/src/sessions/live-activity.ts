import type { SessionEvent } from "@vera/shared";

type Turn = {
  kind: "ordinary" | "plan-review";
  delegated: boolean;
  turnId: string;
};

/** The live completion is eligible independently of which host consumes it. */
export function successfulOrdinaryTurn(
  event: SessionEvent,
  turn: Turn | undefined,
): event is Extract<SessionEvent, { type: "turn.done" }> {
  return (
    event.type === "turn.done" &&
    event.stopReason === "end" &&
    turn?.kind === "ordinary" &&
    !turn.delegated &&
    turn.turnId === event.turnId
  );
}

/** Committed session activity for host integrations. The approval query reflects current state. */
export type LiveSessionActivity =
  | { type: "turn.completed"; turnId: string }
  | { type: "approval.requested"; approvalId: string; pending: () => boolean }
  | { type: "approval.decided"; approvalId: string };
