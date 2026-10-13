import { skillNameSchema } from "@vera/shared";
import { z } from "zod";
import type { ToolDefinition } from "./context.js";
export const loadSkillTool: ToolDefinition = {
  name: "load_skill",
  class: "read",
  description:
    "Load an enabled skill's Markdown instructions, or an extra text file relative to that skill folder.",
  params: z.strictObject({ name: skillNameSchema, file: z.string().min(1).max(1024).optional() }),
  async execute(ctx, raw, signal) {
    const args = loadSkillTool.params.parse(raw) as { name: string; file?: string };
    if (!ctx.skills) throw Error("Skill catalog is unavailable.");
    return ctx.skills.load(args.name, args.file, signal);
  },
};
