import { z } from "zod";
import { MAX_MESSAGE_IMAGES } from "./composer-images.js";
import { modelReferenceSchema } from "./providers.js";

const imagePathSchema = z
  .string()
  .min(1)
  .refine((path) => [...path].every((character) => character >= " " && character !== "\u007f"));
export const messageImagesSchema = z.array(imagePathSchema).max(MAX_MESSAGE_IMAGES);
export const sessionIdSchema = z.string().regex(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
export const permissionModeSchema = z.enum(["read-only", "ask", "auto-edit", "bypass"]);
export const sessionStatusSchema = z.enum(["idle", "running", "awaiting_approval", "error"]);
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
  delegation: z
    .strictObject({
      parentSessionId: sessionIdSchema,
      status: delegatedTurnStatusSchema,
    })
    .optional(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type TodoItem = z.infer<typeof todoItemSchema>;
