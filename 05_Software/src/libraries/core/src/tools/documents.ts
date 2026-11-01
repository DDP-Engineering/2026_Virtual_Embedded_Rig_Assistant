import { readDocSchema, searchDocsSchema } from "../knowledge/search.js";
import type { ToolDefinition } from "./context.js";
export const searchDocsTool: ToolDefinition = {
  name: "search_docs",
  class: "read",
  description:
    "Search indexed workbench documents. Use English terms over English documents; returns precise refs, snippets and scores. Omit k and mode to use the workbench's retrieval settings.",
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
    'Read extracted PDF pages or presentation slides (page, pageEnd), a heading slug (Markdown, HTML, Word/OpenDocument headings, spreadsheet sheets; "" for text before the first heading) or text lines. Returns complete locator units and an exact ref, at most 12000 characters. A longer heading section returns part 1 of parts with truncated; pass part to read the next one.',
  params: readDocSchema,
  execute: async (ctx, args, signal) => {
    if (!ctx.knowledge) throw Error("Document index unavailable. Use read/grep or index documents.");
    return ctx.knowledge.read(readDocSchema.parse(args), signal);
  },
};
