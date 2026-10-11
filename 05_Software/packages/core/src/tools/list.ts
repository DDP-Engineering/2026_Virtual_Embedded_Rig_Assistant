import { lstat, readdir } from "node:fs/promises";
import { z } from "zod";
import { type GuardedPath, PathGuard } from "../workbench/path-guard.js";
import type { ToolDefinition } from "./context.js";

export const listTool: ToolDefinition = {
  name: "list",
  class: "read",
  description: "List allowed workbench entries, with directory depth1 to3.",
  params: z.strictObject({
    path: z.string().min(1).optional(),
    depth: z.number().int().min(1).max(3).optional(),
  }),
  async execute(ctx, raw, signal) {
    const args = listTool.params.parse(raw) as { path?: string; depth?: number };
    const guard = await PathGuard.create(ctx.root);
    const base = await guard.resolve(args.path ?? ".");
    const entries: { name: string; type: "file" | "directory"; bytes: number }[] = [];
    const walk = async (path: string, depth: number) => {
      const folder = await guard.resolve(path);
      for (const item of (await readdir(folder.absolute, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        signal.throwIfAborted();
        if (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory())) continue;
        const relative = path === "." ? item.name : `${path}/${item.name}`;
        let target: GuardedPath;
        try {
          target = await guard.resolve(relative);
        } catch {
          continue;
        }
        const info = await lstat(target.absolute);
        if (info.isSymbolicLink()) continue;
        entries.push({
          name: target.relative,
          type: item.isDirectory() ? "directory" : "file",
          bytes: item.isDirectory() ? 0 : info.size,
        });
        if (item.isDirectory() && depth > 1) await walk(target.relative, depth - 1);
      }
    };
    await walk(base.relative, args.depth ?? 1);
    return { entries };
  },
};
