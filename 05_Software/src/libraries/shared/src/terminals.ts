import { z } from "zod";
import { advancedSettings } from "./advanced-settings.js";
import { workbenchIdSchema } from "./workbench.js";

export const terminalIdSchema = z.uuid();
export const terminalShellSchema = z.enum(["powershell", "cmd", "bash", "sh"]);
export const terminalInputLimit = 16_384;
const pasteStart = "\x1b[200~";
const pasteEnd = "\x1b[201~";
const wrappedInputLimit = terminalInputLimit + pasteStart.length + pasteEnd.length;

/** Count the paste payload separately from xterm's complete bracketed-paste envelope. */
export function terminalInputTooLong(data: string): boolean {
  return (
    data.length > terminalInputLimit &&
    (data.length > wrappedInputLimit || !data.startsWith(pasteStart) || !data.endsWith(pasteEnd))
  );
}

export const terminalInputSchema = z
  .string()
  .min(1)
  .max(wrappedInputLimit)
  .refine((data) => !terminalInputTooLong(data));

export const commandBlockShellSchema = z.enum(["powershell", "bash"]);
export type CommandBlockShell = z.infer<typeof commandBlockShellSchema>;
export const commandBlockTextSchema = z
  .string()
  .min(1)
  .max(16384)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject terminal controls while preserving tabs and original line endings.
  .refine((text) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text));
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
  shell: terminalShellSchema,
  running: z.boolean(),
  /** Pristine chat shell; it may still be starting. Dispatch must recheck and wait for its prompt. */
  dispatchEligible: z.boolean(),
  exitCode: z.number().int().optional(),
});
export const terminalRevisionSchema = z.strictObject({
  output: z.number().int().nonnegative(),
  /** Zero is raw output. Positive values identify the current masked projection. */
  masking: z.number().int().nonnegative(),
});
/** `start` counts the characters the host dropped before `output`. */
const terminalSnapshotState = terminalSummarySchema.extend({
  start: z.number().int().nonnegative(),
  revision: terminalRevisionSchema,
});
export const terminalSnapshotSchema = terminalSnapshotState.extend({
  output: z.string().max(advancedSettings.terminalBufferK.max * 1024),
});
export const terminalOutputSchema = z.union([
  terminalSnapshotSchema,
  terminalSnapshotState.extend({ unchanged: z.literal(true), output: z.literal("") }),
]);
export type TerminalSummary = z.infer<typeof terminalSummarySchema>;
export type TerminalSnapshot = z.infer<typeof terminalSnapshotSchema>;
export type TerminalRevision = z.infer<typeof terminalRevisionSchema>;
export type TerminalOutput = z.infer<typeof terminalOutputSchema>;
