import { z } from "zod";
import { workbenchIdSchema } from "./workbench.js";
export const SKILL_BYTES = 256 * 1024;
export const skillNameSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
export const skillSourceSchema = z.enum(["workbench", "user", "plugin", "official"]);
/** Sources the user can open, create and save; plugin skills belong to the installed plugin. */
export const skillEditableSourceSchema = z.enum(["workbench", "user"]);
export const skillErrorSchema = z.enum(["name", "description", "frontmatter", "unavailable"]);
export const skillSummarySchema = z.strictObject({
  name: z.string().min(1).max(255),
  source: skillSourceSchema,
  /** The plugin id of a plugin skill. */
  plugin: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .optional(),
  description: z.string().max(1024),
  enabled: z.boolean(),
  error: skillErrorSchema.optional(),
});
export const skillsScopeSchema = z.strictObject({
  workbenchId: workbenchIdSchema,
});
export const skillTargetSchema = skillsScopeSchema.extend({
  name: z.string().min(1).max(255),
  source: skillEditableSourceSchema,
});
export const skillContentSchema = z.strictObject({
  content: z.string().max(SKILL_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;
export type SkillSource = z.infer<typeof skillSourceSchema>;
export function skillTemplate(name: string): string {
  return `---\nname: ${skillNameSchema.parse(name)}\ndescription: Describe what this skill does and when to use it.\n---\n# ${name}\n\n## Procedure\n1. Read relevant workbench evidence.\n2. Answer with citations.\n`;
}
