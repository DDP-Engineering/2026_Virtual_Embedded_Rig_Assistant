// REQ-REL-4bea0006
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useSessionEvents } from "./use-session-events.js";

type SessionEvents = ReturnType<typeof useSessionEvents>;
const SessionViewContext = createContext<
  { id: string | undefined; workbenchId: string | undefined; value: SessionEvents } | undefined
>(undefined);
function unchanged() {}

/**
 * One session view per window (PERF-05): one snapshot, subscription and revision poll for the open
 * session, shared by the chat and the Changes, Artifacts and Plan tabs.
 */
export function SessionViewProvider({
  id,
  workbenchId,
  changed,
  children,
}: {
  id: string | undefined;
  workbenchId: string | undefined;
  changed: () => void;
  children?: ReactNode;
}) {
  const { view, error, retry, projection } = useSessionEvents(id, changed, workbenchId);
  const shared = useMemo(
    () => ({ id, workbenchId, value: { view, error, retry, projection } }),
    [id, workbenchId, view, error, retry, projection],
  );
  return <SessionViewContext.Provider value={shared}>{children}</SessionViewContext.Provider>;
}

/**
 * The provider's view when it holds this session; otherwise (no provider, as in isolated component
 * tests, or another session) a view of its own, exactly as `useSessionEvents`.
 */
export function useSessionView(
  id: string | undefined,
  changed: () => void = unchanged,
  workbenchId?: string,
): SessionEvents {
  const shared = useContext(SessionViewContext);
  const reuse =
    shared !== undefined &&
    shared.id === id &&
    (workbenchId === undefined || shared.workbenchId === workbenchId);
  const own = useSessionEvents(reuse ? undefined : id, changed, workbenchId);
  return reuse ? shared.value : own;
}
