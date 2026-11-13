import { z } from "zod";
import { documentSchema, documentVolumeSchema, indexerStateSchema } from "./documents.js";
import { downloadApprovalSchema, validDownloadApproval } from "./downloads.js";
import type { Channel, Request, Response } from "./ipc.js";
import { programApprovalSchema, validProgramApproval } from "./program-rules.js";
import { reasoningOptionSchema } from "./provider-discovery.js";
import {
  permissionModeSchema,
  sessionIdSchema,
  sessionStatusSchema,
  stopReasonSchema,
  todoItemsSchema,
} from "./session.js";
import { updateOfferSchema, updateSnapshotSchema } from "./updates.js";
import {
  workbenchIdSchema,
  workbenchSchema,
  workbenchSnapshotSchema,
  workbenchWarningSchema,
} from "./workbench.js";

export const appEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("settings.changed") }),
  z.strictObject({
    type: z.literal("update.available"),
    ...updateOfferSchema.pick({ version: true, notes: true }).shape,
  }),
  z.strictObject({ type: z.literal("update.changed"), snapshot: updateSnapshotSchema }),
  z.strictObject({ type: z.literal("indexer.status"), state: indexerStateSchema }),
  /** The plugin catalog was read again (an update check); the Plugins page reloads its view. */
  z.strictObject({ type: z.literal("plugins.catalog") }),
]);
export type AppEvent = z.infer<typeof appEventSchema>;
export const workbenchEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("index.document"),
    path: z.string().min(1),
    document: documentSchema.nullable(),
  }),
  z.strictObject({
    type: z.literal("index.progress"),
    pending: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    done: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    failed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({ type: z.literal("index.volume"), ...documentVolumeSchema.shape }),
  z.strictObject({ type: z.literal("opened"), workbench: workbenchSnapshotSchema }),
  z.strictObject({ type: z.literal("closed") }),
  z.strictObject({
    type: z.literal("config.changed"),
    config: workbenchSchema,
    warnings: z.array(workbenchWarningSchema),
  }),
]);
export type WorkbenchEvent = z.infer<typeof workbenchEventSchema>;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const usageEventSchema = z.strictObject({
  type: z.literal("usage.updated"),
  inputTokens: count,
  outputTokens: count,
  /** User messages whose processing owns the newly reported consumption. */
  promptIds: z.array(z.string().min(1)).min(1).optional(),
  contextTokens: count.optional(),
  contextWindow: count.optional(),
  inputBudgetTokens: z.number().int().optional(),
  reservedOutputTokens: count.optional(),
  safetyMarginTokens: count.optional(),
  estimated: z.boolean().optional(),
  compactionStatus: z.enum(["none", "running", "completed", "unavailable", "failed"]).optional(),
  requestViewTokens: count.optional(),
});
export const sessionEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("session.updated"),
    title: z.string().max(60).optional(),
    status: sessionStatusSchema.optional(),
    modelRef: z.string().nullable().optional(),
    mode: permissionModeSchema.optional(),
    reasoning: reasoningOptionSchema.nullable().optional(),
  }),
  z.strictObject({ type: z.literal("session.interrupted"), turnId: z.string() }),
  z.strictObject({ type: z.literal("turn.started"), turnId: z.string() }),
  z.strictObject({ type: z.literal("turn.done"), turnId: z.string(), stopReason: stopReasonSchema }),
  z.strictObject({ type: z.literal("message.user"), messageId: z.string(), text: z.string() }),
  z.strictObject({
    type: z.literal("message.queued"),
    messageId: z.string(),
    text: z.string(),
    timestamp: count,
  }),
  z.strictObject({ type: z.literal("message.delivered"), messageIds: z.array(z.string()).min(1) }),
  z.strictObject({ type: z.literal("message.delta"), messageId: z.string(), text: z.string() }),
  z.strictObject({ type: z.literal("reasoning.delta"), messageId: z.string(), text: z.string() }),
  z.strictObject({
    type: z.literal("message.done"),
    messageId: z.string(),
    text: z.string(),
    citations: z.array(z.strictObject({ ref: z.string(), valid: z.boolean() })),
  }),
  z.strictObject({
    type: z.literal("tool.started"),
    callId: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.strictObject({ type: z.literal("tool.update"), callId: z.string(), text: z.string() }),
  z.strictObject({
    type: z.literal("tool.done"),
    callId: z.string(),
    ok: z.boolean(),
    summary: z.string(),
    preview: z.string().optional(),
    durationMs: count,
  }),
  z
    .strictObject({
      type: z.literal("approval.requested"),
      approvalId: z.string(),
      callId: z.string(),
      requestSha256: z.string(),
      tool: z.enum(["write", "edit", "web_download", "run_program", "plugin_install", "apply_candidate"]),
      path: z.string(),
      diff: z.string(),
      bytes: count,
      download: downloadApprovalSchema.optional(),
      program: programApprovalSchema.optional(),
    })
    .refine(validDownloadApproval)
    .refine(validProgramApproval),
  z.strictObject({
    type: z.literal("approval.decided"),
    approvalId: z.string(),
    decision: z.enum(["approved", "denied", "aborted"]),
    by: z.enum(["user", "mode"]),
  }),
  z.strictObject({
    type: z.literal("change.recorded"),
    changeId: count,
    path: z.string(),
    added: count,
    removed: count,
  }),
  z.strictObject({
    type: z.literal("artifact.saved"),
    artifactId: z.string(),
    name: z.string(),
    bytes: count,
  }),
  z.strictObject({ type: z.literal("todo.updated"), items: todoItemsSchema }),
  usageEventSchema,
  z.strictObject({
    type: z.literal("error"),
    code: z.string(),
    messageKey: z.string(),
    retryable: z.boolean(),
  }),
]);
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export function isLiveSessionEvent(event: SessionEvent): boolean {
  return event.type === "message.delta" || event.type === "reasoning.delta" || event.type === "tool.update";
}
export const eventEnvelopeSchema = z.discriminatedUnion("topic", [
  z.strictObject({
    topic: z.literal("session"),
    id: sessionIdSchema,
    seq: count.optional(),
    subscriptionId: z.string().optional(),
    event: sessionEventSchema,
  }),
  z.strictObject({
    topic: z.literal("app"),
    id: z.literal("app"),
    seq: z.number().int().nonnegative().optional(),
    event: appEventSchema,
  }),
  z.strictObject({ topic: z.literal("workbench"), id: workbenchIdSchema, event: workbenchEventSchema }),
]);
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export const sessionSubscriptionSchema = z.strictObject({
  sessionId: sessionIdSchema,
  sinceSeq: count,
  subscriptionId: z.string().min(1).max(100),
});
export const sessionUnsubscriptionSchema = sessionSubscriptionSchema.pick({ subscriptionId: true });

export interface VeraBridge {
  invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>>;
  subscribe(topic: "app", on: (event: AppEvent) => void): () => void;
  subscribe(topic: "workbench", id: string, on: (event: WorkbenchEvent) => void): () => void;
  subscribe(topic: "session", id: string, sinceSeq: number, on: (event: SessionEvent) => void): () => void;
}
