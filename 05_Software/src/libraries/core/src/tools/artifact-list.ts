import { type ArtifactSummary, formatArtifactRef, portableArtifactText } from "@vera/shared";
import { z } from "zod";
import { type ToolDefinition, toolLimit } from "./context.js";

const maxPage = 20;
const params = z.strictObject({
  namePrefix: z
    .string()
    .min(1)
    .max(100)
    .refine((text) => !/[^A-Za-z0-9._-]/.test(text), "Use letters, digits, dot, underscore or hyphen.")
    .optional()
    .describe("Part of the filename; it matches anywhere in the name, in any letter case."),
  offset: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - maxPage)
    .default(0),
  limit: z.number().int().min(1).max(maxPage).default(10),
});

/**
 * The filter as the model remembers the name: with the spaces and accents the artifact was asked to be
 * saved under, which saving replaced. An empty filter means none.
 */
function repairListCall(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const { namePrefix, ...rest } = raw as { namePrefix?: unknown };
  if (typeof namePrefix !== "string") return raw;
  const text = portableArtifactText(namePrefix.trim()).slice(0, 100);
  return text ? { ...rest, namePrefix: text } : rest;
}

export const artifactListTool: ToolDefinition = {
  name: "artifact_list",
  class: "read",
  description:
    "Find saved reports and other artifacts in this session, newest first. Filter by part of a filename if useful. Continue with nextOffset. Use read with the returned artifact reference to inspect its content before citing it.",
  params,
  repair: repairListCall,
  available: (ctx) => !!ctx.artifacts,
  async execute(ctx, raw, signal) {
    if (!ctx.artifacts) throw Error("Session artifact storage is unavailable.");
    const { namePrefix = "", offset, limit } = params.parse(raw);
    signal.throwIfAborted();
    const rows = ctx.artifacts.store.list(ctx.artifacts.sessionId, {
      nameContains: namePrefix,
      offset,
      limit: limit + 1,
    });
    const artifacts: (Pick<ArtifactSummary, "name" | "description" | "createdAt"> & { ref: string })[] = [];
    let remaining =
      toolLimit(ctx, "toolResultChars") - JSON.stringify({ artifacts, nextOffset: offset + limit }).length;
    for (const { name, description, createdAt } of rows.slice(0, limit)) {
      const entry = {
        name,
        ref: formatArtifactRef(name),
        description:
          description === null
            ? null
            : (ctx.maskText?.(description) ?? description).slice(0, 256).replace(/[\uD800-\uDBFF]$/, ""),
        createdAt,
      };
      remaining -= JSON.stringify(entry).length + Number(artifacts.length > 0);
      if (remaining < 0) break;
      artifacts.push(entry);
    }
    if (rows.length && !artifacts.length)
      throw Error("An artifact description exceeds the tool result limit.");
    // No match is not "nothing saved": say how many artifacts the session has under other names.
    const others =
      namePrefix && !rows.length && !offset ? ctx.artifacts.store.count(ctx.artifacts.sessionId) : 0;
    return {
      artifacts,
      ...(artifacts.length < rows.length && { nextOffset: offset + artifacts.length }),
      ...(others > 0 && { savedInSession: others }),
    };
  },
};
