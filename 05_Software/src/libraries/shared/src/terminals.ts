import { z } from "zod";
import { workbenchIdSchema } from "./workbench.js";

export const terminalIdSchema = z.uuid();
export const terminalOwnerSchema = z.strictObject({ workbenchId: workbenchIdSchema });
export const terminalTargetSchema = terminalOwnerSchema.extend({ id: terminalIdSchema });
export const terminalSizeSchema = z.strictObject({
  cols: z.number().int().min(2).max(500),
  rows: z.number().int().min(1).max(300),
});
export const terminalSummarySchema = z.strictObject({
  id: terminalIdSchema,
  number: z.number().int().positive(),
  shared: z.boolean(),
  running: z.boolean(),
  exitCode: z.number().int().optional(),
});
/** `start` counts the characters the host dropped before `output`; it only grows as the buffer trims its head. */
export const terminalSnapshotSchema = terminalSummarySchema.extend({
  output: z.string().max(262144),
  start: z.number().int().nonnegative(),
});
export type TerminalSummary = z.infer<typeof terminalSummarySchema>;
export type TerminalSnapshot = z.infer<typeof terminalSnapshotSchema>;
