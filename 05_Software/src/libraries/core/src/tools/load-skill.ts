import { skillNameSchema, veraErrorSchema } from "@vera/shared";
import { z } from "zod";
import type { ToolDefinition } from "./context.js";
import { textPage } from "./text-page.js";

const params = z.strictObject({
  name: skillNameSchema,
  file: z.string().min(1).max(1024).optional(),
  offset: z.number().int().positive().optional(),
});
const skillErrors = {
  DENIED: "The skill or its requested file is restricted by the workbench's skill rules.",
  NOT_FOUND: "The skill or its requested file is unavailable. Check the enabled skills and the file name.",
  INVALID: "The skill or its requested file is invalid. Check the skill metadata and UTF-8 text.",
  CONFLICT: "The skill changed while it was being read. Start again from its first page.",
} as const;

export const loadSkillTool: ToolDefinition = {
  name: "load_skill",
  class: "read",
  description:
    "Load an enabled skill's Markdown instructions, or an extra text file relative to that skill folder. If nextOffset is present, call again with the same name and file and offset set to nextOffset before using the instructions.",
  params,
  async execute(ctx, raw, signal) {
    const { name, file, offset } = params.parse(raw);
    if (!ctx.skills) throw Error("Skill catalog is unavailable.");
    try {
      const { text, ...metadata } = await ctx.skills.load(name, file, signal);
      return textPage(ctx, metadata, text, offset);
    } catch (error) {
      signal.throwIfAborted();
      const known = veraErrorSchema.safeParse(error).data;
      if (known?.messageKey === "skills.disabled")
        return { isError: true, code: "DENIED", error: "This skill is disabled in the workbench." };
      const code =
        (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ? "NOT_FOUND" : known?.code;
      if (code === "DENIED" || code === "NOT_FOUND" || code === "INVALID" || code === "CONFLICT")
        return { isError: true, code, error: skillErrors[code] };
      if (error instanceof Error && ["frontmatter", "description", "name"].includes(error.message))
        return { isError: true, code: "INVALID", error: skillErrors.INVALID };
      throw error;
    }
  },
};
