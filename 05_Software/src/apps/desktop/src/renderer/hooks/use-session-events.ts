// REQ-REL-4bea0006
import { applySessionEvent, isLiveSessionEvent, type SessionEvent, type SessionState } from "@vera/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/index.js";

type View = {
  id: string;
  workbenchId: string | undefined;
  projection: number;
  state: SessionState;
  reasoning: Record<string, string>;
  updates: Record<string, string>;
};
/** Live reasoning and tool output are previews: only this many trailing characters of each are kept. */
const LIVE_TAIL = 500_000;
/** A reconcile whose IPC call has not settled after this long no longer holds back the next check. */
const RECONCILE_TIMEOUT_MS = 30_000;
const tail = (text: string) => (text.length > LIVE_TAIL ? text.slice(-LIVE_TAIL) : text);
/** Folds a frame's events in arrival order; reasoning and updates are copied once per batch. */
function applyBatch(old: View, batch: readonly SessionEvent[]): View {
  let { state, reasoning, updates } = old;
  for (const event of batch) {
    state = applySessionEvent(state, event);
    if (event.type === "reasoning.delta") {
      if (reasoning === old.reasoning) reasoning = { ...reasoning };
      reasoning[event.messageId] = tail((reasoning[event.messageId] ?? "") + event.text);
    } else if (event.type === "tool.update") {
      if (updates === old.updates) updates = { ...updates };
      updates[event.callId] = tail((updates[event.callId] ?? "") + event.text);
    } else if (event.type === "tool.done" && Object.hasOwn(updates, event.callId)) {
      if (updates === old.updates) updates = { ...updates };
      delete updates[event.callId];
    }
  }
  return { ...old, state, reasoning, updates };
}

/**
 * Snapshot plus live subscription for one session. Live events (deltas, tool updates) are queued
 * and applied once per animation frame (PERF-04): at most one transcript update per frame, whatever
 * the token rate. A durable event (turn.done, error, session.updated, tool and todo changes) applies
 * the queue and itself at once, so status changes are never a frame late and order is kept.
 * Privacy/model changes invalidate the projection without waiting for a durable cursor change.
 * `projection` also invalidates captured selections; an old in-flight answer cannot restore them.
 */
export function useSessionEvents(id: string | undefined, changed: () => void, workbenchId?: string) {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void attempt; // A retry deliberately starts a fresh snapshot and subscription.
    let cancelled = false;
    let invalidated = false;
    let modelRef: string | null = null;
    let off: (() => void) | undefined;
    let seq = 0;
    let generation = 0;
    let eventVersion = 0;
    let loaded = false;
    let needsSnapshot = false;
    let checking = false;
    let runs = 0;
    let applied = 0;
    let release: number | undefined; // The guard timer of the latest reconcile, cleared on unmount.
    let queue: SessionEvent[] = [];
    let frame = 0;
    const drop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      queue = [];
    };
    const flush = () => {
      const batch = queue;
      drop();
      if (batch.length) setView((old) => (old && old.id === id ? applyBatch(old, batch) : old));
    };
    const invalidate = () => {
      if (cancelled || invalidated) return;
      invalidated = true;
      drop();
      setView(undefined);
      setAttempt((n) => n + 1);
    };
    setView(undefined);
    setError(undefined);
    async function reconcile() {
      if (!id || cancelled || invalidated || checking) return;
      checking = true;
      const run = ++runs;
      const version = eventVersion;
      // An IPC call that never settles would keep the guard set and end every later check.
      const guard = window.setTimeout(() => {
        if (run === runs) checking = false;
      }, RECONCILE_TIMEOUT_MS);
      release = guard;
      try {
        // Checking the durable cursor avoids replaying a long transcript on every heartbeat.
        if (loaded) {
          const revision = await api.invoke("session.revision", { sessionId: id });
          if (
            cancelled ||
            invalidated ||
            eventVersion !== version ||
            (revision.seq === seq && !needsSnapshot)
          )
            return;
        }
        const { snapshot, seq: cursor } = await api.invoke("session.get", { sessionId: id });
        // A live event received during IPC is newer than this snapshot. Try again next heartbeat.
        // A slow call still applies after its timeout, unless a later check answered first.
        if (cancelled || invalidated || eventVersion !== version || run < applied) return;
        applied = run;
        seq = cursor;
        needsSnapshot = false;
        loaded = false;
        const current = ++generation;
        off?.();
        drop(); // The snapshot is newer than anything still queued from the previous subscription.
        setError(undefined);
        modelRef = snapshot.modelRef;
        setView({ id, workbenchId, projection: attempt, state: snapshot, reasoning: {}, updates: {} });
        off = api.subscribe("session", id, seq, (event: SessionEvent) => {
          if (cancelled || invalidated || current !== generation) return;
          if (
            event.type === "session.updated" &&
            event.modelRef !== undefined &&
            event.modelRef !== modelRef
          ) {
            invalidate();
            changed();
            return;
          }
          eventVersion++;
          // The preload can report a subscription failure as a non-durable error event.
          // Always reconcile errors, even if that extra event happens to balance a missed cursor.
          if (event.type === "error") needsSnapshot = true;
          const live = isLiveSessionEvent(event);
          if (!live) seq++;
          queue.push(event);
          if (!live) flush();
          else if (!frame) frame = requestAnimationFrame(flush);
          if (
            event.type === "turn.started" ||
            event.type === "turn.done" ||
            event.type === "session.updated" ||
            event.type === "approval.requested" ||
            event.type === "approval.decided" ||
            event.type === "question.requested" ||
            event.type === "question.settled"
          )
            changed();
        });
        loaded = true;
        changed();
      } catch (failure) {
        // Preserve an existing transcript on a transient IPC failure; the next check retries.
        if (!cancelled && !invalidated && !loaded) setError(failure);
      } finally {
        window.clearTimeout(guard);
        // After a timeout the guard may belong to a later check.
        if (run === runs) checking = false;
      }
    }
    const appOff = id
      ? api.subscribe("app", (event) => {
          if (event.type === "settings.changed" && event.masking !== false) invalidate();
        })
      : undefined;
    const benchOff =
      id && workbenchId
        ? api.subscribe("workbench", workbenchId, (event) => {
            if (event.type === "config.changed") invalidate();
          })
        : undefined;
    const check = () => void reconcile();
    check();
    const timer = id ? window.setInterval(check, 2000) : undefined;
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(release);
      window.removeEventListener("focus", check);
      off?.();
      appOff?.();
      benchOff?.();
      drop();
    };
  }, [id, workbenchId, changed, attempt]);
  // Stable, so a shared session view (SessionViewProvider) only changes when the data does.
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    view:
      view && view.id === id && view.workbenchId === workbenchId && view.projection === attempt
        ? view
        : undefined,
    error,
    retry,
    projection: attempt,
  };
}
