import { z } from "zod";
import { dictationJobIdSchema } from "./dictation.js";
import {
  documentGuardSchema,
  documentIndexStatusSchema,
  documentSchema,
  documentSearchMetadataSchema,
  documentVolumeSchema,
  indexerStateSchema,
} from "./documents.js";
import { downloadApprovalSchema, validDownloadApproval } from "./downloads.js";
import { providerRetryAfterSchema } from "./errors.js";
import { gitStatusUpdateSchema } from "./git-status.js";
import type { Channel, Request, Response } from "./ipc.js";
import {
  planCommentSchema,
  planFeedbackIdSchema,
  planReviewSchema,
  planRevisionSchema,
} from "./plan-review.js";
import { programApprovalSchema, validProgramApproval } from "./program-rules.js";
import { reasoningOptionSchema } from "./provider-discovery.js";
import { providerTestStepSchema } from "./providers.js";
import {
  messageImagesSchema,
  permissionModeSchema,
  sessionIdSchema,
  sessionStatusSchema,
  stopReasonSchema,
  todoItemsSchema,
  turnCapacitySchema,
} from "./session.js";
import { questionIdSchema, questionOutcomeSchema, questionRequestSchema } from "./session-questions.js";
import type { Settings } from "./settings.js";
import { updateOfferSchema, updateSnapshotSchema } from "./updates.js";
import {
  workbenchIdSchema,
  workbenchSchema,
  workbenchSnapshotSchema,
  workbenchWarningSchema,
} from "./workbench.js";

