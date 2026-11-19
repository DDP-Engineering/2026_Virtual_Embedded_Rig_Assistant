/**
 * Loads the embedding model of an open workbench once, on its first message, while the model writes its
 * first answer, so the first document search does not pay the model load (PERF-11). `cancel()` runs when
 * a workbench closes or another opens; closing also releases the worker in the indexer.
 */
export function createEmbeddingWarmup<T>(options: {
  /** The target when the workbench database holds vectors for it. */
  hasVectors: (workbenchId: string) => Promise<T | undefined>;
  embed: (target: T, signal: AbortSignal) => Promise<unknown>;
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
        .then((target) => {
          // An aborted request is no longer the current one.
          if (controller.signal.aborted) return;
          if (target !== undefined) return options.embed(target, controller.signal);
          // Nothing is indexed yet: forget the request, so a message after the first indexing warms up.
          current = undefined;
        })
        .catch(() => {});
    },
    cancel(): void {
      current?.controller.abort();
      current = undefined;
    },
  };
}
