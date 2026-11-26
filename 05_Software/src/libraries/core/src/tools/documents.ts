import { readDocSchema, searchDocsSchema } from "../knowledge/search.js";
import { type ToolDefinition, toolExcludedRoots, toolLimit } from "./context.js";
export const searchDocsTool: ToolDefinition = {
  name: "search_docs",
  class: "read",
  description:
    "Search indexed workbench documents. Returns precise refs, snippets, scores, index coverage and the actual ranking mode. Partial coverage can miss pending sources. A multilingual model can match across languages. Omit k and mode to use the workbench's retrieval settings.",
  params: searchDocsSchema,
  execute: async (ctx, args, signal) => {
    if (!ctx.knowledge)
      return {
        results: [],
        coverage: "unknown",
        usage: { mode: null, reason: "index-not-ready" },
        message: "No documents indexed yet. Use grep to search text files.",
      };
    return ctx.knowledge.search(searchDocsSchema.parse(args), signal, toolExcludedRoots(ctx));
  },
};
export const readDocTool: ToolDefinition = {
  name: "read_doc",
  class: "read",
  description:
    'Read extracted PDF pages or presentation slides (page, pageEnd), a heading slug (Markdown, HTML, Word/OpenDocument headings, spreadsheet sheets; "" for text before the first heading), or text lines. Read each part through parts. For a truncated range, then continue after the last page or line in ref.',
  params: readDocSchema,
  execute: async (ctx, args, signal) => {
    if (!ctx.knowledge) throw Error("Document index unavailable. Use read/grep or index documents.");
    return ctx.knowledge.read(readDocSchema.parse(args), signal, toolExcludedRoots(ctx), {
      limit: toolLimit(ctx, "toolResultChars"),
      maskText: ctx.maskDocumentText,
    });
  },
};
