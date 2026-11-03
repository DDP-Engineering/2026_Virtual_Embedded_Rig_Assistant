import { z } from "zod";
import { workbenchIdSchema } from "./workbench.js";

/** Import limits of one plugin package (folder or zip). */
export const PLUGIN_LIMITS = {
  files: 4096,
  bytes: 64 * 1024 * 1024,
  zipBytes: 64 * 1024 * 1024,
  manifestBytes: 256 * 1024,
  issues: 64,
} as const;
export const pluginIdSchema = z.string().regex(/^[a-z0-9-]{1,64}$/);
export const pluginProgramNameSchema = z.string().regex(/^[a-z0-9._-]{1,64}$/);
export const pluginPlatformSchema = z.enum(["windows-x64", "linux-x64", "linux-arm64"]);
export const pluginRiskSchema = z.enum(["safe", "device-read", "device-write", "irreversible", "blocked"]);
export const pluginTierSchema = z.enum(["official", "community", "local", "trial"]);
export type PluginPlatform = z.infer<typeof pluginPlatformSchema>;
export type PluginRisk = z.infer<typeof pluginRiskSchema>;
export type PluginTier = z.infer<typeof pluginTierSchema>;

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
/** A package-relative path: `/` separated, no empty, `.` or `..` segment, no drive, device or trailing dot. */
export function isPluginRelativePath(path: string): boolean {
  if (!path || path.length > 1024 || /[\p{Cc}\\:*?"<>|]/u.test(path) || path.startsWith("/")) return false;
  return path
    .split("/")
    .every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        !/[ .]$/.test(part) &&
        !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])\s*(\.|$)/i.test(part),
    );
}
const relativePath = z.string().refine(isPluginRelativePath, "Use a plugin-relative path.");
const unique = <T>(items: readonly T[]) => new Set(items).size === items.length;
/** One command-line argument: no NUL or line break. */
const arg = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[^\0\r\n]*$/);
const args = z.array(arg).max(64);
const placeholders = (allowed: readonly string[]) => (value: string) =>
  !value.replace(new RegExp(`\\$\\{(?:${allowed.join("|")})\\}`, "g"), "").includes("${");
/**
 * find patterns: PATH (`%PATH%`, `$PATH`), or an absolute local path, possibly starting with `~` or a
 * variable; `*` within one segment only and in at most two segments (more, or `**`, would walk whole
 * drives). Relative and share paths have no place to search from, or would reach the network.
 */
const findAnchor =
  /^(?:%PATH%|\$PATH|~(?:[\\/].*)?|%[A-Za-z_][A-Za-z0-9_]*%.*|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?.*|\/(?!\/).*|[A-Za-z]:[\\/].*)$/;
const globs = z
  .array(
    z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (value) =>
          findAnchor.test(value) &&
          !value.includes("**") &&
          value.split(/[\\/]/).filter((segment) => segment.includes("*")).length <= 2 &&
          !/\p{Cc}/u.test(value),
        "Use PATH or an absolute path with * in at most two segments.",
      ),
  )
  .min(1)
  .max(64);
