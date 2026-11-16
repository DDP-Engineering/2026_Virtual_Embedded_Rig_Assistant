import { isAbsolute } from "node:path";
import { formatLineRef, parseLineRef } from "@vera/shared";
import { z } from "zod";
import type { ToolDefinition } from "./context.js";
import { toolPathGuard } from "./context.js";
import { readWindow } from "./read-window.js";

export const readTool: ToolDefinition = {
  name: "read",
  class: "read",
  description:
    "Read numbered text lines from a workbench file (up to256KiB of selected text); use read_doc for PDFs.",
  params: z.strictObject({
    path: z.string().min(1),
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  }),
  async execute(ctx, raw, signal) {
    const args = readTool.params.parse(raw) as { path: string; offset?: number; limit?: number };
    const guard = await toolPathGuard(ctx, true);
    const target = await guard.resolve(args.path);
    if (/\.pdf$/i.test(target.relative)) throw Error("Use read_doc to read PDF documents.");
    const offset = args.offset ?? 1;
    const file = await readWindow(guard, args.path, offset, args.limit ?? 2000, signal);
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
