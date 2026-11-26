import { isAbsolute } from "node:path";
import { advancedSettings, formatLineRef, parseLineRef } from "@vera/shared";
import { z } from "zod";
import type { ToolDefinition } from "./context.js";
import { toolLimit, toolPathGuard } from "./context.js";
import { readWindow } from "./read-window.js";

export const readTool: ToolDefinition = {
  name: "read",
  class: "read",
  description:
    "Read numbered text lines from a workbench file, within the configured line and text limits; use read_doc for PDFs.",
  params: z.strictObject({
    path: z.string().min(1).describe("Workbench-relative file path."),
    offset: z.number().int().min(1).optional().describe("First line to read, starting at 1."),
    // Up to the setting's largest value; the session's Read window lines caps it (REQ-FUNC-150dcb0b).
    limit: z
      .number()
      .int()
      .min(1)
      .max(advancedSettings.readLines.max)
      .optional()
      .describe("Number of lines to read."),
  }),
  async execute(ctx, raw, signal) {
    const args = readTool.params.parse(raw) as { path: string; offset?: number; limit?: number };
    const guard = await toolPathGuard(ctx, true, { allowRunLogs: true });
    const target = await guard.resolve(args.path);
    if (/\.pdf$/i.test(target.relative))
      throw Error(
        "Use read_doc to read PDF documents. A PDF that read_doc reports as not indexed cannot be read yet: tell the user to add its folder under Edit workbench > Documents, or wait for indexing to finish.",
      );
    const offset = args.offset ?? 1;
    const lines = toolLimit(ctx, "readLines");
    const file = await readWindow(guard, args.path, offset, Math.min(args.limit ?? lines, lines), signal, {
      maxChars: toolLimit(ctx, "readChars"),
    });
    const end = file.selected.at(-1)?.line;
    const ref =
      end && (!isAbsolute(file.target.relative) || parseLineRef(`${file.target.relative}#L${offset}-L${end}`))
        ? formatLineRef({ path: file.target.relative, start: offset, end })
        : undefined;
    guard.assertAuthorized();
    ctx.lastReads.set(file.target.key, { sha256: file.sha256, mtimeMs: file.mtimeMs });
    return {
      text: file.selected.map((line) => `${line.line}: ${line.text}`).join("\n"),
      ...(isAbsolute(file.target.relative) ? { path: file.target.relative } : {}),
      totalLines: file.totalLines,
      truncated: file.truncated,
      ...(ref ? { ref } : {}),
    };
  },
};
