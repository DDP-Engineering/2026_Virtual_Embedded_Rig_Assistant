// REQ-REL-2b8d452f
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useSessionView } from "../../hooks/session-view.js";
import { useBookmarks } from "./use-bookmarks.js";

type Bookmarks = ReturnType<typeof useBookmarks>;
type Jump = { id: string; seq: number };
const Context = createContext<
  | {
      sessionId: string | undefined;
      bookmarks: Bookmarks;
      jump: Jump | null;
      requestJump: (id: string) => void;
    }
  | undefined
>(undefined);
const NONE: readonly string[] = [];

/**
 * One bookmark state per open session, shared by the transcript (message buttons, rail) and the
 * Bookmarks tab, so a change made in one shows in the others. Also carries the tab's jump requests.
 */
export function SessionBookmarksProvider({
  sessionId,
  disabled,
  children,
}: {
  sessionId: string | undefined;
  disabled: boolean;
  children: ReactNode;
}) {
  const { view } = useSessionView(sessionId);
  const bookmarks = useBookmarks(sessionId, view?.state.bookmarkedMessageIds ?? NONE, disabled || !sessionId);
  const [jump, setJump] = useState<(Jump & { sessionId: string | undefined }) | null>(null);
  const seq = useRef(0);
  const requestJump = useCallback(
    (id: string) => {
      seq.current += 1;
      setJump({ id, seq: seq.current, sessionId });
    },
    [sessionId],
  );
  const current = jump?.sessionId === sessionId ? jump : null;
  const value = useMemo(
    () => ({ sessionId, bookmarks, jump: current, requestJump }),
    [sessionId, bookmarks, current, requestJump],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** The provider's bookmark state for this session; otherwise (isolated tests, another session) its own. */
export function useSessionBookmarks(
  sessionId: string | undefined,
  ids: readonly string[],
  disabled: boolean,
) {
  const shared = useContext(Context);
  const reuse = shared !== undefined && shared.sessionId === sessionId;
  const own = useBookmarks(reuse ? undefined : sessionId, ids, disabled);
  return reuse ? shared.bookmarks : own;
}

/** The latest Bookmarks tab jump for this session and the function that requests one. */
export function useBookmarkJump(sessionId: string | undefined) {
  const shared = useContext(Context);
  const reuse = shared !== undefined && shared.sessionId === sessionId;
  return { jump: reuse ? shared.jump : null, requestJump: reuse ? shared.requestJump : undefined };
}
