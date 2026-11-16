import { z } from "zod";

export const maskingAreaSchema = z.enum(["display", "runs", "agent", "exports"]);
export type MaskingArea = z.infer<typeof maskingAreaSchema>;
/** Defaults used when an app area preference is omitted. */
export const maskingDefaults = Object.freeze({ display: false, runs: false, agent: true, exports: true });
const appMaskSchema = z.strictObject({
  display: z.boolean().optional(),
  runs: z.boolean().optional(),
  agent: z.boolean().optional(),
  exports: z.boolean().optional(),
});
export const appPrivacySchema = z.strictObject({ mask: appMaskSchema.optional() });
export const workbenchMaskingChoiceSchema = z.enum(["default", "on", "off"]);
export type WorkbenchMaskingChoice = z.infer<typeof workbenchMaskingChoiceSchema>;
const workbenchMaskSchema = z.strictObject({
  display: workbenchMaskingChoiceSchema.optional(),
  runs: workbenchMaskingChoiceSchema.optional(),
  agent: workbenchMaskingChoiceSchema.optional(),
  exports: workbenchMaskingChoiceSchema.optional(),
});
export const workbenchPrivacySchema = z.strictObject({ mask: workbenchMaskSchema.optional() });
