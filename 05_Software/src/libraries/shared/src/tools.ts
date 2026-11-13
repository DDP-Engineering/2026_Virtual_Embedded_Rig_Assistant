/** Built-in execution catalog shared by the runtime and workbench editor. */
export const builtinToolNames = [
  "read",
  "list",
  "glob",
  "grep",
  "parse_log",
  "decode_register",
  "write",
  "edit",
  "artifact_save",
  "todo",
  "search_docs",
  "read_doc",
  "load_skill",
  "web_search",
  "web_read",
  "web_download",
  "parts_search",
  "run_program",
  "program_output",
  "program_stop",
  "plugin_validate",
  "plugin_install",
] as const;

export type BuiltinToolName = (typeof builtinToolNames)[number];
