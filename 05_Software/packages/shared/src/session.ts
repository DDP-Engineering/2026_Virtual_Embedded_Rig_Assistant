import { z } from "zod";
import { modelReferenceSchema } from "./providers.js";

export const sessionIdSchema = z.string().regex(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
export const permissionModeSchema = z.enum(["read-only", "ask", "auto-edit"]);
export const sessionStatusSchema = z.enum(["idle", "running", "awaiting_approval", "error"]);
export const stopReasonSchema = z.enum(["end", "aborted", "error", "limit"]);
export const todoItemSchema = z.strictObject({
  id: z.string().optional(),
  text: z.string(),
  status: z.enum(["pending", "in_progress", "done"]),
});
export const sessionSummarySchema = z.strictObject({
  id: sessionIdSchema,
  title: z.string().max(60),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  modelRef: modelReferenceSchema.nullable(),
  mode: permissionModeSchema,
  status: sessionStatusSchema,
  archived: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type TodoItem = z.infer<typeof todoItemSchema>;
