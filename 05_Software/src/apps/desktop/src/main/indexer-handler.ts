import type {
  DocumentProcessor,
  EmbeddingPort,
  InspectInput,
  SelectInput,
  Selection,
  SourceInspection,
  VectorRow,
} from "@vera/core";
import { type EmbeddingModelId, embeddingModelIds, workbenchEmbeddingsSchema } from "@vera/shared";
import { z } from "zod";

export interface IndexerServices {
  process: DocumentProcessor;
  select: (input: SelectInput) => Promise<Selection>;
  inspect: (input: InspectInput) => Promise<SourceInspection>;
  embeddings: (model: EmbeddingModelId) => Pick<EmbeddingPort, "embed" | "rank">;
  release: (root: string) => Promise<void>;
}
type Request = { id?: unknown; type?: unknown; [key: string]: unknown };
/** Thrown by the lazy rows of a rank request when the worker's epoch cache misses. */
class NeedRows extends Error {}
const requestModel = z.enum(embeddingModelIds);

/**
 * The indexer protocol inside the utility process (TASK-f09609fd). Every request with an id gets
 * one reply, `{id, ok: true, value}` or `{id, ok: false, error}`; `cancel` aborts a running one.
 * Only data crosses the boundary: signals are made here and ownership stays checked in main.
 */
export function createIndexerHandler(services: IndexerServices, send: (message: unknown) => void) {
  const running = new Map<number, AbortController>();
  const answer = (id: number, task: (signal: AbortSignal) => Promise<unknown>) => {
    const controller = new AbortController();
    running.set(id, controller);
    void Promise.resolve()
      .then(() => task(controller.signal))
      .then(
        (value) => {
          if (running.delete(id)) send({ id, ok: true, value: value ?? null });
        },
        (error: unknown) => {
          if (!running.delete(id)) return;
          send({
            id,
            ok: false,
            error: controller.signal.aborted
              ? { aborted: true }
              : {
                  message: error instanceof Error ? error.message : String(error),
                  // Errno codes (ENOENT...) let ingest retry a vanished source instead of failing it.
                  ...(typeof (error as { code?: unknown } | null)?.code === "string"
                    ? { code: (error as { code: string }).code }
                    : {}),
                },
          });
        },
      );
  };
  return (message: unknown) => {
    const request = (message ?? {}) as Request;
    if (request.type === "cancel") {
      if (typeof request.id === "number") running.get(request.id)?.abort();
      return;
    }
    if (typeof request.id !== "number") return;
    const input = (request.input ?? {}) as Record<string, unknown>;
    switch (request.type) {
      case "process":
        return answer(request.id, (signal) => {
          const embeddings = workbenchEmbeddingsSchema.optional().parse(input.embeddings);
          // A cancelled request (workbench closed or switched) may not write its cache any more.
          return services.process({
            ...input,
            embeddings,
            signal,
            assertWritable: () => signal.throwIfAborted(),
          } as never);
        });
      case "select":
        return answer(request.id, (signal) => services.select({ ...input, signal } as never));
      case "inspect":
        return answer(request.id, (signal) => services.inspect({ ...input, signal } as never));
      case "embed":
        return answer(request.id, (signal) =>
          services
            .embeddings(requestModel.parse(request.model))
            .embed(String(request.root), request.texts as string[], signal),
        );
      case "rank": {
        const root = String(request.root),
          epoch = String(request.epoch);
        const rows = request.rows as VectorRow[] | undefined;
        return answer(request.id, async (signal) => {
          // Vectors cross the boundary once per epoch: the worker reads these rows only when its
          // cache misses at execution time, and then main is asked for them.
          const lazy = () => {
            throw new NeedRows();
          };
          const embeddings = services.embeddings(requestModel.parse(request.model));
          try {
            return {
              hits: await embeddings.rank(root, epoch, rows ?? lazy, String(request.query), signal),
            };
          } catch (error) {
            if (error instanceof NeedRows) return { needRows: true };
            throw error;
          }
        });
      }
      case "release":
        return answer(request.id, async () => {
          await services.release(String(request.root));
          return null;
        });
      default:
        send({ id: request.id, ok: false, error: { message: "Unknown indexer request." } });
    }
  };
}
