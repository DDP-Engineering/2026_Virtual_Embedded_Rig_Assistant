import { z } from "zod";
import type { ToolDefinition } from "./context.js";
import { toolLimit, toolPathGuard } from "./context.js";
import { discoverFiles } from "./discovery.js";

/**
 * Files examined at most: the largest Glob results value, so a huge tree costs a bounded number of file
 * checks while any configured count can still be returned.
 */
const DISCOVERED = 5000;

export const globTool: ToolDefinition = {
  name: "glob",
  class: "read",
  description:
    "Find allowed workbench files, newest first, up to the configured number of paths. A pattern without a slash, such as *.log, matches at any depth.",
  params: z.strictObject({
    pattern: z.string().min(1).describe("Glob such as *.log, src/**/*.c or docs/*.pdf."),
    path: z
      .string()
      .min(1)
      .optional()
      .describe("Folder to search in or a file that must match the glob. Defaults to the workbench."),
  }),
  async execute(ctx, raw, signal) {
    const args = globTool.params.parse(raw) as { pattern: string; path?: string };
    const guard = await toolPathGuard(ctx, true);
    // Past the cap the result is the newest of the files examined and is marked truncated like any cut list.
    const files = await discoverFiles(guard, args.path ?? ".", args.pattern, signal, DISCOVERED);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
    guard.assertAuthorized();
    const returned = toolLimit(ctx, "globResults"); // REQ-FUNC-da830c44
    // Reaching the examined cap also means more files may match than were seen.
    const truncated = files.length > returned || files.length >= DISCOVERED;
    return { paths: files.slice(0, returned).map((file) => file.path), truncated };
  },
};
