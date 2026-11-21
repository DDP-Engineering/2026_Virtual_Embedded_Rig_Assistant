import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/index.js";

type Override = { value: boolean; pending: boolean };

/** Shares optimistic state until the durable event arrives, isolating obsolete session requests. */
export function useBookmarks(sessionId: string | undefined, ids: readonly string[], disabled: boolean) {
  const scope = useMemo(() => ({ sessionId, active: true, pending: new Set<string>() }), [sessionId]);
  const [overlay, setOverlay] = useState({ scope, values: new Map<string, Override>() });
  const [failure, setFailure] = useState<{ scope: typeof scope; error: unknown }>();
  const confirmed = useMemo(() => new Set(ids), [ids]);
  const values = overlay.scope === scope ? overlay.values : new Map<string, Override>();
  const latest = useRef({ confirmed, disabled, values });
  latest.current = { confirmed, disabled, values };
  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
    };
  }, [scope]);
  useEffect(() => {
    setOverlay((old) => {
      if (old.scope !== scope) return old;
      const values = new Map(old.values);
      for (const [id, entry] of values)
        if (!entry.pending && confirmed.has(id) === entry.value) values.delete(id);
      return values.size === old.values.size ? old : { scope, values };
    });
  }, [scope, confirmed]);
  const toggle = useCallback(
    (messageId: string, bookmarked: boolean) => {
      if (!sessionId || latest.current.disabled || scope.pending.has(messageId)) return;
      const previous = latest.current.values.get(messageId);
      scope.pending.add(messageId);
      setFailure(undefined);
      setOverlay((old) => ({
        scope,
        values: new Map(old.scope === scope ? old.values : []).set(messageId, {
          value: bookmarked,
          pending: true,
        }),
      }));
      void api.invoke("session.bookmark", { sessionId, messageId, bookmarked }).then(
        () => {
          if (!scope.active) return;
          scope.pending.delete(messageId);
          setOverlay((old) => {
            if (old.scope !== scope) return old;
            const values = new Map(old.values);
            if (latest.current.confirmed.has(messageId) === bookmarked) values.delete(messageId);
            else values.set(messageId, { value: bookmarked, pending: false });
            return { scope, values };
          });
        },
        (error: unknown) => {
          if (!scope.active) return;
          scope.pending.delete(messageId);
          setOverlay((old) => {
            if (old.scope !== scope) return old;
            const values = new Map(old.values);
            if (previous && latest.current.confirmed.has(messageId) !== previous.value)
              values.set(messageId, previous);
            else values.delete(messageId);
            return { scope, values };
          });
          setFailure({ scope, error });
        },
      );
    },
    [sessionId, scope],
  );
  /**
   * Removes the named bookmarks, or all of them, in one request. Rows leave at once; a failure restores
   * every one of them (the request is atomic in core).
   */
  const remove = useCallback(
    (target: readonly string[] | "all") => {
      if (!sessionId || latest.current.disabled) return;
      const current = latest.current;
      const has = (id: string) => current.values.get(id)?.value ?? current.confirmed.has(id);
      const all = new Set([
        ...current.confirmed,
        ...[...current.values].filter(([, v]) => v.value).map(([id]) => id),
      ]);
      const ids = (target === "all" ? [...all] : [...new Set(target)]).filter(
        (id) => has(id) && !scope.pending.has(id),
      );
      if (ids.length === 0) return;
      const previous = new Map(ids.map((id) => [id, current.values.get(id)] as const));
      for (const id of ids) scope.pending.add(id);
      setFailure(undefined);
      setOverlay((old) => {
        const values = new Map(old.scope === scope ? old.values : []);
        for (const id of ids) values.set(id, { value: false, pending: true });
        return { scope, values };
      });
      const request = target === "all" ? { sessionId, all: true as const } : { sessionId, messageIds: ids };
      void api.invoke("session.bookmarks.remove", request).then(
        () => {
          if (!scope.active) return;
          for (const id of ids) scope.pending.delete(id);
          setOverlay((old) => {
            if (old.scope !== scope) return old;
            const values = new Map(old.values);
            for (const id of ids)
              if (!latest.current.confirmed.has(id)) values.delete(id);
              else values.set(id, { value: false, pending: false });
            return { scope, values };
          });
        },
        (error: unknown) => {
          if (!scope.active) return;
          for (const id of ids) scope.pending.delete(id);
          setOverlay((old) => {
            if (old.scope !== scope) return old;
            const values = new Map(old.values);
            for (const id of ids) {
              const before = previous.get(id);
              if (before && latest.current.confirmed.has(id) !== before.value) values.set(id, before);
              else values.delete(id);
            }
            return { scope, values };
          });
          setFailure({ scope, error });
        },
      );
    },
    [sessionId, scope],
  );
  return {
    remove,
    has: (id: string) => values.get(id)?.value ?? confirmed.has(id),
    busy: (id: string) => values.get(id)?.pending ?? false,
    toggle,
    error: failure?.scope === scope ? failure.error : undefined,
  };
}
