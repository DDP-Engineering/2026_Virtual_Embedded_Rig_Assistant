/**
 * Loads the embedding model of an open workbench once, on its first message, while the model writes its
 * first answer, so the first document search does not pay the model load (PERF-11). `cancel()` runs when
 * a workbench closes or another opens; closing also releases the worker in the indexer.
 */
export function createEmbeddingWarmup(options: {
  /** The workbench root when its database holds vectors of the current model; undefined otherwise. */
  hasVectors: (workbenchId: string) => Promise<string | undefined>;
  embed: (root: string, signal: AbortSignal) => Promise<unknown>;
}) {
  let current: { workbenchId: string; controller: AbortController } | undefined;
  return {
    request(workbenchId: string): void {
      if (current?.workbenchId === workbenchId) return;
      current?.controller.abort();
      const controller = new AbortController();
      current = { workbenchId, controller };
      void options
        .hasVectors(workbenchId)
        .then((root) => {
          if (root !== undefined && !controller.signal.aborted) return options.embed(root, controller.signal);
        })
        .catch(() => {});
    },
    cancel(): void {
      current?.controller.abort();
      current = undefined;
    },
  };
}
