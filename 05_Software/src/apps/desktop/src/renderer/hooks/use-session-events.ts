// REQ-REL-4bea0006
import { applySessionEvent, isLiveSessionEvent, type SessionEvent, type SessionState } from "@vera/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/index.js";

type View = {
  id: string;
  state: SessionState;
  reasoning: Record<string, string>;
  updates: Record<string, string>;
};
/** Folds a frame's events in arrival order; reasoning and updates are copied once per batch. */
function applyBatch(old: View, batch: readonly SessionEvent[]): View {
  let { state, reasoning, updates } = old;
  for (const event of batch) {
    state = applySessionEvent(state, event);
    if (event.type === "reasoning.delta") {
      if (reasoning === old.reasoning) reasoning = { ...reasoning };
      reasoning[event.messageId] = (reasoning[event.messageId] ?? "") + event.text;
    } else if (event.type === "tool.update") {
      if (updates === old.updates) updates = { ...updates };
      updates[event.callId] = (updates[event.callId] ?? "") + event.text;
    }
  }
  return { ...old, state, reasoning, updates };
}

/**
 * Snapshot plus live subscription for one session. Live events (deltas, tool updates) are queued
 * and applied once per animation frame (PERF-04): at most one transcript update per frame, whatever
 * the token rate. A durable event (turn.done, error, session.updated, tool and todo changes) applies
 * the queue and itself at once, so status changes are never a frame late and order is kept.
 */
export function useSessionEvents(id: string | undefined, changed: () => void) {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void attempt; // A retry deliberately starts a fresh snapshot and subscription.
    let cancelled = false;
    let off: (() => void) | undefined;
    let seq = 0;
    let generation = 0;
    let eventVersion = 0;
    let loaded = false;
    let needsSnapshot = false;
    let checking = false;
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
    setView(undefined);
    setError(undefined);
    async function reconcile() {
      if (!id || cancelled || checking) return;
      checking = true;
      const version = eventVersion;
      try {
        // Checking the durable cursor avoids replaying a long transcript on every heartbeat.
        if (loaded) {
          const revision = await api.invoke("session.revision", { sessionId: id });
          if (cancelled || eventVersion !== version || (revision.seq === seq && !needsSnapshot)) return;
        }
        const { snapshot, seq: cursor } = await api.invoke("session.get", { sessionId: id });
        // A live event received during IPC is newer than this snapshot. Try again next heartbeat.
        if (cancelled || eventVersion !== version) return;
        seq = cursor;
        needsSnapshot = false;
        loaded = false;
        const current = ++generation;
        off?.();
        drop(); // The snapshot is newer than anything still queued from the previous subscription.
        setError(undefined);
        setView({ id, state: snapshot, reasoning: {}, updates: {} });
        off = api.subscribe("session", id, seq, (event: SessionEvent) => {
          if (cancelled || current !== generation) return;
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
            event.type === "approval.decided"
          )
            changed();
        });
        loaded = true;
        changed();
      } catch (failure) {
        // Preserve an existing transcript on a transient IPC failure; the next check retries.
        if (!cancelled && !loaded) setError(failure);
      } finally {
        checking = false;
      }
    }
    const check = () => void reconcile();
    check();
    const timer = id ? window.setInterval(check, 2000) : undefined;
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      off?.();
      drop();
    };
  }, [id, changed, attempt]);
  // Stable, so a shared session view (SessionViewProvider) only changes when the data does.
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { view: view?.id === id ? view : undefined, error, retry };
}
