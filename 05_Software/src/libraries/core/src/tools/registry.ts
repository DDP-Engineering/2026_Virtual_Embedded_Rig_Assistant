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
import type { WebSource } from "../web/provider.js";
import { applyCandidateTool } from "./apply-candidate.js";
import { artifactSaveTool } from "./artifact-save.js";
import { askUserTool } from "./ask-user.js";
import { browserTools } from "./browser.js";
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
import { wiresharkCaptureTool, wiresharkDeriveTool, wiresharkImportTool } from "./wireshark.js";
import { wiresharkDumpcapStartTool, wiresharkDumpcapTool } from "./wireshark-live.js";
import { writeTool } from "./write.js";

const builtinDefinitions: Record<BuiltinToolName, ToolDefinition> = {
  terminal_read: terminalReadTool,
  ask_user: askUserTool,
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
  wireshark_capture: wiresharkCaptureTool,
  wireshark_derive: wiresharkDeriveTool,
  wireshark_import: wiresharkImportTool,
  wireshark_dumpcap: wiresharkDumpcapTool,
  wireshark_dumpcap_start: wiresharkDumpcapStartTool,
  help: helpTool,
};
// Identity also excludes host-provided definitions reusing a built-in name.
const delegatedTools: ReadonlySet<ToolDefinition> = new Set([
  readTool,
  listTool,
  globTool,
  grepTool,
  parseLogTool,
  decodeRegisterTool,
  searchDocsTool,
  readDocTool,
  writeTool,
  editTool,
  runCommandTool,
  runProgramTool,
  programOutputTool,
  programStopTool,
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

function resultSuffix(text: string, limit: number, tokens: readonly string[]): string {
  let cut = text.length - limit;
  let previous: number;
  do {
    previous = cut;
    for (const token of tokens) {
      const at = text.indexOf(token, Math.max(0, cut - token.length + 1));
      if (at >= 0 && at < cut) cut = at + token.length;
    }
  } while (cut > previous);
  return text.slice(cut).replace(/^[\uDC00-\uDFFF]/, "");
}

function jsonExcerpt(content: string, budget: number, tokens: readonly string[], side: "start" | "end") {
  if (content.length <= budget && JSON.stringify(content).length - 2 <= budget) return content;
  let low = 0;
  let high = Math.min(content.length, budget);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const excerpt = side === "start" ? content.slice(0, middle) : content.slice(-middle);
    if (JSON.stringify(excerpt).length - 2 <= budget) low = middle;
    else high = middle - 1;
  }
  return side === "start"
    ? resultPrefix(content, low, tokens).replace(/[\uD800-\uDBFF]$/, "")
    : resultSuffix(content, low, tokens);
}

/** Reserve space for complete citations before distributing the remaining budget to excerpts. */
function capWebResult(
  result: Record<string, unknown>,
  limit: number,
  tokens: readonly string[],
  page: boolean,
) {
  if (
    !Array.isArray(result.sources) ||
    !result.sources.length ||
    !result.sources.every(
      (source) =>
        typeof source?.url === "string" &&
        typeof source.title === "string" &&
        typeof source.content === "string",
    )
  )
    return undefined;
  const sources: WebSource[] = result.sources;
  const excerpts = sources.map((source) => {
    const content = source.content;
    source.content = "";
    return content;
  });
  // A page window cut here continues where the kept text ends, not where the provider's window ended.
  const start = typeof result.offset === "number" ? result.offset : 0;
  const window = page ? (excerpts[0] ?? "").length : 0;
  const next = result.nextOffset;
  if (page) result.nextOffset = start + window;
  let metadata = JSON.stringify(result);
  while (metadata.length > limit && sources.length > 1) {
    sources.pop();
    metadata = JSON.stringify(result);
  }
  if (metadata.length > limit)
    return '{"truncated":true,"isError":true,"error":"The web citation exceeds the tool result limit."}';
  let remaining = limit - metadata.length;
  for (const [index, source] of sources.entries()) {
    source.content = jsonExcerpt(
      excerpts[index] ?? "",
      Math.floor(remaining / (sources.length - index)),
      tokens,
      "start",
    );
    remaining -= JSON.stringify(source.content).length - 2;
  }
  if (page) {
    const kept = sources[0]?.content.length ?? 0;
    if (kept < window) result.nextOffset = start + kept;
    else if (next === undefined) delete result.nextOffset;
    else result.nextOffset = next;
  }
  return JSON.stringify(result);
}

function capDelegatedReply(result: Record<string, unknown>, limit: number, tokens: readonly string[]) {
  const reply = result.reply;
  if (typeof reply !== "string") return undefined;
  const marker = "\n[truncated]\n";
  const budget = limit - JSON.stringify({ ...result, reply: marker }).length;
  if (budget < 0) return undefined;
  const head = jsonExcerpt(reply, Math.floor(budget / 2), tokens, "start");
  const tail = jsonExcerpt(reply, budget - (JSON.stringify(head).length - 2), tokens, "end");
  return JSON.stringify({ ...result, reply: `${head}${marker}${tail}` });
}

export function capToolResult(
  value: Record<string, unknown>,
  protectedStrings: readonly string[] = [],
  limit = TOOL_RESULT_CAP,
  toolName?: string,
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
    if (toolName === "web_search" || toolName === "web_read") {
      const web = capWebResult(result, limit, tokens, toolName === "web_read");
      if (web !== undefined) return { text: web, truncated };
    }
    if (toolName === "session_status" || toolName === "session_wait") {
      const reply = capDelegatedReply(result, limit, tokens);
      if (reply !== undefined) return { text: reply, truncated };
    }
    const tailKey =
      toolName === "terminal_read"
        ? "text"
        : toolName && programToolNames.includes(toolName)
          ? "output"
          : undefined;
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
      if (best.owner === result && best.key === tailKey && typeof item === "string") {
        result[tailKey] = `[truncated]\n${resultSuffix(item, Math.floor(item.length / 2), tokens)}`;
        text = JSON.stringify(result);
        continue;
      }
      if (toolName === "read" && best.owner === result && best.key === "text" && typeof item === "string") {
        const prefix = resultPrefix(item, Math.floor(item.length / 2), tokens);
        const boundary = item[prefix.length] === "\n" ? prefix.length : prefix.lastIndexOf("\n");
        const page = boundary < 0 ? prefix.replace(/[\uD800-\uDBFF]$/, "") : prefix.slice(0, boundary);
        result.text = page;
        if (boundary < 0) result.lineClipped = true;
        else delete result.lineClipped;
        const last = /^([0-9]+): /.exec(page.slice(page.lastIndexOf("\n") + 1));
        if (last && typeof result.totalLines === "number") {
          const end = Number(last[1]);
          if (end < result.totalLines) result.nextOffset = end + 1;
          else delete result.nextOffset;
          const ref = typeof result.ref === "string" ? parseLineRef(result.ref) : undefined;
          if (ref) result.ref = formatLineRef({ ...ref, end });
        }
        text = JSON.stringify(result);
        continue;
      }
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
  onPublish?: () => void;
  truncated: boolean;
  isError: boolean;
}
export class ToolRegistry {
  private readonly definitions: readonly ToolDefinition[];
  constructor(
    definitions: readonly ToolDefinition[] = [
      ...builtinToolNames.map((name) => builtinDefinitions[name]),
      ...delegatedSessionTools,
      ...browserTools,
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
      if (ctx.delegated) {
        if (!delegatedTools.has(tool)) return false;
        if (
          (ctx.permissionMode?.() ?? "read-only") === "read-only" &&
          (tool.class === "write" || tool === runCommandTool)
        )
          return false;
      }
      if (delegationNames.has(tool.name)) return !!ctx.delegation && delegatedSessionTools.includes(tool);
      return tool.available?.(ctx) ?? true;
    });
  }
  private capResult(ctx: ToolContext, name: string, value: Record<string, unknown>) {
    return capToolResult(
      value,
      delegationNames.has(name) ? ctx.delegation?.resultSecrets() : undefined,
      toolLimit(ctx, "toolResultChars"),
      name,
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
    if (!tool?.prepare) throw Error("Prepared tool is unavailable.");
    return tool.prepare(
      ctx,
      tool.params.parse(tool.repair ? tool.repair(raw) : raw),
      toolSignal(ctx, signal),
    );
  }
  async execute(
    ctx: ToolContext,
    name: string,
    raw: unknown,
    signal: AbortSignal,
    disabled: readonly string[] = [],
    callId?: string,
    deferPublish = false,
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
      const parsed = tool.params.safeParse(tool.repair ? tool.repair(raw) : raw);
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
      // The clarification wait belongs to the turn even if its filesystem permissions change.
      effectiveSignal = tool === askUserTool ? signal : toolSignal(ctx, signal);
      result = await tool.execute(ctx, parsed.data, effectiveSignal, callId, true);
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
      const { image, onPublish, ...data } = result;
      const capped = this.capResult(ctx, name, data);
      const failed = isError || data.isError === true || JSON.parse(capped.text).isError === true;
      const outcome = { ...capped, isError: failed, ...(!failed && image && { image }) };
      if (!failed && onPublish) {
        const publish = () => {
          effectiveSignal.throwIfAborted();
          onPublish();
        };
        if (deferPublish) return { ...outcome, onPublish: publish };
        publish();
      }
      return outcome;
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
      description: tool.description,
      params: tool.params,
      ...(tool.available ? { available: () => tool.available?.(ctx) === true } : {}),
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
        const outcome = await this.execute(ctx, tool.name, args, signal, blocked, callId, true);
        if (outcome.isError) throw Error(outcome.text);
        const { text, image, onPublish } = outcome;
        return image || onPublish ? { text, ...(image && { image }), ...(onPublish && { onPublish }) } : text;
      },
    }));
  }
}

import { formatLineRef, parseLineRef } from "@vera/shared";
