// REQ-UX-ec37f55b
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionActivity } from "@vera/shared";
import { useEffect } from "react";
import { api } from "../api/index.js";

const key = ["session.activity"] as const;

/**
 * The running and awaiting-approval sessions of every open workbench, shown one first. The app event
 * `session.activity` (a turn started or ended, an approval was requested or decided, a workbench opened
 * or closed) reads them again together with the shown workbench's session list, so the sidebar follows a
 * change at once instead of at the next list poll.
 */
export function useSessionActivity(): SessionActivity[] | undefined {
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, queryFn: () => api.invoke("session.activity", {}) });
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type !== "session.activity") return;
        void client.invalidateQueries({ queryKey: key });
        void client.invalidateQueries({ queryKey: ["session.list"] });
      }),
    [client],
  );
  return query.data;
}
