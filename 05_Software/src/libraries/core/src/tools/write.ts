import { prepareChange, writeParams } from "./changes.js";
import type { ToolDefinition } from "./context.js";
export const writeTool: ToolDefinition = {
  name: "write",
  class: "write",
  description:
    "Create UTF-8 workbench files and parent folders; read the current version before overwriting. An overwrite keeps the file's CRLF line endings, UTF-8 BOM and Latin-1 encoding. Changes may require approval.",
  params: writeParams,
  prepare: (ctx, args, signal) => prepareChange(ctx, "write", args, signal),
  execute: async (ctx, args, signal) => (await prepareChange(ctx, "write", args, signal)).apply(signal),
};
