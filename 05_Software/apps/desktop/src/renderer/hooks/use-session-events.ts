// REQ-REL-4bea0006
import { applySessionEvent, type SessionEvent, type SessionState } from "@vera/shared";
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
    setView(undefined);
    setError(undefined);
    if (id)
      void api
        .invoke("session.get", { sessionId: id })
        .then(({ snapshot, seq }) => {
          if (cancelled) return;
          setView({ id, state: snapshot, reasoning: {}, updates: {} });
          off = api.subscribe("session", id, seq, (event: SessionEvent) => {
            if (cancelled) return;
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
              event.type === "session.updated"
            )
              changed();
          });
        })
        .catch((failure) => {
          if (!cancelled) setError(failure);
        });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [id, changed, attempt]);
  return { view: view?.id === id ? view : undefined, error, retry: () => setAttempt((n) => n + 1) };
}
