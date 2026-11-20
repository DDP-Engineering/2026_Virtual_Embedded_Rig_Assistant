import { veraError } from "@vera/shared";
import { timeoutError } from "../llm/errors.js";
import type { LlmEvent, LlmGateway, LlmRequest } from "../llm/gateway.js";

/**
 * Timer runs only while requesting model output, excluding tool and approval work. Every stream event and
 * every provider activity report, reasoning included, restarts it. A model's own limit replaces the default.
 */
export function timedGateway(gateway: LlmGateway, milliseconds: number): LlmGateway {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw veraError("INVALID");
  const prepareModel = gateway.prepareModel?.bind(gateway);
  const responseTimeoutMs = gateway.responseTimeoutMs?.bind(gateway);
  return {
    ...(prepareModel ? { prepareModel } : {}),
    ...(responseTimeoutMs ? { responseTimeoutMs } : {}),
    selectedModel: (id) => gateway.selectedModel(id),
    capabilities: (id, output) => gateway.capabilities(id, output),
    models: (id, signal, probe) => gateway.models(id, signal, probe),
    async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
      const own = responseTimeoutMs?.(request.model);
      const limit = own !== undefined && Number.isSafeInteger(own) && own > 0 ? own : milliseconds;
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      // Set only while a read is outstanding, so activity never starts the timer during tool work.
      let restart: (() => void) | undefined;
      const iterator = gateway
        .stream({
          ...request,
          signal: controller.signal,
          onActivity: () => {
            request.onActivity?.();
            restart?.();
          },
        })
        [Symbol.asyncIterator]();
      try {
        for (;;) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let cancel: (() => void) | undefined;
          const pending = iterator.next();
          let next: IteratorResult<LlmEvent> | "timeout" | "abort";
          try {
            next = await Promise.race([
              pending,
              new Promise<"timeout">((resolve) => {
                restart = () => {
                  if (timer) clearTimeout(timer);
                  timer = setTimeout(() => resolve("timeout"), limit);
                };
                restart();
              }),
              new Promise<"abort">((resolve) => {
                cancel = () => resolve("abort");
                if (request.signal.aborted) cancel();
                else request.signal.addEventListener("abort", cancel, { once: true });
              }),
            ]);
          } finally {
            restart = undefined;
            if (timer) clearTimeout(timer);
            if (cancel) request.signal.removeEventListener("abort", cancel);
          }
          if (next === "timeout" || next === "abort") {
            controller.abort();
            void pending.catch(() => {});
            yield {
              type: "error",
              error: next === "timeout" ? timeoutError(limit) : veraError("PROVIDER"),
              aborted: next === "abort",
            };
            return;
          }
          if (next.done) return;
          yield next.value;
        }
      } finally {
        controller.abort();
        request.signal.removeEventListener("abort", abort);
        void iterator.return?.().catch(() => {});
      }
    },
  };
}
