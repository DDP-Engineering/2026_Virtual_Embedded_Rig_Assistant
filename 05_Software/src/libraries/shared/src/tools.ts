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
  "run_command",
  "program_output",
  "program_stop",
  "terminal_read",
  "plugin_validate",
  "plugin_install",
  "apply_candidate",
  "electrical_model",
  "electrical_model_change",
  "industrial_catalog",
  "electrical_network",
  "protection_coordination",
  "motor_drives",
  "power_quality",
  "lighting_design",
  "help",
] as const;

export type BuiltinToolName = (typeof builtinToolNames)[number];

/** Shared configuration dependencies; runtime hosts still enforce loading, trust and permissions. */
export const electricalModelToolNames = ["electrical_model", "electrical_model_change"] as const;
export const electricalModelEcosystems: readonly string[] = ["electrical", "automation"];
export const electricalPluginTools = {
  industrial_catalog: "industrial-catalog",
  electrical_network: "electrical-network",
  protection_coordination: "protection-coordination",
  motor_drives: "motor-drives",
  power_quality: "power-quality-pfc",
  lighting_design: "lighting-design",
} as const;

export const pluginToolProviders = {
  ...electricalPluginTools,
  apply_candidate: "kicad-layout",
  parts_search: "parts-search",
} as const;
export type PluginToolName = keyof typeof pluginToolProviders;
export const pluginToolNames = Object.keys(pluginToolProviders) as PluginToolName[];
export const officialPluginToolNames: readonly PluginToolName[] = ["apply_candidate", "parts_search"];
export const coreToolNames = builtinToolNames.filter(
  (name) =>
    !pluginToolNames.includes(name as PluginToolName) &&
    !(electricalModelToolNames as readonly string[]).includes(name),
);
