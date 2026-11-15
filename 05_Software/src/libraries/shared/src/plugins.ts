import { z } from "zod";
import { labResourceKindSchema } from "./lab-resources.js";
import { pluginCredentialScopeSchema } from "./plugin-credentials.js";
import { pluginParametersSchema } from "./plugin-settings.js";
import { workbenchIdSchema } from "./workbench.js";

/** Import limits of one plugin package (folder or zip); its size in bytes is not limited. */
export const PLUGIN_LIMITS = {
  files: 4096,
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
export type PluginMaturity = "pre-release" | "stable";
/**
 * A plugin's maturity, derived from its version alone: `0.x.y` or a semver pre-release tag is `pre-release`,
 * any other valid version `stable`. A missing or invalid version is never `stable`.
 */
export function pluginMaturity(version: string | undefined): PluginMaturity {
  const match = version === undefined ? null : semver.exec(version);
  return match && match[1] !== "0" && match[4] === undefined ? "stable" : "pre-release";
}
/** The plugin platform of a host (Node `platform` and `arch`), or undefined where VERA has no build. */
export function pluginPlatform(platform: string, arch: string): PluginPlatform | undefined {
  if (platform === "win32") return arch === "x64" ? "windows-x64" : undefined;
  if (platform === "linux")
    return arch === "x64" ? "linux-x64" : arch === "arm64" ? "linux-arm64" : undefined;
  return undefined;
}
/** A risk a rule can let run: every risk except `blocked`, whose commands are refused. */
export type PluginRunRisk = Exclude<PluginRisk, "blocked">;
/** The highest risk among the rules below `blocked`, or `safe` without such a rule. */
export function pluginHighestRisk(rules: readonly { risk: PluginRisk }[]): PluginRunRisk {
  const order = pluginRiskSchema.options;
  let highest: PluginRunRisk = "safe";
  for (const { risk } of rules)
    if (risk !== "blocked" && order.indexOf(risk) > order.indexOf(highest)) highest = risk;
  return highest;
}
/** The rules of one risk, in manifest order, as the plugin page lists them as operations. */
export interface PluginOperationGroup<Rule extends { risk: PluginRisk }> {
  risk: PluginRisk;
  rules: Rule[];
}
/**
 * The manifest rules grouped by risk for the plugin page: one group per risk that has rules, in the order safe,
 * device-read, device-write, irreversible, blocked. The rules are the same objects approvals classify with.
 */
export function pluginOperations<Rule extends { risk: PluginRisk }>(
  rules: readonly Rule[],
): PluginOperationGroup<Rule>[] {
  return pluginRiskSchema.options
    .map((risk) => ({ risk, rules: rules.filter((rule) => rule.risk === risk) }))
    .filter((group) => group.rules.length > 0);
}
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
/**
 * Archive downloads by the file name of their URL path; anything else is stored as a single file. A `.7z` archive is
 * extracted by Windows' own bsdtar, so it is declared for windows-x64 only.
 */
export function downloadForm(url: string): "zip" | "tar" | "7z" | "file" {
  const path = urlParts(url)?.path.toLowerCase() ?? "";
  if (path.endsWith(".zip")) return "zip";
  if (path.endsWith(".7z")) return "7z";
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
const downloadSchema = z
  .partialRecord(
    pluginPlatformSchema,
    z
      .strictObject({
        url: z.url({ protocol: /^https$/ }).max(2048),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        path: relativePath.optional(),
        prefix: args.optional(),
        /** The file's size in bytes, for the catalog card; a longer transfer is a hash mismatch. */
        bytes: z.number().int().min(1).optional(),
      })
      .superRefine((entry, ctx) => {
        const named = downloadForm(entry.url) === "file" ? downloadName(entry) : entry.path;
        if (named === undefined)
          ctx.addIssue({ code: "custom", path: ["path"], message: "Name the executable with path." });
      }),
  )
  .refine((value) => Object.keys(value).length > 0, "Name at least one platform.")
  .superRefine((value, ctx) => {
    for (const [platform, entry] of Object.entries(value))
      if (entry && platform !== "windows-x64" && downloadForm(entry.url) === "7z")
        ctx.addIssue({
          code: "custom",
          path: [platform, "url"],
          message: "A .7z archive is extracted by Windows' bsdtar; declare it for windows-x64 only.",
        });
  });
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
    download: downloadSchema,
  }),
  z
    .strictObject({
      find: z
        .strictObject({ windows: globs.optional(), linux: globs.optional() })
        .refine((value) => value.windows || value.linux, "Name at least one system."),
      hint: z.string().trim().min(1).max(1024).optional(),
      download: downloadSchema.optional(),
      preferDownload: z.literal(true).optional(),
    })
    .refine((install) => !install.preferDownload || install.download !== undefined, {
      path: ["preferDownload"],
      message: "Declare a managed download to prefer it.",
    }),
]);
const programSchema = z
  .strictObject({
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
    launcherMode: z.enum(["argv", "string"]).optional(),
    optionSyntax: z.enum(["sigrok-cli", "git", "tshark", "pymcuprog", "stm32cubeprog"]).optional(),
    /** `hil`: VERA core compiles and runs this program's `check` and `run` operations (spec REQ-DATA-5f714098 §1). */
    plan: z.literal("hil").optional(),
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
    /** Find or download programs of the same plugin whose paths the run receives as VERA_PROGRAM_<NAME>. */
    uses: z.array(pluginProgramNameSchema).min(1).max(8).refine(unique, "List each program once.").optional(),
    /**
     * Calls naming a `lab/resources.json` alias with `option` reserve that resource for the run; a stop request,
     * `grace` seconds and the authorized `cleanup` run supervise it (spec REQ-DATA-f2cbfc23 §3).
     */
    resources: z
      .strictObject({
        option: z.string().regex(/^--[a-z][a-z0-9-]{0,31}$/),
        kinds: z.array(labResourceKindSchema).min(1).max(8).refine(unique, "List each kind once."),
        grace: z.number().int().min(1).max(60),
        cleanup: z
          .array(arg.refine(placeholders([]), "No placeholder is substituted."))
          .min(1)
          .max(8),
        cleanupTimeout: z.number().int().min(1).max(300),
      })
      .optional(),
    /**
     * Calls naming `option` with a credential reference receive the stored credential `<scope>:<ref>` as one JSON
     * line on stdin, only for an official plugin enabled at run start (spec REQ-DATA-96d18686 section 1).
     */
    credentials: z
      .strictObject({
        option: z.string().regex(/^--[a-z][a-z0-9-]{0,31}$/),
        scope: pluginCredentialScopeSchema,
      })
      .optional(),
    /**
     * The program authenticates through the system SSH agent: the runner gives it (and its cleanup run) the host's
     * SSH_AUTH_SOCK, only for an official plugin (REQ-SEC-adb91424). The agent's keys never leave the agent.
     */
    sshAgent: z.literal(true).optional(),
    /**
     * The program opens windows on the user's desktop: its runs receive the display variables (DISPLAY,
     * WAYLAND_DISPLAY, XAUTHORITY, XDG_RUNTIME_DIR) that other programs never get.
     */
    gui: z.literal(true).optional(),
    /**
     * A downloaded file that is never run (a Java archive, a data set): VERA verifies its hash, reads its version
     * from the file name with `version.match`, and passes its path to the programs that use it.
     */
    file: z.literal(true).optional(),
  })
  .superRefine((program, ctx) => {
    if (Boolean(program.launcher) !== Boolean(program.launcherMode))
      ctx.addIssue({
        code: "custom",
        path: ["launcherMode"],
        message: "A launcher requires an explicit launcherMode; a mode requires a launcher.",
      });
    if (program.launcher && (!("find" in program.install) || "download" in program.install))
      ctx.addIssue({
        code: "custom",
        path: ["install"],
        message: "A launcher uses find without a download fallback to locate its executable.",
      });
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
/** The languages a plugin may translate its catalog texts into; English is the manifest's own text. */
export const pluginTextLanguages = ["ro", "de", "fr"] as const;
const pluginTextsSchema = z.strictObject({
  summary: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1024),
});
/** plugin.yaml format 1. */
export const pluginManifestSchema = z.strictObject({
  format: z.literal(1),
  id: pluginIdSchema,
  version: z.string().max(128).regex(semver),
  name: z.string().trim().min(1).max(80),
  /** One line for the catalog card; `description` holds the details for the review. */
  summary: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(1024),
  /** The catalog summary and description in other interface languages. */
  translations: z.partialRecord(z.enum(pluginTextLanguages), pluginTextsSchema).optional(),
  /** The plugin's license as an SPDX identifier or `LicenseRef-…`. */
  license: z
    .string()
    .regex(/^[A-Za-z0-9.+-]{1,128}$/)
    .optional(),
  ecosystem: z.string().regex(/^[a-z0-9-]{1,64}$/),
  platforms: z.array(pluginPlatformSchema).min(1).refine(unique, "List each platform once."),
  requires: z.array(pluginIdSchema).max(64).refine(unique, "List each plugin once.").default([]),
  programs: z
    .record(pluginProgramNameSchema, programSchema)
    .refine((value) => Object.keys(value).length <= 64, "Declare at most 64 programs.")
    .superRefine((programs, ctx) => {
      for (const [name, program] of Object.entries(programs)) {
        // Each used program becomes VERA_PROGRAM_<NAME>; two names must not share one variable.
        const variables = (program.uses ?? []).map((used) => used.toUpperCase().replace(/[-.]/g, "_"));
        if (new Set(variables).size !== variables.length)
          ctx.addIssue({
            code: "custom",
            path: [name, "uses"],
            message: "Two used programs map to the same VERA_PROGRAM_ variable; rename one.",
          });
        if (program.file && !("download" in program.install && !("find" in program.install)))
          ctx.addIssue({
            code: "custom",
            path: [name, "file"],
            message: "A file program installs only by download.",
          });
        for (const used of program.uses ?? []) {
          const target = programs[used];
          if (used === name || !target || !("find" in target.install || "download" in target.install))
            ctx.addIssue({
              code: "custom",
              path: [name, "uses"],
              message: "Name another find or download program of this plugin.",
            });
        }
      }
    })
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
  /** Declared parameters: secrets, workbench files and values the plugin needs (REQ-DATA-af8807e1). */
  settings: pluginParametersSchema.optional(),
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
  "untrusted",
  "collision",
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

/**
 * What a package ships beside its programs, as the plugin page lists it: each `skills/<name>/SKILL.md` with its
 * front-matter description (none when the front matter does not parse), and the data files (profiles and other
 * files outside `plugin.yaml`, `skills/`, `scripts/` and the package-relative documents), in path order.
 */
export const pluginCompositionSchema = z.strictObject({
  skills: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(255),
        description: z.string().min(1).max(1024).optional(),
      }),
    )
    .max(PLUGIN_LIMITS.files),
  files: z.array(z.string().min(1).max(1024)).max(PLUGIN_LIMITS.files),
  /** The languages of the package's help/<language>.md pages, when it has any. */
  help: z
    .array(z.enum(["en", "ro", "de", "fr"]))
    .min(1)
    .max(4)
    .optional(),
});
export type PluginComposition = z.infer<typeof pluginCompositionSchema>;
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
  source: z.enum(["folder", "zip", "catalog", "workbench"]).optional(),
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
  /** The manifest and composition of a plugin without issues, for its Composition and Operations sections. */
  manifest: pluginManifestSchema.optional(),
  composition: pluginCompositionSchema.optional(),
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
  /** Present whenever the manifest parses. */
  composition: pluginCompositionSchema.optional(),
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
export const pluginProgramsRequestSchema = z.strictObject({
  id: pluginIdSchema,
  workbenchId: workbenchIdSchema.optional(),
});
export const pluginArchiveRequestSchema = pluginProgramsRequestSchema.extend({
  program: pluginProgramNameSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const pluginScopedRequestSchema = z.strictObject({
  id: pluginIdSchema,
  workbenchId: workbenchIdSchema,
});
export const pluginScopedTrustRequestSchema = pluginScopedRequestSchema.extend({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const pluginProgramKindSchema = z.enum(["pip", "script", "download", "find"]);
/** Why a program is not ready (provisioning spec). */
export const pluginProgramProblemSchema = z.enum([
  "notFound",
  "install",
  "download",
  "sha256",
  "archive",
  "platform",
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
  /** This platform has a preferred managed download while a discovered CLI is selected. */
  downloadAvailable: z.literal(true).optional(),
  /** A combined find/download declaration is currently using a discovered external executable. */
  external: z.literal(true).optional(),
  /** Where a ready program was found on this computer; VERA's own copies carry none. */
  path: z.string().min(1).max(4096).optional(),
});
export type PluginProgramStatus = z.infer<typeof pluginProgramStatusSchema>;
export type PluginProgramKind = z.infer<typeof pluginProgramKindSchema>;

/** How a program installs: a find declaration with a managed download counts as a download. */
export function pluginProgramKind(program: PluginProgram): PluginProgramKind {
  const { install } = program;
  if ("pip" in install) return "pip";
  if ("script" in install) return "script";
  return install.download !== undefined ? "download" : "find";
}
/** The first http(s) link of a hint, without trailing sentence punctuation (the vendor guide). */
export function pluginHintLink(hint: string): string | undefined {
  return /https?:\/\/[^\s<>"'()[\]]+/.exec(hint)?.[0].replace(/[.,;:!?]+$/, "");
}
/**
 * One program dependency as the catalog index and the plugin page list it, derived from the manifest alone:
 * VERA installs pip, script and download programs into its program folder (`automatic`); a find program is the
 * user's to install, with its supported range and vendor guide.
 */
export const pluginDependencySchema = z.strictObject({
  name: pluginProgramNameSchema,
  kind: pluginProgramKindSchema,
  automatic: z.boolean(),
  pip: z.string().min(1).max(256).optional(),
  script: z.string().min(1).max(1024).optional(),
  downloads: z
    .array(
      z.strictObject({
        platform: pluginPlatformSchema,
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        bytes: z.number().int().min(1).optional(),
      }),
    )
    .min(1)
    .max(3)
    .optional(),
  /** The systems whose installation VERA searches for the program. */
  find: z
    .array(z.enum(["windows", "linux"]))
    .min(1)
    .max(2)
    .optional(),
  range: z.string().min(1).max(128).optional(),
  /** The manifest's hint: how to install the program yourself. */
  guide: z.string().min(1).max(1024).optional(),
});
export type PluginDependency = z.infer<typeof pluginDependencySchema>;
/** The program dependencies of a manifest in name order (the catalog index's `dependencies`). */
export function pluginDependencies(manifest: PluginManifest): PluginDependency[] {
  return Object.keys(manifest.programs)
    .sort()
    .map((name) => {
      const program = manifest.programs[name] as PluginProgram;
      const kind = pluginProgramKind(program);
      const { install } = program;
      const { range } = program.version;
      if ("pip" in install) return { name, kind, automatic: true, pip: install.pip };
      if ("script" in install) return { name, kind, automatic: true, script: install.script };
      const downloads = pluginPlatformSchema.options.flatMap((platform) => {
        const entry = install.download?.[platform];
        return entry
          ? [{ platform, sha256: entry.sha256, ...(entry.bytes !== undefined ? { bytes: entry.bytes } : {}) }]
          : [];
      });
      const find =
        "find" in install
          ? (["windows", "linux"] as const).filter((system) => install.find[system] !== undefined)
          : [];
      const hint = "hint" in install ? install.hint : undefined;
      return {
        name,
        kind,
        automatic: kind !== "find",
        ...(downloads.length ? { downloads } : {}),
        ...(find.length ? { find } : {}),
        ...(range !== undefined ? { range } : {}),
        ...(hint !== undefined ? { guide: hint } : {}),
      };
    });
}

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

/** The catalog summary and description in `language` where the plugin translates them, else in English. */
export function pluginText(
  entry: Pick<PluginManifest, "summary" | "description" | "translations">,
  language: string | undefined,
): { summary: string; description: string } {
  const own = pluginTextLanguages.find((code) => code === language);
  const translated = own ? entry.translations?.[own] : undefined;
  return {
    summary: translated?.summary ?? entry.summary,
    description: translated?.description ?? entry.description,
  };
}
