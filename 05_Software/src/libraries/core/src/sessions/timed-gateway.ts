import { veraError } from "@vera/shared";
import type { LlmEvent, LlmGateway, LlmRequest } from "../llm/gateway.js";

/** Timer runs only while requesting model output, excluding tool and approval work. */
export function timedGateway(gateway: LlmGateway, milliseconds: number): LlmGateway {
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw veraError("INVALID");
  const prepareModel = gateway.prepareModel?.bind(gateway);
  return {
    ...(prepareModel ? { prepareModel } : {}),
    selectedModel: (id) => gateway.selectedModel(id),
    capabilities: (id, output) => gateway.capabilities(id, output),
    models: (id, signal, probe) => gateway.models(id, signal, probe),
    async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
      const controller = new AbortController();
      const abort = () => controller.abort();
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      const iterator = gateway.stream({ ...request, signal: controller.signal })[Symbol.asyncIterator]();
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
                timer = setTimeout(() => resolve("timeout"), milliseconds);
              }),
              new Promise<"abort">((resolve) => {
                cancel = () => resolve("abort");
                if (request.signal.aborted) cancel();
                else request.signal.addEventListener("abort", cancel, { once: true });
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
            if (cancel) request.signal.removeEventListener("abort", cancel);
          }
          if (next === "timeout" || next === "abort") {
            controller.abort();
            void pending.catch(() => {});
            yield { type: "error", error: veraError("PROVIDER"), aborted: next === "abort" };
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
