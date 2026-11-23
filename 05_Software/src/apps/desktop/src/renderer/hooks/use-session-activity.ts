// REQ-UX-ec37f55b
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../api/index.js";

const key = ["session.activity"] as const;
export const unreadActivityKey = ["session.activity.unread"] as const;

/**
 * The running turns and pending requests of every open workbench, shown one first. The app event
 * `session.activity` (a turn started or ended, an approval was requested or decided, a workbench opened
 * or closed) reads them again together with the shown workbench's session list, so the sidebar follows a
 * change at once instead of at the next list poll.
 */
export function useSessionActivity() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: () => api.invoke("session.activity", {}) });
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type !== "session.activity") return;
        // Invalidation alone can reuse an initial read whose snapshot predates this event.
        for (const queryKey of [key, unreadActivityKey]) {
          const filter = { queryKey, exact: true };
          void client.cancelQueries(filter).then(() => client.invalidateQueries(filter));
        }
        void client.invalidateQueries({ queryKey: ["session.list"] });
      }),
    [client],
  );
  return query;
}
