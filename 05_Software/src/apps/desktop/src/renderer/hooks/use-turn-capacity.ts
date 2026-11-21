// REQ-UX-f20cb322 REQ-FUNC-33cd5f9f
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TurnCapacity } from "@vera/shared";
import { useCallback, useEffect } from "react";
import { api } from "../api/index.js";

const key = ["session.capacity"] as const;

/**
 * Active turns across every open workbench and the Concurrent turns limit, read once and then kept current
 * by the app event. `refused(limit)` records a TURN_LIMIT refusal: the limit was reached, whatever an
 * older value said, until a later event reports room.
 */
export function useTurnCapacity(): { capacity: TurnCapacity | undefined; refused: (limit: number) => void } {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: () => api.invoke("session.capacity", {}) });
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type === "session.capacity")
          client.setQueryData<TurnCapacity>(key, { active: event.active, limit: event.limit });
      }),
    [client],
  );
  const refused = useCallback(
    (limit: number) =>
      client.setQueryData<TurnCapacity>(key, (current) => ({
        active: Math.max(current?.active ?? 0, limit),
        limit,
      })),
    [client],
  );
  return { capacity: query.data, refused };
}
