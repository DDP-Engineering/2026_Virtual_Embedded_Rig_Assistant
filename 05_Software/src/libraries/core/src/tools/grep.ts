import { advancedSettings } from "@vera/shared";
import { z } from "zod";
import { type ToolDefinition, toolExcludedRoots, toolLimit, toolPathGuard } from "./context.js";

export const grepParams = z.strictObject({
  pattern: z.string().min(1).describe("JavaScript regular expression, matched per line."),
  path: z.string().min(1).optional().describe("Folder or single file to search; default is the workbench."),
  glob: z
    .string()
    .min(1)
    .optional()
    .describe("File name filter, including when path selects one file. Examples are *.log and src/**/*.c."),
  ignoreCase: z.boolean().optional(),
  context: z.number().int().min(0).max(5).optional().describe("Lines shown before and after each match."),
  output: z
    .enum(["content", "files", "count"])
    .optional()
    .describe(
      "content: matching lines (default); files: matching paths; count: complete matching-line totals per file.",
    ),
  // Up to the setting's largest value; the session's Grep results caps it (REQ-FUNC-0df8e905).
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(advancedSettings.grepResults.max)
    .optional()
    .describe("Maximum matching lines for content, or matching files for files and count."),
});
export const grepTool: ToolDefinition = {
  name: "grep",
  class: "read",
  description:
    "Search allowed text files with a JavaScript regex. path is a folder or one file; glob filters names (*.log matches at any depth). skippedFiles counts files not searched because they are too large or binary.",
  params: grepParams,
  async execute(ctx, raw, signal) {
    const parsed = grepParams.parse(raw);
    if (!ctx.workers) throw Error("Grep worker host is unavailable.");
    const results = toolLimit(ctx, "grepResults");
    const args = { ...parsed, maxResults: Math.min(parsed.maxResults ?? results, results) };
    const guard = await toolPathGuard(ctx, true, { allowRunLogs: true });
    guard.assertAuthorized();
    const result = await ctx.workers.run(
      {
        kind: "grep",
        root: ctx.root,
        args,
        maxFileBytes: toolLimit(ctx, "grepFileMB") * 1024 * 1024,
        excludedRoots: toolExcludedRoots(ctx),
        additionalRoots: guard.additionalRoots,
        ...(guard.scope === "filesystem" ? { scope: "filesystem" as const } : {}),
      },
      signal,
    );
    guard.assertAuthorized();
    if (result.error) throw Error(result.error);
    if (result.reason === "aborted") throw Error("Grep aborted.");
    const metadata = {
      truncated: result.truncated,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.skipped ? { skippedFiles: result.skipped } : {}),
    };
    if (parsed.output === "files")
      return { paths: (result.files ?? []).map((file) => file.path), ...metadata };
    if (parsed.output === "count") return { counts: result.files ?? [], ...metadata };
    return { matches: result.matches, ...metadata };
  },
};
