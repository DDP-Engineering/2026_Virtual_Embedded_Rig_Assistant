import { readDocSchema, searchDocsSchema } from "../knowledge/search.js";
import type { ToolDefinition } from "./context.js";
export const searchDocsTool: ToolDefinition = {
  name: "search_docs",
  class: "read",
  description:
    "Search indexed workbench documents. Use English terms over English documents; returns precise refs, snippets and scores.",
  params: searchDocsSchema,
  execute: async (ctx, args, signal) => {
    if (!ctx.knowledge)
      return { results: [], message: "No documents indexed yet. Use grep to search text files." };
    return ctx.knowledge.search(searchDocsSchema.parse(args), signal);
  },
};
export const readDocTool: ToolDefinition = {
  name: "read_doc",
  class: "read",
  description:
    "Read extracted PDF pages, a heading slug or text lines. Returns complete locator units and an exact ref, at most12000 characters.",
  params: readDocSchema,
  execute: async (ctx, args, signal) => {
    if (!ctx.knowledge) throw Error("Document index unavailable. Use read/grep or index documents.");
    return ctx.knowledge.read(readDocSchema.parse(args), signal);
  },
};
