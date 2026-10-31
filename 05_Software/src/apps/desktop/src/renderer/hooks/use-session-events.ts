// REQ-REL-4bea0006
import { applySessionEvent, isLiveSessionEvent, type SessionEvent, type SessionState } from "@vera/shared";
import { useEffect, useState } from "react";
import { api } from "../api/index.js";

export function useSessionEvents(id: string | undefined, changed: () => void) {
  const [view, setView] = useState<{
    id: string;
    state: SessionState;
    reasoning: Record<string, string>;
    updates: Record<string, string>;
  }>();
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
        setError(undefined);
        setView({ id, state: snapshot, reasoning: {}, updates: {} });
        off = api.subscribe("session", id, seq, (event: SessionEvent) => {
          if (cancelled || current !== generation) return;
          eventVersion++;
          // The preload can report a subscription failure as a non-durable error event.
          // Always reconcile errors, even if that extra event happens to balance a missed cursor.
          if (event.type === "error") needsSnapshot = true;
          if (!isLiveSessionEvent(event)) seq++;
          setView((old) => {
            if (old?.id !== id) return old;
            return {
              ...old,
              state: applySessionEvent(old.state, event),
              reasoning:
                event.type === "reasoning.delta"
                  ? {
                      ...old.reasoning,
                      [event.messageId]: (old.reasoning[event.messageId] ?? "") + event.text,
                    }
                  : old.reasoning,
              updates:
                event.type === "tool.update"
                  ? { ...old.updates, [event.callId]: (old.updates[event.callId] ?? "") + event.text }
                  : old.updates,
            };
          });
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
    };
  }, [id, changed, attempt]);
  return { view: view?.id === id ? view : undefined, error, retry: () => setAttempt((n) => n + 1) };
}
