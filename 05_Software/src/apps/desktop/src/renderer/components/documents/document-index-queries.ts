import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { veraError } from "@vera/shared";
import { useEffect } from "react";
import { api } from "../../api/index.js";

/** Observes the same projected records in Files and Workbench overview. */
export function useIndexedDocuments(workbenchId: string) {
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["docs.list", workbenchId],
    refetchOnMount: "always",
    queryFn: async () => {
      const result = await api.invoke("docs.list", { workbenchId });
      if (result.workbenchId !== workbenchId) throw veraError("CONFLICT");
      return result.documents;
    },
  });

  useEffect(() => {
    const queryKey = ["docs.list", workbenchId];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.subscribe("workbench", workbenchId, (event) => {
      if (event.type === "config.changed") void client.resetQueries({ queryKey });
      if (event.type === "index.document") {
        // Coalesce publications and supersede a cached refresh that predates this event.
        timer ??= setTimeout(() => {
          timer = undefined;
          void client.invalidateQueries({ queryKey });
        }, 300);
      }
    });
    const offApp = api.subscribe("app", (event) => {
      if (event.type === "settings.changed") void client.resetQueries({ queryKey: ["docs.list"] });
    });
    return () => {
      clearTimeout(timer);
      off();
      offApp();
    };
  }, [client, workbenchId]);

  return list;
}

export function useReindexDocuments(workbenchId: string, failedOnly = false) {
  const client = useQueryClient();
  const mutationKey = ["docs.reindex", workbenchId];
  const pending = useIsMutating({ mutationKey }) > 0;
  const mutation = useMutation({
    mutationKey,
    mutationFn: () => api.invoke("docs.reindex", { workbenchId, ...(failedOnly ? { failedOnly } : {}) }),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["docs.list", workbenchId] }),
        client.invalidateQueries({ queryKey: ["docs.search", workbenchId] }),
      ]);
    },
  });
  return { ...mutation, pending };
}
