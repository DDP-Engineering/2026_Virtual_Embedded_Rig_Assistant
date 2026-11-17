import { z } from "zod";
import { commandPrefixListSchema, storedCommandPrefixesSchema } from "./command-prefix.js";
import { workbenchPrivacySchema } from "./privacy.js";
import { permissionModeSchema } from "./session.js";

/** Portable stored folder syntax; host resolution additionally checks the local directory. */
export const additionalFolderSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((path) => {
    const slash = path.replaceAll("\\", "/");
    if (
      Array.from(path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
      /^\/\/[?.]\//.test(slash)
    )
      return false;
    const windows = /^[A-Za-z]:\//.test(slash);
    if (!windows && !slash.startsWith("/")) return false;
    if (!windows && path.startsWith("\\") && !path.startsWith("\\\\")) return false;
    const body = windows ? slash.slice(3) : slash.replace(/^\/\/?/, "");
    if (body.includes(":")) return false;
    if (slash.startsWith("//") && body.split("/").filter(Boolean).length < 2) return false;
    return body
      .split("/")
      .every(
        (part) =>
          !part ||
          (part !== "." &&
            part !== ".." &&
            !/[ .]$/.test(part) &&
            !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])\s*(\.|$)/i.test(part) &&
            !/[<>"|?*]/.test(part)),
      );
  }, "Use an ordinary absolute folder path.");
export const additionalFoldersSchema = z
  .array(additionalFolderSchema)
  .max(64)
  .refine(
    (paths) =>
      new Set(paths.map((path) => path.replaceAll("\\", "/").replace(/\/$/, ""))).size === paths.length,
    "Additional folders must be unique.",
  );

export const workbenchIdSchema = z.string().regex(/^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
/** A file size in MB (1 MB = 1,048,576 bytes); zod rejects NaN and infinite numbers. */
const fileMB = z.number().positive();
const fileCount = z.number().int().positive();
const docs = z.looseObject({
  include: z.array(z.string()).default(["docs/**"]),
  exclude: z.array(z.string()).default([]),
  /** The root and nested .gitignore files also exclude paths from indexing and the Files tab. */
  gitignore: z.boolean().default(true),
  /** Lowers the fixed document size limits (100 MiB PDF and Office, 20 MiB text); never raises them. */
  maxFileMB: fileMB.optional(),
  /** "Maximum indexed files" from Documents & RAG: above it indexing stops until "Index anyway". */
  maxFiles: fileCount.default(10000),
});
/** The documentation settings of a workbench, for validating a draft before it is saved. */
export const workbenchDocsSchema = docs;
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
/** Presentation only: execution, permissions and stored session history are unchanged. */
export const chatDetailSchema = z.enum(["verbose", "normal", "minimal"]);
export type ChatDetail = z.infer<typeof chatDetailSchema>;
const chat = z.looseObject({ detail: chatDetailSchema.default("normal") });
/** Content tabs in display order; Close is a control, not a configurable tab. */
export const rightPanelTabIds = [
  "context",
  "docs",
  "changes",
  "artifacts",
  "plan",
  "runs",
  "terminal",
] as const;
export type RightPanelTab = (typeof rightPanelTabIds)[number];
const rightPanelTabsSchema = z
  .array(z.enum(rightPanelTabIds))
  .max(rightPanelTabIds.length)
  .refine((tabs) => new Set(tabs).size === tabs.length, "Right panel tabs must be unique.");
const workbenchInterface = z.looseObject({
  right_panel_tabs: rightPanelTabsSchema.default([...rightPanelTabIds]),
});
/** Defaults for the agent's search_docs when it passes no k or mode of its own. */
export const workbenchRetrievalSchema = z.looseObject({
  results: z.number().int().min(1).max(20).default(8),
  mode: z.enum(["hybrid", "keyword", "semantic"]).default("hybrid"),
});
export type WorkbenchRetrieval = Pick<z.infer<typeof workbenchRetrievalSchema>, "results" | "mode">;
const agent = z.looseObject({
  allowed_commands: storedCommandPrefixesSchema.default([]),
  permission_mode: permissionModeSchema.default("ask"),
  model: z
    .string()
    .regex(/^[^/]+\/.+$/)
    .nullable()
    .default(null),
});
export const workbenchSchema = z.looseObject({
  privacy: workbenchPrivacySchema.optional(),
  format: z.literal(1),
  additional_folders: additionalFoldersSchema.default([]),
  id: workbenchIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().optional(),
  embeddings: workbenchEmbeddingsSchema.default({
    model: "Xenova/bge-small-en-v1.5",
    chunkSize: 1400,
    overlap: 200,
  }),
  docs: docs.default({ include: ["docs/**"], exclude: [], gitignore: true, maxFiles: 10000 }),
  retrieval: workbenchRetrievalSchema.default({ results: 8, mode: "hybrid" }),
  skills: disabled.default({ disabled: [] }),
  tools: disabled.default({ disabled: [] }),
  plugins: plugins.default({ enabled: [] }),
  chat: chat.default({ detail: "normal" }),
  interface: workbenchInterface.default({ right_panel_tabs: [...rightPanelTabIds] }),
  agent: agent.default({ permission_mode: "ask", model: null, allowed_commands: [] }),
});
export type WorkbenchConfig = z.infer<typeof workbenchSchema>;
/** The specified English user-editable starting context. */
export function workbenchTemplate(name: string): string {
  return `# ${name}\n\n## Device under test\nBoard, MCU, revision, key parts.\n\n## Bench setup\nPower, probes, programmers, interfaces and where they connect.\n\n## Conventions\nHow results, logs and notes are named and where they go.\n\n## Known issues\nLab or hardware quirks the agent should check first.\n`;
}
export const workbenchPatchSchema = z.strictObject({
  privacy: workbenchPrivacySchema.optional(),
  additional_folders: additionalFoldersSchema.optional(),
  chat: z.strictObject({ detail: chatDetailSchema.optional() }).optional(),
  interface: z.strictObject({ right_panel_tabs: rightPanelTabsSchema.optional() }).optional(),
  embeddings: workbenchEmbeddingsSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().optional(),
  docs: z
    .strictObject({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      gitignore: z.boolean().optional(),
      /** null removes the limit. */
      maxFileMB: fileMB.nullable().optional(),
      maxFiles: fileCount.optional(),
    })
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
      allowed_commands: commandPrefixListSchema.optional(),
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
    chat: chat.shape,
    interface: workbenchInterface.shape,
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
  const { maxFileMB, ...docs } = { ...current.docs, ...clean.docs };
  return workbenchSchema.parse({
    ...current,
    ...clean,
    docs: maxFileMB === null || maxFileMB === undefined ? docs : { ...docs, maxFileMB },
    retrieval: { ...current.retrieval, ...clean.retrieval },
    skills: { ...current.skills, ...clean.skills },
    tools: { ...current.tools, ...clean.tools },
    plugins: { ...current.plugins, ...clean.plugins },
    chat: { ...current.chat, ...clean.chat },
    interface: { ...current.interface, ...clean.interface },
    agent: { ...current.agent, ...clean.agent },
    ...(current.privacy || clean.privacy
      ? {
          privacy: {
            ...current.privacy,
            ...clean.privacy,
            ...(current.privacy?.mask || clean.privacy?.mask
              ? { mask: { ...current.privacy?.mask, ...clean.privacy?.mask } }
              : {}),
          },
        }
      : {}),
  });
}
