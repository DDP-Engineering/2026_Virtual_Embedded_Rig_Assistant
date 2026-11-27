import { z } from "zod";
import { advancedSettings } from "./advanced-settings.js";
import { modelReferenceSchema } from "./providers.js";
import { questionIdSchema } from "./session-questions.js";

const imagePathSchema = z
  .string()
  .min(1)
  .refine((path) => [...path].every((character) => character >= " " && character !== "\u007f"));
export const messageImagesSchema = z.array(imagePathSchema).max(advancedSettings.imagesPerMessage.max);
export const sessionIdSchema = z.string().regex(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
export const permissionModeSchema = z.enum(["read-only", "ask", "auto-edit", "bypass"]);
export const sessionStatusSchema = z.enum(["idle", "running", "awaiting_approval", "error"]);
/**
 * Turns running now across every open workbench and the Concurrent turns limit that admits new ones
 * (REQ-FUNC-33cd5f9f). `active` may exceed `limit` after the limit was lowered.
 */
export const turnCapacitySchema = z.strictObject({
  active: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type TurnCapacity = z.infer<typeof turnCapacitySchema>;
export const stopReasonSchema = z.enum(["end", "aborted", "error", "limit"]);
export type StopReason = z.infer<typeof stopReasonSchema>;
export const delegatedTurnStatusSchema = z.enum([
  "running",
  "awaiting_approval",
  "completed",
  "stopped",
  "error",
  "limit",
  "interrupted",
]);
export type DelegatedTurnStatus = z.infer<typeof delegatedTurnStatusSchema>;
export const todoItemSchema = z.strictObject({
  id: z.string().optional(),
  text: z.string().max(200),
  status: z.enum(["pending", "in_progress", "done"]),
});
export const todoItemsSchema = z.array(todoItemSchema).max(50);
export const sessionSummarySchema = z.strictObject({
  id: sessionIdSchema,
  title: z.string().max(60),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  modelRef: modelReferenceSchema.nullable(),
  mode: permissionModeSchema,
  status: sessionStatusSchema,
  archived: z.boolean(),
  pendingQuestionId: questionIdSchema.optional(),
  pendingPlanDecision: z.literal(true).optional(),
  delegation: z
    .strictObject({
      parentSessionId: sessionIdSchema,
      turnId: z.string().min(1),
      status: delegatedTurnStatusSchema,
    })
    .optional(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type TodoItem = z.infer<typeof todoItemSchema>;
