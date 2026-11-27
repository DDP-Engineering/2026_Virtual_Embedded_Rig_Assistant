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
  INVALID: "The skill or its requested file is invalid. Check the skill metadata and that the file is text.",
  CONFLICT: "The skill changed while it was being read. Start again from its first page.",
} as const;

/**
 * The call the model plainly meant: a skill name in another letter case or with spaces or underscores,
 * and a file written the way SKILL.md cites it, with a leading `./`.
 */
function repairSkillCall(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const call = raw as { name?: unknown; file?: unknown };
  return {
    ...call,
    ...(typeof call.name === "string" && {
      name: call.name
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-"),
    }),
    ...(typeof call.file === "string" && {
      file: call.file.replace(/^(?:\.[\\/])+/, "").replace(/([\\/])(?:\.[\\/])+/g, "$1"),
    }),
  };
}

export const loadSkillTool: ToolDefinition = {
  name: "load_skill",
  class: "read",
  description:
    "Load an enabled skill's Markdown instructions, or an extra text file relative to that skill folder. If nextOffset is present, call again with the same name and file and offset set to nextOffset before using the instructions.",
  params,
  repair: repairSkillCall,
  async execute(ctx, raw, signal) {
    const { name, file, offset } = params.parse(raw);
    const skills = ctx.skills;
    if (!skills) throw Error("Skill catalog is unavailable.");
    try {
      const { text, ...metadata } = await skills.load(name, file, signal);
      return textPage(ctx, metadata, text, offset);
    } catch (error) {
      signal.throwIfAborted();
      const known = veraErrorSchema.safeParse(error).data;
      if (known?.messageKey === "skills.disabled")
        return { isError: true, code: "DENIED", error: "This skill is disabled in the workbench." };
      // A missing file is a system error from reading it; a missing skill is the catalog's own answer.
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT")
        return {
          isError: true,
          code: "NOT_FOUND",
          error: file
            ? `Skill ${name} has no file ${file}. Use a path its instructions name, relative to the skill folder.`
            : `Skill ${name} has no SKILL.md.`,
        };
      if (known?.code === "NOT_FOUND") {
        const enabled = await skills.metadata().catch(() => []);
        signal.throwIfAborted();
        return {
          isError: true,
          code: "NOT_FOUND",
          error: `There is no skill ${name}. Enabled skills: ${enabled.map((skill) => skill.name).join(", ") || "none"}.`,
        };
      }
      const code = known?.code;
      if (code === "DENIED" || code === "INVALID" || code === "CONFLICT")
        return { isError: true, code, error: skillErrors[code] };
      if (error instanceof Error && ["frontmatter", "description", "name"].includes(error.message))
        return { isError: true, code: "INVALID", error: skillErrors.INVALID };
      throw error;
    }
  },
};