export const appEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("provider.test.step"),
    testId: z.uuid(),
    ...providerTestStepSchema.pick({ step: true, status: true }).shape,
  }),
  z.strictObject({
    type: z.literal("settings.changed"),
    /** False when the change cannot alter masked content; absent, shown documents are loaded again. */
    masking: z.literal(false).optional(),
  }),
  z.strictObject({
    type: z.literal("update.available"),
    ...updateOfferSchema.pick({ version: true, notes: true }).shape,
  }),
  z.strictObject({ type: z.literal("update.changed"), snapshot: updateSnapshotSchema }),
  z.strictObject({ type: z.literal("indexer.status"), state: indexerStateSchema }),
  /** The plugin catalog was read again (an update check); the Plugins page reloads its view. */
  z.strictObject({ type: z.literal("plugins.catalog") }),
  z.strictObject({ type: z.literal("dictation.interrupted"), id: dictationJobIdSchema }),
  /** A session's turn, approval, title or status, or the set of open workbenches changed: read session.activity. */
  z.strictObject({ type: z.literal("session.activity") }),
  z.strictObject({ type: z.literal("session.notification.clicked"), token: z.uuid() }),
  /** A turn was admitted or ended, or the Concurrent turns limit changed (REQ-FUNC-33cd5f9f). */
  z.strictObject({ type: z.literal("session.capacity"), ...turnCapacitySchema.shape }),
]);
export type AppEvent = z.infer<typeof appEventSchema>;
/** Settings with no masking policy and no credential behind them. */
const presentationSettings = [
  "language",
  "theme",
  "textScale",
  "chatFontSize",
  "codeFontSize",
  "keyboardShortcuts",
  "dictation",
  "notifications",
  "recentWorkbenches",
  "sessionOrder",
];
/** The event for saved settings: `masking: false` only when nothing but presentation settings differ. */
export function settingsChangedEvent(previous: Settings | undefined, next: Settings): AppEvent {
  const changed = previous
    ? [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(
        (key) => JSON.stringify(Reflect.get(previous, key)) !== JSON.stringify(Reflect.get(next, key)),
      )
    : [];
  return changed.length && changed.every((key) => presentationSettings.includes(key))
    ? { type: "settings.changed", masking: false }
    : { type: "settings.changed" };
}
export const workbenchEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("index.status"), status: documentIndexStatusSchema }),
  z.strictObject({ type: z.literal("git.status"), update: gitStatusUpdateSchema }),
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
  /** The count guard of the last selection; null when it indexes (TASK-4321c06b). */
  z.strictObject({ type: z.literal("index.guard"), guard: documentGuardSchema.nullable() }),
  z.strictObject({ type: z.literal("opened"), workbench: workbenchSnapshotSchema }),
  z.strictObject({ type: z.literal("closed") }),
  z.strictObject({ type: z.literal("session.delegations.changed") }),
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
  /** Reported input tokens per conservatively estimated token of the request just answered. */
  calibration: z
    .strictObject({ modelRef: z.string().min(1), ratio: z.number().positive().max(1) })
    .optional(),
});
export const sessionEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("question.requested"), question: questionRequestSchema }),
  z.strictObject({
    type: z.literal("question.settled"),
    questionId: questionIdSchema,
    turnId: z.string().min(1),
    outcome: questionOutcomeSchema,
  }),
  z.strictObject({
    type: z.literal("session.updated"),
    title: z.string().max(60).optional(),
    status: sessionStatusSchema.optional(),
    modelRef: z.string().nullable().optional(),
    mode: permissionModeSchema.optional(),
    reasoning: reasoningOptionSchema.nullable().optional(),
    /** Session-scope Advanced values; null clears one (REQ-DATA-96ef3dd6). */
    advanced: z.record(z.string().max(64), z.union([z.number(), z.boolean(), z.null()])).optional(),
  }),
  z.strictObject({ type: z.literal("session.interrupted"), turnId: z.string() }),
  z.strictObject({ type: z.literal("turn.started"), turnId: z.string(), messageId: z.string().optional() }),
  z.strictObject({
    type: z.literal("turn.done"),
    turnId: z.string(),
    stopReason: stopReasonSchema,
    /** Present when a limit stop came from the turn's tool-call limit, not a context or output limit. */
    limit: z.literal("toolCalls").optional(),
  }),
  z.strictObject({
    type: z.literal("message.user"),
    messageId: z.string(),
    text: z.string(),
    parentSessionId: sessionIdSchema.optional(),
    images: messageImagesSchema.optional(),
    /** Send time in epoch milliseconds; absent on events recorded before send times existed. */
    timestamp: count.optional(),
  }),
  /** A derived history summary the agent request uses instead of the covered messages; not chat content. */
  z.strictObject({
    type: z.literal("context.compacted"),
    covered: count,
    fingerprint: z.string().min(1),
    note: z.string(),
    refs: z.array(z.string()),
    images: z.array(z.string()),
  }),
  z.strictObject({
    type: z.literal("message.bookmarked"),
    messageId: z.string().min(1).max(200),
    bookmarked: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("message.queued"),
    messageId: z.string(),
    text: z.string(),
    parentSessionId: sessionIdSchema.optional(),
    images: messageImagesSchema.optional(),
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
    /** Set only on events sent to the renderer (PERF-06): full UTF-8 size of the cut args JSON. */
    truncated: z.strictObject({ args: count }).optional(),
  }),
  z.strictObject({ type: z.literal("tool.update"), callId: z.string(), text: z.string() }),
  z.strictObject({
    type: z.literal("tool.done"),
    callId: z.string(),
    ok: z.boolean(),
    summary: z.string(),
    /** Canonical paths of an outside program call, independent of approval policy and output truncation. */
    program: programApprovalSchema.optional(),
    documentSearch: documentSearchMetadataSchema.optional(),
    preview: z.string().optional(),
    durationMs: count,
    /** Set only on events sent to the renderer (PERF-06): full UTF-8 size of the cut preview. */
    truncated: z.strictObject({ preview: count }).optional(),
  }),
  z
    .strictObject({
      type: z.literal("approval.requested"),
      approvalId: z.string(),
      callId: z.string(),
      requestSha256: z.string(),
      tool: z.enum([
        "write",
        "edit",
        "web_download",
        "run_program",
        "run_command",
        "plugin_install",
        "apply_candidate",
        "electrical_model_change",
        "electrical_network",
        "protection_coordination",
        "motor_drives",
        "power_quality",
        "lighting_design",
      ]),
      path: z.string(),
      diff: z.string(),
      bytes: count,
      download: downloadApprovalSchema.optional(),
      program: programApprovalSchema.optional(),
      /** Set only on events sent to the renderer (PERF-06): full UTF-8 size of the cut diff. */
      truncated: z.strictObject({ diff: count }).optional(),
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
  z.strictObject({ type: z.literal("plan.comments.saved"), comments: z.array(planCommentSchema) }),
  z.strictObject({ type: z.literal("plan.comment.removed"), commentId: planFeedbackIdSchema }),
  z.strictObject({ type: z.literal("plan.review.submitted"), review: planReviewSchema }),
  z.strictObject({
    type: z.literal("plan.review.restored"),
    reviewId: planFeedbackIdSchema,
    expectedFeedbackRevision: planRevisionSchema,
    comments: z.array(planCommentSchema),
  }),
  usageEventSchema,
  z.strictObject({
    type: z.literal("error"),
    code: z.string(),
    messageKey: z.string(),
    params: z.record(z.string(), z.union([z.string(), z.number().finite()])).optional(),
    retryable: z.boolean(),
    retryAfter: providerRetryAfterSchema.optional(),
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
  z
    .strictObject({ topic: z.literal("workbench"), id: workbenchIdSchema, event: workbenchEventSchema })
    .refine(({ id, event }) =>
      event.type === "index.status"
        ? id === event.status.workbenchId
        : event.type !== "git.status" || id === event.update.workbenchId,
    ),
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
