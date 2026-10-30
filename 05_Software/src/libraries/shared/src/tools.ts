/** Built-in execution catalog shared by the runtime and workbench editor. */
export const builtinToolNames = [
  "read",
  "list",
  "glob",
  "grep",
  "write",
  "edit",
  "artifact_save",
  "todo",
  "search_docs",
  "read_doc",
  "load_skill",
  "web_search",
  "web_read",
] as const;

export type BuiltinToolName = (typeof builtinToolNames)[number];