const comparator = String.raw`\s*(?:>=|<=|>|<|==|!=)\s*\d+(?:\.\d+)*\s*`;
/** A supported version range: comma-separated comparators with dotted decimal numbers (`>=5,<6`). */
const versionRange = new RegExp(`^${comparator}(?:,${comparator})*$`);
/** Authority and path of an absolute URL (shared code has no URL class); undefined for anything else. */
export function urlParts(url: string): { authority: string; path: string } | undefined {
  const match = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/.exec(url);
  return match ? { authority: match[1] ?? "", path: match[2] ?? "" } : undefined;
}
/** Archive downloads by the file name of their URL path; anything else is stored as a single file. */
export function downloadForm(url: string): "zip" | "tar" | "file" {
  const path = urlParts(url)?.path.toLowerCase() ?? "";
  if (path.endsWith(".zip")) return "zip";
  return /\.(?:tar\.gz|tgz|tar\.xz)$/.test(path) ? "tar" : "file";
}
/** The package-relative name a download installs: `path`, else the URL's last path segment, if valid. */
export function downloadName(entry: { url: string; path?: string | undefined }): string | undefined {
  if (entry.path !== undefined) return entry.path;
  let name: string;
  try {
    name = decodeURIComponent(urlParts(entry.url)?.path.split("/").at(-1) ?? "");
  } catch {
    return undefined;
  }
  return isPluginRelativePath(name) ? name : undefined;
}
/** Leading dotted decimal numbers of a version (`2.44.0` of `2.44.0rc1`), compared component-wise. */
function versionNumbers(version: string): number[] | undefined {
  return /^\d+(?:\.\d+)*/.exec(version)?.[0].split(".").map(Number);
}
function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
/** Whether a version satisfies every comparator of a supported range; a non-numeric version never does. */
export function versionInRange(version: string, range: string): boolean {
  const numbers = versionNumbers(version);
  if (!numbers) return false;
  return range.split(",").every((part) => {
    const match = /^\s*(>=|<=|>|<|==|!=)\s*(\d+(?:\.\d+)*)\s*$/.exec(part);
    if (!match) return false;
    const order = compareVersions(numbers, match[2]?.split(".").map(Number) ?? []);
    switch (match[1]) {
      case ">=":
        return order >= 0;
      case "<=":
        return order <= 0;
      case ">":
        return order > 0;
      case "<":
        return order < 0;
      case "==":
        return order === 0;
      default:
        return order !== 0;
    }
  });
}
function captureGroups(source: string): number | undefined {
  try {
    return (new RegExp(`${source}|`).exec("")?.length ?? 1) - 1;
  } catch {
    return undefined;
  }
}
const installSchema = z.union([
  // A requirement, never an option such as `-e` or `--index-url=`.
  z.strictObject({
    pip: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z0-9]/),
  }),
  z.strictObject({ script: relativePath.refine((path) => path.endsWith(".py"), "Use a .py script.") }),
  z.strictObject({
    download: z
      .partialRecord(
        pluginPlatformSchema,
        z
          .strictObject({
            url: z.url({ protocol: /^https$/ }).max(2048),
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
            path: relativePath.optional(),
            prefix: args.optional(),
          })
          .superRefine((entry, ctx) => {
            // An archive names the executable inside it; a single file needs a usable name.
            const named = downloadForm(entry.url) === "file" ? downloadName(entry) : entry.path;
            if (named === undefined)
              ctx.addIssue({ code: "custom", path: ["path"], message: "Name the executable with path." });
          }),
      )
      .refine((value) => Object.keys(value).length > 0, "Name at least one platform."),
  }),
  z.strictObject({
    find: z
      .strictObject({ windows: globs.optional(), linux: globs.optional() })
      .refine((value) => value.windows || value.linux, "Name at least one system."),
    hint: z.string().trim().min(1).max(1024).optional(),
  }),
]);
const programSchema = z.strictObject({
  install: installSchema,
  version: z.strictObject({
    args,
    match: z
      .string()
      .min(1)
      .max(512)
      .refine((source) => captureGroups(source) === 1, "Use a regular expression with one capture group."),
    range: z.string().min(1).max(128).regex(versionRange).optional(),
  }),
  launcher: args.min(1).optional(),
  prefix: z
    .array(arg.refine(placeholders(["pluginDir"]), "Only the pluginDir placeholder is substituted."))
    .max(64)
    .optional(),
  env: z
    .record(
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
      z
        .string()
        .max(4096)
        .regex(/^[^\0]*$/)
        .refine(
          placeholders(["workbench", "pluginDir"]),
          "Only the workbench and pluginDir placeholders are substituted.",
        ),
    )
    .optional(),
  timeout: z.number().int().min(1).max(3600).optional(),
});
const ruleSchema = z.strictObject({
  match: z
    .string()
    .min(1)
    .max(1024)
    .refine((value) => !/\p{Cc}/u.test(value), "Use one line without control characters."),
  risk: pluginRiskSchema,
  note: z.string().trim().min(1).max(512).optional(),
  timeout: z.number().int().min(1).max(3600).optional(),
});
/** plugin.yaml format 1. */
export const pluginManifestSchema = z.strictObject({
  format: z.literal(1),
  id: pluginIdSchema,
  version: z.string().max(128).regex(semver),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1024),
  ecosystem: z.string().regex(/^[a-z0-9-]{1,64}$/),
  platforms: z.array(pluginPlatformSchema).min(1).refine(unique, "List each platform once."),
  requires: z.array(pluginIdSchema).max(64).refine(unique, "List each plugin once.").default([]),
  programs: z
    .record(pluginProgramNameSchema, programSchema)
    .refine((value) => Object.keys(value).length <= 64, "Declare at most 64 programs.")
    .default({}),
  rules: z.array(ruleSchema).max(512).default([]),
  docs: z
    .array(
      z
        .string()
        .max(2048)
        .refine(
          (value) => /^https?:\/\/[^\s]+$/.test(value) || isPluginRelativePath(value),
          "Use a URL or a plugin-relative path.",
        ),
    )
    .max(64)
    .default([]),
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginProgram = z.infer<typeof programSchema>;

export const pluginIssueCodeSchema = z.enum([
  "manifest",
  "yaml",
  "field",
  "id",
  "record",
  "changed",
  "unavailable",
]);
export const pluginIssueSchema = z.strictObject({
  code: pluginIssueCodeSchema,
  path: z.string().min(1).max(512).optional(),
  issue: z.string().min(1).max(64).optional(),
  line: z.number().int().positive().optional(),
});
export type PluginIssue = z.infer<typeof pluginIssueSchema>;
/** Field-level issues of a manifest candidate; the manifest only when there is none. */
export function validatePluginManifest(data: unknown): { manifest?: PluginManifest; issues: PluginIssue[] } {
  const parsed = pluginManifestSchema.safeParse(data);
  if (parsed.success) return { manifest: parsed.data, issues: [] };
  const issues: PluginIssue[] = [];
  const add = (path: PropertyKey[], issue: string) => {
    const dotted = path.map(String).join(".").slice(0, 512);
    if (!issues.some((i) => i.path === (dotted || undefined) && i.issue === issue))
      issues.push({ code: "field", ...(dotted ? { path: dotted } : {}), issue });
  };
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys")
      for (const key of issue.keys) add([...issue.path, key], issue.code);
    else add(issue.path, issue.code);
  }
  return { issues: issues.slice(0, PLUGIN_LIMITS.issues) };
}

