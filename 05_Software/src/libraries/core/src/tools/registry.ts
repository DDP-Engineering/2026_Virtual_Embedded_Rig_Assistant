import type { ImageContent } from "@earendil-works/pi-ai";
import { type BuiltinToolName, builtinToolNames, delegatedSessionToolNames } from "@vera/shared";
import { toolSpecs } from "../agent/tool.js";
import type { ToolDef } from "../agent/types.js";
import { industrialCatalogTool } from "../electrical/catalog-tool.js";
import { lightingDesignTool } from "../electrical/lighting-tool.js";
import { motorDrivesTool } from "../electrical/motor-drives-tool.js";
import { electricalNetworkTool } from "../electrical/network-tool.js";
import { powerQualityTool } from "../electrical/power-quality-tool.js";
import { protectionCoordinationTool } from "../electrical/protection-tool.js";
import { electricalModelChangeTool, electricalModelTool } from "../electrical/tools.js";
import { pluginInstallTool, pluginValidateTool } from "../plugins/authoring.js";
import { runCommandTool } from "../plugins/command-tools.js";
import { programOutputTool, programStopTool, runProgramTool } from "../plugins/program-tools.js";
import { applyCandidateTool } from "./apply-candidate.js";
import { artifactSaveTool } from "./artifact-save.js";
import type { ToolContext, ToolDefinition } from "./context.js";
import { toolLimit, toolSignal } from "./context.js";
import { decodeRegisterTool } from "./decode-register.js";
import { delegatedSessionTools } from "./delegated-sessions.js";
import { readDocTool, searchDocsTool } from "./documents.js";
import { editTool } from "./edit.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { helpTool } from "./help.js";
import { listTool } from "./list.js";
import { loadSkillTool } from "./load-skill.js";
import { parseLogTool } from "./parse-log.js";
import { partsSearchTool } from "./parts.js";
import { readTool } from "./read.js";
import { terminalReadTool } from "./terminal-read.js";
import { todoTool } from "./todo.js";
import { viewImageTool } from "./view-image.js";
import { webReadTool, webSearchTool } from "./web.js";
import { webDownloadTool } from "./web-download.js";
import { writeTool } from "./write.js";

const builtinDefinitions: Record<BuiltinToolName, ToolDefinition> = {
  terminal_read: terminalReadTool,
  read: readTool,
  view_image: viewImageTool,
  list: listTool,
  glob: globTool,
  grep: grepTool,
  parse_log: parseLogTool,
  decode_register: decodeRegisterTool,
  write: writeTool,
  edit: editTool,
  artifact_save: artifactSaveTool,
  todo: todoTool,
  search_docs: searchDocsTool,
  read_doc: readDocTool,
  load_skill: loadSkillTool,
  web_search: webSearchTool,
  web_read: webReadTool,
  web_download: webDownloadTool,
  parts_search: partsSearchTool,
  run_program: runProgramTool,
  run_command: runCommandTool,
  program_output: programOutputTool,
  program_stop: programStopTool,
  plugin_validate: pluginValidateTool,
  plugin_install: pluginInstallTool,
  apply_candidate: applyCandidateTool,
  electrical_model: electricalModelTool,
  electrical_model_change: electricalModelChangeTool,
  industrial_catalog: industrialCatalogTool,
  electrical_network: electricalNetworkTool,
  protection_coordination: protectionCoordinationTool,
  motor_drives: motorDrivesTool,
  power_quality: powerQualityTool,
  lighting_design: lightingDesignTool,
  help: helpTool,
};
// Identity also excludes host-provided definitions reusing a built-in name.
const delegatedInspectionTools: ReadonlySet<ToolDefinition> = new Set([
  readTool,
  listTool,
  globTool,
  grepTool,
  parseLogTool,
  decodeRegisterTool,
  searchDocsTool,
  readDocTool,
]);

/** Tools offered only when the host composes a program host. */
export const programToolNames: readonly string[] = [
  "run_program",
  "run_command",
  "program_output",
  "program_stop",
];

const delegationNames = new Set<string>(delegatedSessionToolNames);

/** The default Tool result size; sessions resolve their own (REQ-FUNC-f6f79cd2). */
export const TOOL_RESULT_CAP = 32000;

// Leave visible credentials whole so a later masking policy can still recognize them.
function resultPrefix(text: string, limit: number, tokens: readonly string[]): string {
  let cut = limit;
  let previous: number;
  do {
    previous = cut;
    for (const token of tokens) {
      const at = text.indexOf(token, Math.max(0, cut - token.length + 1));
      if (at >= 0 && at < cut) cut = at;
    }
  } while (cut < previous);
  return text.slice(0, cut);
}

export function capToolResult(
  value: Record<string, unknown>,
  protectedStrings: readonly string[] = [],
  limit = TOOL_RESULT_CAP,
) {
  const result = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  let text = JSON.stringify(result);
  let truncated = result.truncated === true;
  if (text.length > limit) {
    truncated = true;
    result.truncated = true;
    const tokens = protectedStrings
      .flatMap((token) => [token, JSON.stringify(token).slice(1, -1)])
      .filter((token) => token.length > 1);
    for (let round = 0; text.length > limit && round < 100; round++) {
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
        : `${resultPrefix(String(item), Math.floor(String(item).length / 2), tokens)}\n[truncated]`;
      if (typeof result.ref === "string" && typeof result.text === "string") {
        const ref = parseLineRef(result.ref);
        const last = [...result.text.matchAll(/(?:^|\n)(\d+): /g)].at(-1);
        if (ref && last) result.ref = formatLineRef({ ...ref, end: Number(last[1]) });
      }
      text = JSON.stringify(result);
    }
    if (text.length > limit) text = '{"truncated":true,"isError":true,"error":"Narrow the request."}';
  }
  return { text, truncated };
}

