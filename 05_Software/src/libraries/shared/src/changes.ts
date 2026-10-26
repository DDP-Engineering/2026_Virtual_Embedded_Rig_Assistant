import { z } from "zod";
import { sessionIdSchema } from "./session.js";

export const changeIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const changeSummarySchema = z.strictObject({
  changeId: changeIdSchema,
  sessionId: sessionIdSchema,
  path: z.string().min(1),
  createdAt: z.iso.datetime(),
  added: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  removed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const changeDetailSchema = changeSummarySchema.extend({ diff: z.string() });
export type ChangeSummary = z.infer<typeof changeSummarySchema>;
export type ChangeDetail = z.infer<typeof changeDetailSchema>;
