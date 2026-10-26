import { Type } from "typebox";
import { z } from "zod";
import type { ToolSpec } from "../llm/gateway.js";
import type { ToolDef } from "./types.js";

/** VERA schemas remain zod; pi receives only their JSON Schema projection. */
export function toolSpecs(tools: ToolDef[]): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: Type.Unsafe(JSON.parse(JSON.stringify(z.toJSONSchema(tool.params)))) as unknown as Record<
      string,
      unknown
    >,
  }));
}
