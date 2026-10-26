import { z } from "zod";
import type { ToolDefinition } from "./context.js";

export const grepParams = z.strictObject({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
  glob: z.string().min(1).optional(),
  ignoreCase: z.boolean().optional(),
  context: z.number().int().min(0).max(5).optional(),
  output: z.enum(["content", "files", "count"]).optional(),
  maxResults: z.number().int().min(1).max(500).optional(),
});
export const grepTool: ToolDefinition = {
  name: "grep",
  class: "read",
  description:
    "Search allowed text files with a JavaScript regex in an isolated worker;10 second deadline, up to500 matches.",
  params: grepParams,
  async execute(ctx, raw, signal) {
    const args = grepParams.parse(raw);
    if (!ctx.workers) throw Error("Grep worker host is unavailable.");
    const result = await ctx.workers.run({ root: ctx.root, args }, signal);
    if (result.error) throw Error(result.error);
    if (result.reason === "aborted") throw Error("Grep aborted.");
    const metadata = { truncated: result.truncated, ...(result.reason ? { reason: result.reason } : {}) };
    if (args.output === "files")
      return { paths: [...new Set(result.matches.map((match) => match.path))], ...metadata };
    if (args.output === "count") {
      const counts = new Map<string, number>();
      for (const match of result.matches) counts.set(match.path, (counts.get(match.path) ?? 0) + 1);
      return { counts: [...counts].map(([path, count]) => ({ path, count })), ...metadata };
    }
    return { matches: result.matches, ...metadata };
  },
};
