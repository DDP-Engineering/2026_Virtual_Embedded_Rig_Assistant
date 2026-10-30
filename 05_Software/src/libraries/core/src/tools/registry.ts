import { type BuiltinToolName, builtinToolNames } from "@vera/shared";
import { toolSpecs } from "../agent/tool.js";
import type { ToolDef } from "../agent/types.js";
import { artifactSaveTool } from "./artifact-save.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import { toolSignal } from "./context.js";
import { readDocTool, searchDocsTool } from "./documents.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { listTool } from "./list.js";
import { loadSkillTool } from "./load-skill.js";
import { readTool } from "./read.js";
import { todoTool } from "./todo.js";
import { writeTool } from "./write.js";

const builtinDefinitions: Record<BuiltinToolName, ToolDefinition> = {
  read: readTool,
  list: listTool,
  glob: globTool,
  grep: grepTool,
  write: writeTool,
  edit: editTool,
  artifact_save: artifactSaveTool,
  todo: todoTool,
  search_docs: searchDocsTool,
  read_doc: readDocTool,
  load_skill: loadSkillTool,
};

export const TOOL_RESULT_CAP = 32000;
export function capToolResult(value: Record<string, unknown>) {
  const result = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  let text = JSON.stringify(result);
  let truncated = result.truncated === true;
  if (text.length > TOOL_RESULT_CAP) {
    truncated = true;
    result.truncated = true;
    for (let round = 0; text.length > TOOL_RESULT_CAP && round < 100; round++) {
      let best: { owner: Record<string, unknown>; key: string; size: number } | undefined;
      const visit = (owner: Record<string, unknown>) => {
        for (const [key, item] of Object.entries(owner)) {
          const shrinkable =
            (typeof item === "string" && item.length > 32 && key !== "ref" && key !== "path") ||
            (Array.isArray(item) && item.length > 0);
          const size = shrinkable ? JSON.stringify(item).length : 0;
          if (size > (best?.size ?? 0)) best = { owner, key, size };
          if (item && typeof item === "object" && !Array.isArray(item))
            visit(item as Record<string, unknown>);
        }
      };
      visit(result);
      if (!best) {
        text = JSON.stringify({
          truncated: true,
          isError: true,
          error: "Tool result exceeds the output limit. Narrow the request.",
        });
        break;
      }
      const item = best.owner[best.key];
      best.owner[best.key] = Array.isArray(item)
        ? item.slice(0, Math.floor(item.length / 2))
        : `${String(item).slice(0, Math.floor(String(item).length / 2))}\n[truncated]`;
      if (typeof result.ref === "string" && typeof result.text === "string") {
        const ref = parseLineRef(result.ref);
        const last = [...result.text.matchAll(/(?:^|\n)(\d+): /g)].at(-1);
        if (ref && last) result.ref = formatLineRef({ ...ref, end: Number(last[1]) });
      }
      text = JSON.stringify(result);
    }
    if (text.length > TOOL_RESULT_CAP)
      text = '{"truncated":true,"isError":true,"error":"Narrow the request."}';
  }
  return { text, truncated };
}

export interface ToolOutcome {
  text: string;
  truncated: boolean;
  isError: boolean;
}
export class ToolRegistry {
  private readonly definitions: readonly ToolDefinition[];
  constructor(
    definitions: readonly ToolDefinition[] = builtinToolNames.map((name) => builtinDefinitions[name]),
  ) {
    const names = definitions.map((tool) => tool.name);
    if (new Set(names).size !== names.length) throw Error("Duplicate tool name.");
    this.definitions = [...definitions];
  }
  available(disabled: readonly string[] = []): ToolDefinition[] {
    return this.definitions.filter((tool) => !disabled.includes(tool.name));
  }
  specs(disabled: readonly string[] = []) {
    return toolSpecs(this.available(disabled).map((tool) => ({ ...tool, execute: async () => "" })));
  }
  async prepare(
    ctx: ToolContext,
    name: string,
    raw: unknown,
    signal: AbortSignal,
    disabled: readonly string[] = [],
  ) {
    signal.throwIfAborted();
    const tool = this.available(disabled).find((definition) => definition.name === name);
    if (!tool?.prepare) throw Error("Prepared write tool is unavailable.");
    return tool.prepare(ctx, tool.params.parse(raw), toolSignal(ctx, signal));
  }
  async execute(
    ctx: ToolContext,
    name: string,
    raw: unknown,
    signal: AbortSignal,
    disabled: readonly string[] = [],
  ): Promise<ToolOutcome> {
    let result: Record<string, unknown>;
    let isError = false;
    let effectiveSignal = signal;
    try {
      signal.throwIfAborted();
      const tool = this.available(disabled).find((definition) => definition.name === name);
      if (!tool) throw Error(`Tool ${name} is unavailable. Choose an enabled tool.`);
      const parsed = tool.params.safeParse(raw);
      if (!parsed.success)
        throw Error(
          `Invalid arguments for ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; ")}`,
        );
      effectiveSignal = toolSignal(ctx, signal);
      result = await tool.execute(ctx, parsed.data, effectiveSignal);
      effectiveSignal.throwIfAborted();
    } catch (error) {
      isError = true;
      result = {
        isError: true,
        error: effectiveSignal.aborted
          ? "Tool aborted."
          : error instanceof Error
            ? error.message
            : "Tool failed. Retry or narrow the request.",
      };
    }
    try {
      const capped = capToolResult(result);
      return {
        ...capped,
        isError: isError || result.isError === true || JSON.parse(capped.text).isError === true,
      };
    } catch {
      return {
        text: '{"isError":true,"error":"Tool result is not valid JSON. Retry or narrow the request."}',
        isError: true,
        truncated: false,
      };
    }
  }
  /** Existing WP10 runtime owns the error-result flag; its catch consumes this bounded JSON. */
  bind(ctx: ToolContext, disabled: readonly string[] = []): ToolDef[] {
    const blocked = [...disabled];
    return this.available(blocked).map((tool) => ({
      name: tool.name,
      class: tool.class,
      description:
        ctx.permissionMode?.() === "bypass" &&
        ["read", "list", "glob", "grep", "write", "edit"].includes(tool.name)
          ? `${tool.description} Bypass is active: ordinary filesystem paths may be absolute or relative to the workbench, including outside and ignored locations.`
          : tool.description,
      params: tool.params,
      execute: async (args, signal) => {
        const outcome = await this.execute(ctx, tool.name, args, signal, blocked);
        if (outcome.isError) throw Error(outcome.text);
        return outcome.text;
      },
    }));
  }
}

import { formatLineRef, parseLineRef } from "@vera/shared";
