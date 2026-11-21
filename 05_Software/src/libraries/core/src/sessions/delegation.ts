import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import { modelReferenceSchema, reasoningOptionSchema } from "@vera/shared";
import { z } from "zod";
import type { LlmGateway } from "../llm/gateway.js";

export const delegatedLaunchRequestSchema = z.strictObject({
  requestId: z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/),
  instruction: z
    .string()
    .max(32000)
    .refine((text) => text.trim().length > 0),
  modelRef: modelReferenceSchema.optional(),
  reasoning: reasoningOptionSchema.optional(),
});

export type DelegatedLaunchRequest = z.input<typeof delegatedLaunchRequestSchema>;

/** Durable identifiers for the first turn of a delegated session. */
export interface DelegatedLaunch {
  sessionId: string;
  turnId: string;
  messageId: string;
}

/** Keep launch and child shutdown cancellable when provider metadata is still pending. */
export async function prepareDelegatedModel(gateway: LlmGateway, model: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const preparation = gateway.prepareModel?.(model, signal);
  if (!preparation) return;
  let subscription: ReturnType<typeof addAbortListener> | undefined;
  try {
    await Promise.race([
      preparation,
      new Promise<never>((_resolve, reject) => {
        subscription = addAbortListener(signal, () => reject(signal.reason));
      }),
    ]);
  } finally {
    subscription?.[Symbol.dispose]();
  }
}

export function delegatedRequestHash(input: DelegatedLaunchRequest): string {
  return createHash("sha256")
    .update(JSON.stringify([input.instruction, input.modelRef ?? null, input.reasoning ?? null]))
    .digest("hex");
}
