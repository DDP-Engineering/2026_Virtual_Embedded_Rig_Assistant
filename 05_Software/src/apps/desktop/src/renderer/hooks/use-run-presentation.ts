import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import type { Request } from "@vera/shared";
import { useEffect } from "react";
import { api } from "../api/index.js";

/** Drops cached presentation and cancels old replies before reloading under live privacy choices. */
export function useRunPresentation(workbenchId?: string) {
  const client = useQueryClient();
  useEffect(() => {
    const refresh = (owner?: string) => {
      const observed = client
        .getQueryCache()
        .findAll({ queryKey: ["plugin-programs"] })
        .filter(
          (query) =>
            (owner === undefined || query.queryKey[1] === owner) &&
            (query.queryKey[1] === null || query.queryKey[1] === workbenchId) &&
            (query.state.data !== undefined ||
              query.state.fetchStatus === "fetching" ||
              query.state.status === "error"),
        );
      void client.resetQueries({
        predicate: ({ queryKey }) =>
          ["runs", "run-log", "plugin-programs"].includes(String(queryKey[0])) &&
          (owner === undefined || queryKey[1] === owner),
      });
      for (const { queryKey } of observed) {
        const id = queryKey[2],
          owner = queryKey[1];
        if (typeof id !== "string" || (owner !== null && typeof owner !== "string")) continue;
        void readProgramStatuses(client, queryKey, {
          id,
          ...(owner === null ? {} : { workbenchId: owner }),
        }).catch(() => {});
      }
    };
    const offApp = api.subscribe("app", (event) => {
      if (event.type === "settings.changed") refresh();
    });
    const offWorkbench = workbenchId
      ? api.subscribe("workbench", workbenchId, (event) => {
          if (event.type === "config.changed") refresh(workbenchId);
        })
      : () => {};
    return () => {
      offApp();
      offWorkbench();
    };
  }, [client, workbenchId]);
}

function readProgramStatuses(client: QueryClient, queryKey: QueryKey, request: Request<"plugins.programs">) {
  return client.fetchQuery({
    queryKey,
    staleTime: 0,
    retry: false,
    queryFn: () => api.invoke("plugins.programs", request),
  });
}

/** Actions retain their lifetime; only a fresh passive read publishes their current presentation. */
export async function observeProgramAction(
  client: QueryClient,
  queryKey: QueryKey,
  request: Request<"plugins.programs">,
  action: () => Promise<unknown>,
) {
  await client.cancelQueries({ queryKey, exact: true });
  let result: unknown;
  try {
    result = await action();
  } catch (error) {
    // Keep dependency failure/readiness semantics without putting an action back into the query function.
    await client.cancelQueries({ queryKey, exact: true });
    await client
      .fetchQuery({
        queryKey,
        staleTime: 0,
        retry: false,
        queryFn: () => {
          throw error;
        },
      })
      .catch(() => {});
    throw error;
  }
  if (result !== null) {
    await client.cancelQueries({ queryKey, exact: true });
    return readProgramStatuses(client, queryKey, request);
  }
  return undefined;
}
