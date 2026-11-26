import type { Dirent } from "node:fs";
import { lstat, opendir } from "node:fs/promises";
import { z } from "zod";
import type { GuardedPath } from "../workbench/path-guard.js";
import type { ToolDefinition } from "./context.js";
import { toolLimit, toolPathGuard } from "./context.js";
import { entryDisappeared, resolveDiscoveryPath } from "./discovery.js";

/** Upper bound in addition to the response size. */
const LISTED = 5000;

export const listTool: ToolDefinition = {
  name: "list",
  class: "read",
  description: "List allowed workbench entries, with directory depth 1 to 3.",
  params: z.strictObject({
    path: z.string().min(1).optional(),
    depth: z.number().int().min(1).max(3).optional(),
  }),
  async execute(ctx, raw, signal) {
    const args = listTool.params.parse(raw) as { path?: string; depth?: number };
    const guard = await toolPathGuard(ctx, true);
    const { target: base, info } = await resolveDiscoveryPath(guard, args.path ?? ".", signal);
    if (!info.isDirectory()) throw Error("List path must be a directory.");
    const entries: { name: string; type: "file" | "directory"; bytes: number }[] = [];
    let remaining = toolLimit(ctx, "toolResultChars") - JSON.stringify({ entries, truncated: true }).length;
    let truncated = false;
    const walk = async (path: string, depth: number, top = false) => {
      signal.throwIfAborted();
      const items: Dirent[] = [];
      try {
        const folder = top ? base : await guard.resolve(path);
        const directory = await opendir(folder.absolute, { bufferSize: 256 });
        for await (const item of directory) {
          signal.throwIfAborted();
          items.push(item);
        }
      } catch (error) {
        if (!top && entryDisappeared(error)) return;
        throw error;
      }
      signal.throwIfAborted();
      for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
        if (truncated) return;
        signal.throwIfAborted();
        if (item.isSymbolicLink() || (!item.isFile() && !item.isDirectory())) continue;
        const relative = path === "." ? item.name : `${path}/${item.name}`;
        let target: GuardedPath;
        try {
          target = await guard.resolve(relative);
        } catch {
          continue;
        }
        const info = await lstat(target.absolute).catch((error) => {
          if (entryDisappeared(error)) return undefined;
          throw error;
        });
        if (!info || (!info.isFile() && !info.isDirectory())) continue;
        const type = info.isDirectory() ? "directory" : "file";
        const entry: (typeof entries)[number] = {
          name: target.relative,
          type,
          bytes: type === "directory" ? 0 : info.size,
        };
        remaining -= JSON.stringify(entry).length + (entries.length ? 1 : 0);
        if (entries.length >= LISTED || remaining < 0) {
          truncated = true;
          return;
        }
        entries.push(entry);
        if (type === "directory" && depth > 1) await walk(target.relative, depth - 1);
      }
    };
    await walk(base.relative, args.depth ?? 1, true);
    signal.throwIfAborted();
    guard.assertAuthorized();
    return { entries, ...(truncated ? { truncated: true } : {}) };
  },
};
