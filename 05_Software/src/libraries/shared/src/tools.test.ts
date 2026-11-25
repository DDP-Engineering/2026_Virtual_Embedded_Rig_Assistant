import { expect, it } from "vitest";
import {
  builtinToolNames,
  coreToolNames,
  electricalModelToolNames,
  pluginToolNames,
  pluginToolProviders,
} from "./tools.js";

it("assigns every built-in tool to exactly one configuration location", () => {
  const classified = [...coreToolNames, ...electricalModelToolNames, ...pluginToolNames];
  expect(classified.toSorted()).toEqual([...builtinToolNames].sort());
  expect(new Set(classified).size).toBe(classified.length);
  expect(coreToolNames).toEqual(
    expect.arrayContaining([
      "read",
      "grep",
      "write",
      "search_docs",
      "read_doc",
      "load_skill",
      "help",
      "todo",
      "run_program",
      "run_command",
      "program_output",
      "program_stop",
      "terminal_read",
      "plugin_install",
      "plugin_validate",
    ]),
  );
});

it("associates specialized tools with their providers, including parts and KiCad candidates", () => {
  expect(pluginToolProviders).toEqual({
    industrial_catalog: "industrial-catalog",
    electrical_network: "electrical-network",
    protection_coordination: "protection-coordination",
    motor_drives: "motor-drives",
    power_quality: "power-quality-pfc",
    lighting_design: "lighting-design",
    apply_candidate: "kicad-layout",
    parts_search: "parts-search",
    wireshark_capture: "wireshark-tshark",
    wireshark_import: "wireshark-tshark",
  });
  expect(electricalModelToolNames).toEqual(["electrical_model", "electrical_model_change"]);
});
