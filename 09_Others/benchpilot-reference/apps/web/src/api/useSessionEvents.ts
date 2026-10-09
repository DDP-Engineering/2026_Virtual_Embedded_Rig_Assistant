import { applySessionEvent, type SessionDetail, type SessionEvent } from "@benchpilot/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, type StreamState } from "./index";
import { qk } from "./queries";

const REPORTING_TOOLS = new Set(["save_report_analysis", "draft_ticket"]);

/**
 * One SSE subscription per open session (01). Order (P3 contract, P4b decision):
 * 1. fetch the snapshot `GET /sessions/:id` — it carries `seq`, the id of the last event folded into it;
 * 2. open the stream with `?since=<seq>`, so it carries exactly the later events;
 * 3. reduce each event into the `session` query cache and advance the cached `seq` to its id. An event whose id is
 *    at or below the cached `seq` is already in the cache and is skipped, so nothing applies twice.
 * Reconnects resume by themselves (Last-Event-ID, or `?since=` when the stream is reopened): no snapshot refetch.
 * A session deleted meanwhile (demo reset) stops the stream (`onGone`) and the page falls back to "not found".
 * Events that change other resources invalidate those queries. Returns the stream state for the reconnect banner.
 */
export function useSessionEvents(sessionId: string | undefined, onEvent?: (e: SessionEvent) => void): StreamState {
  const qc = useQueryClient();
  const [state, setState] = useState<StreamState>("open");
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!sessionId) return;
    const key = qk.session(sessionId);
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    let last: StreamState = "open";

    // A fresh snapshot on every (re)subscribe: events that happened while another page was open are only in it.
    qc.query({ queryKey: key, queryFn: () => api.getSession(sessionId), staleTime: 0 }).then(
      (snapshot) => {
        if (cancelled) return;
        unsubscribe = api.subscribeSessionEvents(sessionId, snapshot.seq ?? 0, {
          onEvent(event, seq) {
            const before = qc.getQueryData<SessionDetail>(key);
            if (!before || (before.seq !== undefined && seq <= before.seq)) return;
            qc.setQueryData<SessionDetail>(key, { ...applySessionEvent(before, event), seq });
            switch (event.type) {
              case "turn.started":
              case "turn.done":
              case "plan.proposed":
              case "plan.decided":
                void qc.invalidateQueries({ queryKey: qk.sessions });
                break;
              case "run.completed":
                void qc.invalidateQueries({ queryKey: qk.reports });
                void qc.invalidateQueries({ queryKey: qk.testbenches });
                void qc.invalidateQueries({ queryKey: qk.catalog });
                void qc.invalidateQueries({ queryKey: qk.sessions });
                void qc.invalidateQueries({ queryKey: ["simulation"] });
                break;
              case "tool.done": {
                // 01: no extra event for analyses and tickets — the report is refetched when their tool finishes.
                const call = before.items.find((i) => i.kind === "tool" && i.id === event.callId);
                if (call?.kind === "tool" && REPORTING_TOOLS.has(call.name)) void qc.invalidateQueries({ queryKey: qk.reports });
                break;
              }
            }
            onEventRef.current?.(event);
          },
          onState(next) {
            // Back from a drop: the stream itself resumes after the last event; lists may have moved meanwhile.
            if (next === "open" && last === "reconnecting") {
              void qc.invalidateQueries({ queryKey: qk.sessions });
              void qc.invalidateQueries({ queryKey: qk.reports });
            }
            last = next;
            setState(next);
          },
          onGone() {
            // Deleted by a reset (another tab): refetch the snapshot, whose 404 shows "Page not found".
            last = "open";
            setState("open");
            void qc.resetQueries({ queryKey: key, exact: true });
          },
        });
      },
      () => undefined, // useSession shows the error (404 → Page not found).
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
      setState("open");
    };
  }, [sessionId, qc]);

  return state;
}

