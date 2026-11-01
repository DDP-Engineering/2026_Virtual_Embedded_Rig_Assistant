import { z } from "zod";
import { permissionModeSchema } from "./session.js";

export const workbenchIdSchema = z.string().regex(/^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const docs = z.looseObject({
  include: z.array(z.string()).default(["docs/**"]),
  exclude: z.array(z.string()).default([]),
});
export const workbenchEmbeddingsSchema = z
  .strictObject({
    model: z.literal("Xenova/bge-small-en-v1.5").default("Xenova/bge-small-en-v1.5"),
    chunkSize: z.number().int().min(200).max(1400).default(1400),
    overlap: z.number().int().min(0).max(600).default(200),
  })
  .refine((value) => value.overlap < value.chunkSize, {
    message: "Overlap must be smaller than chunk size",
    path: ["overlap"],
  });
const disabled = z.looseObject({ disabled: z.array(z.string().min(1)).default([]) });
/** Plugins run programs, so a workbench enables each one explicitly. */
const plugins = z.looseObject({ enabled: z.array(z.string().min(1)).default([]) });
/** Defaults for the agent's search_docs when it passes no k or mode of its own. */
export const workbenchRetrievalSchema = z.looseObject({
  results: z.number().int().min(1).max(20).default(8),
  mode: z.enum(["hybrid", "keyword", "semantic"]).default("hybrid"),
});
export type WorkbenchRetrieval = Pick<z.infer<typeof workbenchRetrievalSchema>, "results" | "mode">;
const agent = z.looseObject({
  permission_mode: permissionModeSchema.default("ask"),
  model: z
    .string()
    .regex(/^[^/]+\/.+$/)
    .nullable()
    .default(null),
});
export const workbenchSchema = z.looseObject({
  format: z.literal(1),
  id: workbenchIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().optional(),
  embeddings: workbenchEmbeddingsSchema.default({
    model: "Xenova/bge-small-en-v1.5",
    chunkSize: 1400,
    overlap: 200,
  }),
  docs: docs.default({ include: ["docs/**"], exclude: [] }),
  retrieval: workbenchRetrievalSchema.default({ results: 8, mode: "hybrid" }),
  skills: disabled.default({ disabled: [] }),
  tools: disabled.default({ disabled: [] }),
  plugins: plugins.default({ enabled: [] }),
  agent: agent.default({ permission_mode: "ask", model: null }),
});
export type WorkbenchConfig = z.infer<typeof workbenchSchema>;
/** The specified English user-editable starting context. */
export function workbenchTemplate(name: string): string {
  return `# ${name}\n\n## Device under test\nBoard, MCU, revision, key parts.\n\n## Bench setup\nPower, probes, programmers, interfaces and where they connect.\n\n## Conventions\nHow results, logs and notes are named and where they go.\n\n## Known issues\nLab or hardware quirks the agent should check first.\n`;
}
export const workbenchPatchSchema = z.strictObject({
  embeddings: workbenchEmbeddingsSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().optional(),
  docs: z
    .strictObject({ include: z.array(z.string()).optional(), exclude: z.array(z.string()).optional() })
    .optional(),
  retrieval: z
    .strictObject({
      results: workbenchRetrievalSchema.shape.results.removeDefault(),
      mode: workbenchRetrievalSchema.shape.mode.removeDefault(),
    })
    .optional(),
  skills: z.strictObject({ disabled: z.array(z.string().min(1)).optional() }).optional(),
  tools: z.strictObject({ disabled: z.array(z.string().min(1)).optional() }).optional(),
  plugins: z.strictObject({ enabled: z.array(z.string().min(1)).optional() }).optional(),
  agent: z
    .strictObject({
      permission_mode: agent.shape.permission_mode.removeDefault().optional(),
      model: agent.shape.model.removeDefault().optional(),
    })
    .optional(),
});
export type WorkbenchPatch = z.infer<typeof workbenchPatchSchema>;
export const workbenchWarningSchema = z.strictObject({
  code: z.enum(["UNKNOWN_KEY", "UNKNOWN_NAME", "NETWORK_SHARE_UNSUPPORTED", "LOCK_GUARD_BUSY"]),
  path: z.string().optional(),
});
export type WorkbenchWarning = z.infer<typeof workbenchWarningSchema>;
export const configSnapshotSchema = z.strictObject({
  config: workbenchSchema,
  warnings: z.array(workbenchWarningSchema),
});
export const workbenchSnapshotSchema = configSnapshotSchema.extend({
  folder: z.string().min(1),
  readOnly: z.boolean(),
});
export type WorkbenchSnapshot = z.infer<typeof workbenchSnapshotSchema>;
export const pinnedSchema = z.strictObject({ content: z.string(), oversized: z.boolean() });
const count = z.number().int().nonnegative();
export const documentScanKindSchema = z.enum(["pdf", "office", "markdown", "html", "text"]);
export type DocumentScanKind = z.infer<typeof documentScanKindSchema>;
/** Documentation folders found in a chosen folder: first-level names and counts only, never file names. */
export const documentScanSchema = z.strictObject({
  folders: z
    .array(
      z.strictObject({
        path: z.string().min(1),
        bytes: count,
        kinds: z.partialRecord(documentScanKindSchema, count),
      }),
    )
    .max(10000),
  truncated: z.boolean(),
});
export type DocumentScan = z.infer<typeof documentScanSchema>;
export const documentPreviewSchema = z.strictObject({
  files: count,
  bytes: count,
  officePending: count,
  truncated: z.boolean(),
});
export type DocumentPreview = z.infer<typeof documentPreviewSchema>;
const globSpecial = /[[\](){}*?|]/g;
/**
 * The include pattern selecting everything below a literal workbench-relative folder. Glob
 * metacharacters are bracket-escaped because backslashes are path separators here, and a leading
 * "!" (an exclusion in include lists) is written as the extglob "@(!)".
 */
export function documentFolderPattern(folder: string): string {
  const escaped = folder.replace(globSpecial, (c) => `[${c}]`);
  return `${escaped.startsWith("!") ? `@(!)${escaped.slice(1)}` : escaped}/**`;
}
/** The literal folder a pattern from documentFolderPattern selects, or undefined for any other glob. */
export function documentPatternFolder(pattern: string): string | undefined {
  if (!pattern.endsWith("/**")) return undefined;
  let body = pattern.slice(0, -3);
  if (body.startsWith("@(!)")) body = `!${body.slice(4)}`;
  const folder = body.replace(/\[([[\](){}*?|])\]/g, "$1");
  return folder && documentFolderPattern(folder) === pattern ? folder : undefined;
}
export function configWarnings(
  config: WorkbenchConfig,
  catalogs: { skills: readonly string[]; tools: readonly string[]; plugins?: readonly string[] } = {
    skills: [],
    tools: [],
  },
): WorkbenchWarning[] {
  const result: WorkbenchWarning[] = [];
  const shapes = {
    "": workbenchSchema.shape,
    docs: docs.shape,
    skills: disabled.shape,
    tools: disabled.shape,
    plugins: plugins.shape,
    agent: agent.shape,
    embeddings: { model: true, chunkSize: true, overlap: true },
    retrieval: workbenchRetrievalSchema.shape,
  };
  for (const [prefix, shape] of Object.entries(shapes)) {
    const value = prefix ? config[prefix] : config;
    if (typeof value !== "object" || value === null) continue;
    for (const key of Object.keys(value))
      if (!Object.hasOwn(shape, key))
        result.push({ code: "UNKNOWN_KEY", path: prefix ? `${prefix}.${key}` : key });
  }
  for (const kind of ["skills", "tools"] as const)
    for (const name of config[kind].disabled)
      if (!catalogs[kind].includes(name))
        result.push({ code: "UNKNOWN_NAME", path: `${kind}.disabled.${name}` });
  for (const id of config.plugins.enabled)
    if (!catalogs.plugins?.includes(id)) result.push({ code: "UNKNOWN_NAME", path: `plugins.enabled.${id}` });
  return result;
}
export function mergeWorkbench(current: WorkbenchConfig, patch: WorkbenchPatch): WorkbenchConfig {
  const clean: WorkbenchPatch = JSON.parse(JSON.stringify(workbenchPatchSchema.parse(patch)));
  return workbenchSchema.parse({
    ...current,
    ...clean,
    docs: { ...current.docs, ...clean.docs },
    retrieval: { ...current.retrieval, ...clean.retrieval },
    skills: { ...current.skills, ...clean.skills },
    tools: { ...current.tools, ...clean.tools },
    plugins: { ...current.plugins, ...clean.plugins },
    agent: { ...current.agent, ...clean.agent },
  });
}