/** An installed plugin as the store lists it: manifest and record metadata where they are valid. */
export const pluginInstalledSchema = z.strictObject({
  id: z.string().min(1).max(255),
  issues: z.array(pluginIssueSchema).max(PLUGIN_LIMITS.issues),
  version: z.string().max(128).optional(),
  name: z.string().max(80).optional(),
  description: z.string().max(1024).optional(),
  ecosystem: z.string().max(64).optional(),
  platforms: z.array(pluginPlatformSchema).max(3).optional(),
  tier: pluginTierSchema.optional(),
  source: z.enum(["folder", "zip", "catalog"]).optional(),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  installedAt: z.iso.datetime().optional(),
  /** Irreversible rules of a plugin without issues, in manifest order (the bypass warning lists them). */
  irreversible: z
    .array(
      z.strictObject({ match: z.string().min(1).max(1024), note: z.string().min(1).max(512).optional() }),
    )
    .max(512)
    .optional(),
});
export type PluginInstalled = z.infer<typeof pluginInstalledSchema>;
/**
 * A package the user reviews before installing it: what install would record (its integrity hash), the
 * manifest whenever it parses, every issue and the version of an installed plugin with the same id.
 */
export const pluginReviewSchema = z.strictObject({
  path: z.string().min(1).max(4096),
  kind: z.enum(["folder", "zip"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  issues: z.array(pluginIssueSchema).max(PLUGIN_LIMITS.issues),
  manifest: pluginManifestSchema.optional(),
  installed: z.strictObject({ version: z.string().max(128).optional() }).optional(),
});
export type PluginReview = z.infer<typeof pluginReviewSchema>;
export const pluginSummarySchema = pluginInstalledSchema.extend({ enabled: z.boolean() });
export type PluginSummary = z.infer<typeof pluginSummarySchema>;
export const pluginListRequestSchema = z.strictObject({ workbenchId: workbenchIdSchema.optional() });
/** The renderer names a folder or zip the user chose; main reads it, as workbench.open does. */
export const pluginPathRequestSchema = z.strictObject({
  path: z
    .string()
    .max(4096)
    .regex(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/, "Use an absolute path."),
});
/** An install names the integrity hash the user reviewed; a package that changed since is CONFLICT. */
export const pluginInstallRequestSchema = pluginPathRequestSchema.extend({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const pluginToggleRequestSchema = z.strictObject({
  workbenchId: workbenchIdSchema,
  id: pluginIdSchema,
  enabled: z.boolean(),
});
export const pluginProgramsRequestSchema = z.strictObject({ id: pluginIdSchema });
export const pluginProgramKindSchema = z.enum(["pip", "script", "download", "find"]);
/** Why a program is not ready (provisioning spec). */
export const pluginProgramProblemSchema = z.enum([
  "notFound",
  "install",
  "download",
  "sha256",
  "archive",
  "platform",
  "launcher",
  "uv",
  "version",
  "range",
]);
export type PluginProgramProblem = z.infer<typeof pluginProgramProblemSchema>;
/** One declared program as provisioning sees it: ready to run, installable or found later, or unavailable. */
export const pluginProgramStatusSchema = z.strictObject({
  name: pluginProgramNameSchema,
  kind: pluginProgramKindSchema,
  state: z.enum(["ready", "missing", "unavailable"]),
  version: z.string().min(1).max(128).optional(),
  range: z.string().min(1).max(128).optional(),
  hint: z.string().min(1).max(1024).optional(),
  link: z.string().min(1).max(1024).optional(),
  problem: pluginProgramProblemSchema.optional(),
  detail: z.string().max(2000).optional(),
});
export type PluginProgramStatus = z.infer<typeof pluginProgramStatusSchema>;

/** Run ids are ULIDs, so their order is their start order. */
export const programRunIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
/** `.vera/runs/<run id>.json` format 1: a plugin program run beside its log (spec REQ-DATA-f563074f). */
export const programRunRecordSchema = z.strictObject({
  format: z.literal(1),
  id: programRunIdSchema,
  sessionId: z.string().min(1).max(255),
  plugin: pluginIdSchema.optional(),
  program: pluginProgramNameSchema.optional(),
  /** The agent's arguments, never the executable or prefixes. */
  args: z.array(z.string().max(4096)).max(64),
  background: z.boolean(),
  startedAt: z.iso.datetime(),
  end: z.enum(["exited", "stopped", "timedOut"]).optional(),
  exitCode: z.number().int().nullable().optional(),
  error: z.string().min(1).max(256).optional(),
  durationMs: z.number().int().min(0).optional(),
});
export type ProgramRunRecord = z.infer<typeof programRunRecordSchema>;
/** A run as the Runs tab lists it: running, ended, or interrupted (a record the app never finished). */
export const programRunSchema = programRunRecordSchema.omit({ format: true }).extend({
  state: z.enum(["running", "exited", "stopped", "timedOut", "interrupted"]),
  log: z.string().min(1).max(64),
});
export type ProgramRunInfo = z.infer<typeof programRunSchema>;
export const programRunLogSchema = z.strictObject({
  id: programRunIdSchema,
  text: z.string(),
  truncated: z.boolean(),
  running: z.boolean(),
});
export type ProgramRunLog = z.infer<typeof programRunLogSchema>;
