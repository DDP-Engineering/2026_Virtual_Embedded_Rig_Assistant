import { z } from "zod";
import type { ToolDefinition } from "./context.js";
import { toolPathGuard } from "./context.js";
import { discoverFiles } from "./discovery.js";

export const globTool: ToolDefinition = {
  name: "glob",
  class: "read",
  description: "Find allowed workbench files, newest first, up to500 paths.",
  params: z.strictObject({ pattern: z.string().min(1), path: z.string().min(1).optional() }),
  async execute(ctx, raw, signal) {
    const args = globTool.params.parse(raw) as { pattern: string; path?: string };
    const guard = await toolPathGuard(ctx, true);
    const files = await discoverFiles(guard, args.path ?? ".", args.pattern, signal);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
    guard.assertAuthorized();
    return { paths: files.slice(0, 500).map((file) => file.path), truncated: files.length > 500 };
  },
};