export interface ToolOutcome {
  text: string;
  image?: ImageContent;
  truncated: boolean;
  isError: boolean;
}
export class ToolRegistry {
  private readonly definitions: readonly ToolDefinition[];
  constructor(
    definitions: readonly ToolDefinition[] = [
      ...builtinToolNames.map((name) => builtinDefinitions[name]),
      ...delegatedSessionTools,
    ],
  ) {
    const names = definitions.map((tool) => tool.name);
    if (new Set(names).size !== names.length) throw Error("Duplicate tool name.");
    this.definitions = [...definitions];
  }
  available(disabled: readonly string[] = []): ToolDefinition[] {
    return this.definitions.filter((tool) => !disabled.includes(tool.name));
  }
  private availableFor(ctx: ToolContext, disabled: readonly string[]): ToolDefinition[] {
    return this.available(disabled).filter((tool) => {
      if (ctx.delegated) return tool.class === "read" && delegatedInspectionTools.has(tool);
      if (delegationNames.has(tool.name)) return !!ctx.delegation && delegatedSessionTools.includes(tool);
      return true;
    });
  }
  private capResult(ctx: ToolContext, name: string, value: Record<string, unknown>) {
    return capToolResult(
      value,
      delegationNames.has(name) ? ctx.delegation?.resultSecrets() : undefined,
      toolLimit(ctx, "toolResultChars"),
    );
  }
  specs(disabled: readonly string[] = []) {
    return toolSpecs(
      this.available(disabled).map(({ name, description, params, class: toolClass }) => ({
        name,
        description,
        params,
        class: toolClass,
        execute: async () => "",
      })),
    );
  }
  async prepare(
    ctx: ToolContext,
    name: string,
    raw: unknown,
    signal: AbortSignal,
    disabled: readonly string[] = [],
  ) {
    signal.throwIfAborted();
    const tool = this.availableFor(ctx, disabled).find((definition) => definition.name === name);
    if (ctx.delegated || !tool?.prepare) throw Error("Prepared tool is unavailable.");
    return tool.prepare(ctx, tool.params.parse(raw), toolSignal(ctx, signal));
  }
  async execute(
    ctx: ToolContext,
    name: string,
    raw: unknown,
    signal: AbortSignal,
    disabled: readonly string[] = [],
    callId?: string,
  ): Promise<ToolOutcome> {
    let result: Awaited<ReturnType<ToolDefinition["execute"]>>;
    let isError = false;
    let effectiveSignal = signal;
    try {
      signal.throwIfAborted();
      const tool = this.availableFor(ctx, disabled).find((definition) => definition.name === name);
      if (!tool) {
        if (name === "parse_log" || name === "decode_register")
          return {
            text: JSON.stringify({
              isError: true,
              code: "DENIED",
              reason: "tool_disabled",
              error: `Enable ${name} in the workbench tools.`,
            }),
            isError: true,
            truncated: false,
          };
        throw Error(`Tool ${name} is unavailable. Choose an enabled tool.`);
      }
      const parsed = tool.params.safeParse(raw);
      if (!parsed.success && (name === "parse_log" || name === "decode_register"))
        return {
          text: JSON.stringify({
            isError: true,
            code: "INVALID",
            reason: "invalid_arguments",
            error:
              name === "parse_log"
                ? "Use a path allowed by the current mode and exactly one profile or pattern; check argument limits."
                : "Supply definitionPath, register and an unsigned decimal/hex string; check argument limits.",
          }),
          isError: true,
          truncated: false,
        };
      if (!parsed.success)
        throw Error(
          `Invalid arguments for ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; ")}`,
        );
      effectiveSignal = toolSignal(ctx, signal);
      result = await tool.execute(ctx, parsed.data, effectiveSignal, callId);
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
      const { image, ...data } = result;
      const capped = this.capResult(ctx, name, data);
      const failed = isError || data.isError === true || JSON.parse(capped.text).isError === true;
      return { ...capped, isError: failed, ...(!failed && image && { image }) };
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
    const blocked = [...disabled, ...(ctx.permissionMode?.() === "read-only" ? ["run_command"] : [])];
    return this.availableFor(ctx, blocked).map((tool) => ({
      name: tool.name,
      class: tool.class,
      description:
        !ctx.delegated &&
        ctx.permissionMode?.() === "bypass" &&
        [
          "read",
          "list",
          "glob",
          "grep",
          "write",
          "edit",
          "parse_log",
          "decode_register",
          "plugin_validate",
          "plugin_install",
          "apply_candidate",
          "run_program",
        ].includes(tool.name)
          ? `${tool.description} Bypass is active: agent input paths may be absolute or relative to the workbench, including outside and ignored locations.`
          : tool.description,
      params: tool.params,
      ...(tool.requiresImages && { requiresImages: true as const }),
      ...(tool.publish
        ? {
            publish: (args: unknown, output: string) => {
              const refreshed = tool.publish?.(ctx, args, output) ?? output;
              return typeof refreshed === "string"
                ? refreshed
                : this.capResult(ctx, tool.name, refreshed).text;
            },
          }
        : {}),
      execute: async (args, signal, callId) => {
        const outcome = await this.execute(ctx, tool.name, args, signal, blocked, callId);
        if (outcome.isError) throw Error(outcome.text);
        return outcome.image ? { text: outcome.text, image: outcome.image } : outcome.text;
      },
    }));
  }
}

import { formatLineRef, parseLineRef } from "@vera/shared";
