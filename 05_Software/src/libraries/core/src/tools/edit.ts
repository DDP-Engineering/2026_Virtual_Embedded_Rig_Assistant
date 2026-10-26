import { editParams, prepareChange } from "./changes.js";
import type { ToolDefinition } from "./context.js";
export const editTool: ToolDefinition = {
  name: "edit",
  class: "write",
  description:
    "Replace exact text in a freshly read workbench file. Match once, or set replaceAll. Preserves CRLF and UTF-8 BOM; records a diff.",
  params: editParams,
  prepare: (ctx, args, signal) => prepareChange(ctx, "edit", args, signal),
  execute: async (ctx, args, signal) => (await prepareChange(ctx, "edit", args, signal)).apply(signal),
};
