import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";
import {
  modelReferenceSchema,
  type PermissionMode,
  reasoningOptionSchema,
  sessionIdSchema,
} from "@vera/shared";
import { z } from "zod";
import type { LlmGateway } from "../llm/gateway.js";

const requestId = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const instruction = z
  .string()
  .max(32000)
  .refine((text) => text.trim().length > 0);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const delegatedLaunchRequestSchema = z.strictObject({
  requestId,
  instruction,
  modelRef: modelReferenceSchema.optional(),
  reasoning: reasoningOptionSchema.optional(),
});

export const delegatedSendRequestSchema = z.strictObject({
  requestId,
  instruction,
  revision: revision.optional(),
});
export const delegatedConfigureRequestSchema = z.strictObject({
  requestId,
  modelRef: modelReferenceSchema,
  reasoning: reasoningOptionSchema.nullable(),
});
export const delegatedSendResultSchema = z.strictObject({
  sessionId: sessionIdSchema,
  turnId: z.string().min(1),
  messageId: z.string().min(1),
  delivery: z.enum(["started", "queued"]),
});
export const delegatedConfigurationSchema = delegatedConfigureRequestSchema.omit({ requestId: true }).extend({
  sessionId: sessionIdSchema,
  revision,
});

export type DelegatedSendRequest = z.input<typeof delegatedSendRequestSchema>;
export type DelegatedConfigureRequest = z.input<typeof delegatedConfigureRequestSchema>;
export type DelegatedSendResult = z.infer<typeof delegatedSendResultSchema>;
export type DelegatedConfiguration = z.infer<typeof delegatedConfigurationSchema>;

export type DelegatedLaunchRequest = z.input<typeof delegatedLaunchRequestSchema>;

/** Durable identifiers for the first turn of a delegated session. */
export interface DelegatedTurnIdentity {
  sessionId: string;
  turnId: string;
  messageId: string;
}

/** A launch result also reports the child's current mode, so the parent sees an Auto-edit start. */
export interface DelegatedLaunch extends DelegatedTurnIdentity {
  mode: PermissionMode;
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
  return delegationDigest([input.instruction, input.modelRef ?? null, input.reasoning ?? null]);
}

export function delegationDigest(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
