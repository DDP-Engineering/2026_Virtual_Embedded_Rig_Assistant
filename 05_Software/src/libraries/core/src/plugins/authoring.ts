// REQ-FUNC-bf693078, REQ-FUNC-ef7d2de3
import { lstat } from "node:fs/promises";
import {
  dangerousToken,
  type PluginIssue,
  ruleNamesProgram,
  type VeraError,
  veraError,
  veraErrorSchema,
} from "@vera/shared";
import { z } from "zod";
import { waitForAbort } from "../abort.js";
import type { PreparedChange } from "../tools/changes.js";
import { type ToolContext, type ToolDefinition, toolPathGuard, toolSignal } from "../tools/context.js";
import type { PathGuard } from "../workbench/path-guard.js";
import { pluginFailureDetail, readPluginPackage } from "./store.js";

const params = z.strictObject({ path: z.string().min(1).max(4096) });

/** What a storage refusal means to the author when the store gave no reason of its own. */
const refusals: Partial<Record<VeraError["code"], string>> = {
  NOT_FOUND: "There is no plugin draft at that path.",
  INVALID: "The draft folder cannot be read as a plugin package.",
  DENIED: "The draft holds a link or a special file, or its path is not an ordinary folder.",
  CONFLICT:
    "The draft changed after it was reviewed. Call plugin_install again so the user reviews the current files.",
  BUSY: "The plugin's installed files are in use by another program. Close it and call plugin_install again.",
};
/**
 * An error the model can act on. The store signals refusals with coded objects, which reach the model as
 * a bare tool failure; the code is kept on the error for callers that check it.
 */
function explained(error: unknown, extra: Partial<Record<VeraError["code"], string>> = {}): unknown {
  const code = veraErrorSchema.safeParse(error).data?.code;
  if (!code) return error;
  const message = pluginFailureDetail(error) ?? extra[code] ?? refusals[code];
  return message ? Object.assign(Error(message), { code }) : error;
}

const fieldProblems: Record<string, string> = {
  missing_file: "names a file that is not in the draft",
  unrecognized_keys: "is not a manifest field; remove it",
  invalid_type: "has the wrong type of value",
  invalid_format: "is not written in the required format",
  invalid_value: "is not one of the allowed values",
  too_small: "is too short, empty or below the allowed range",
  too_big: "is too long or above the allowed range",
};
/** One sentence on what a validation error asks the author to change. */
function issueDetail(issue: PluginIssue): string {
  if (issue.code === "manifest") return "plugin.yaml is missing, larger than 256 KiB or not UTF-8 text.";
  if (issue.code === "yaml")
    return `plugin.yaml is not valid YAML${issue.line ? ` at line ${issue.line}` : ""}.`;
  if (issue.code === "id") return "The draft folder must be named exactly as the manifest id.";
  if (issue.code === "field")
    return `${issue.path ?? "The manifest"} ${fieldProblems[issue.issue ?? ""] ?? "is not valid"}.`;
  return "The draft does not pass the install checks.";
}
const described = (issues: readonly PluginIssue[]) =>
  issues.map((issue) => ({ ...issue, detail: issueDetail(issue) }));

/** Draft source authority comes from the host-selected tool scope. */
async function draftPath(guard: PathGuard, path: string) {
  const target = await guard.resolve(path);
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw Error(`There is no folder at ${path}. Give the path of the plugin draft folder.`);
  }
  if (!entry.isDirectory()) throw Error("Choose a plugin draft folder.");
  return target;
}

async function inspectDraft(guard: PathGuard, path: string, signal: AbortSignal) {
  const target = await draftPath(guard, path);
  signal.throwIfAborted();
  const pkg = await waitForAbort(readPluginPackage(target.absolute, signal), signal).catch(
    (error: unknown) => {
      signal.throwIfAborted();
      throw explained(error);
    },
  );
  if ((await draftPath(guard, path)).absolute !== target.absolute) throw explained(veraError("CONFLICT"));
  signal.throwIfAborted();
  return { target, pkg };
}
export const pluginValidateTool: ToolDefinition = {
  name: "plugin_validate",
  class: "read",
  description:
    "Validate a plugin draft folder; absolute outside sources require Bypass. VERA application data is always refused. Returns schema errors and lint warnings; installs nothing.",
  params,
  execute: async (ctx, raw, signal) => {
    signal = toolSignal(ctx, signal);
    const guard = await toolPathGuard(ctx);
    signal.throwIfAborted();
    const { pkg } = await inspectDraft(guard, params.parse(raw).path, signal);
    const warnings: { code: string; path: string; detail: string }[] = [];
    for (const path of pkg.leftOut ?? [])
      warnings.push({ code: "left-out", path, detail: "Not part of the package; it will not be installed." });
    for (const skill of pkg.composition?.skills ?? [])
      if (!skill.description)
        warnings.push({
          code: "skill-metadata",
          path: `skills/${skill.name}/SKILL.md`,
          detail:
            "The skill cannot be loaded. Check its UTF-8 text and add valid name and description front matter.",
        });
    const manifest = pkg.manifest;
    if (manifest) {
      for (const [index, rule] of manifest.rules.entries()) {
        const token = dangerousToken(rule.match);
        if (token && ["safe", "device-read"].includes(rule.risk))
          warnings.push({ code: "token", path: `rules.${index}`, detail: `${token} at ${rule.risk}` });
      }
      for (const [name, program] of Object.entries(manifest.programs)) {
        if (program.subcommandHelp)
          warnings.push({
            code: "subcommand-help",
            path: `programs.${name}.subcommandHelp`,
            detail: "Verify that each exact subcommand and flag prints help and exits before dispatch.",
          });
        if (!manifest.rules.some((rule) => ruleNamesProgram(rule.match, name)))
          warnings.push({
            code: "rules",
            path: `programs.${name}`,
            detail: "No risk rules; unmatched commands default to device-write.",
          });
        if ("find" in program.install && !program.install.hint)
          warnings.push({
            code: "hint",
            path: `programs.${name}.install`,
            detail: "find needs an installation hint.",
          });
      }
    }
    signal.throwIfAborted();
    return {
      errors: described(pkg.issues),
      warnings: warnings.slice(0, 64),
      truncated: warnings.length > 64,
    };
  },
};
async function prepare(ctx: ToolContext, raw: unknown, signal: AbortSignal): Promise<PreparedChange> {
  signal = toolSignal(ctx, signal);
  const guard = await toolPathGuard(ctx);
  signal.throwIfAborted();
  const host = ctx.change,
    store = ctx.pluginBuilder;
  if (!host || !store) throw Error("Plugin builder host is unavailable.");
  host.assertWritable?.();
  const { path } = params.parse(raw);
  const {
    target,
    pkg: { manifest, issues, sha256 },
  } = await inspectDraft(guard, path, signal);
  if (issues.length || !manifest)
    throw Error(
      `Invalid plugin draft. Fix these and run plugin_validate: ${described(issues)
        .map((issue) => issue.detail)
        .join(" ")}`,
    );
  try {
    await waitForAbort(store.assertTrialReplaceable(manifest.id, signal), signal);
  } catch (error) {
    if (veraErrorSchema.safeParse(error).data?.code === "DENIED")
      throw Error(
        `Plugin ${manifest.id} is already installed and cannot be replaced as a trial. Choose a different ID or update an existing trial.`,
      );
    throw error;
  }
  guard.assertAuthorized();
  const request = Object.freeze({
    tool: "plugin_install" as const,
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    path: target.relative,
    args: Object.freeze({ path: target.absolute }),
    existed: false,
    beforeSha256: null,
    afterSha256: sha256,
    diff: JSON.stringify(manifest, null, 2),
    bytes: 0,
    protected: true,
  });
  let consumed = false;
  return {
    request,
    apply: async (applySignal) => {
      if (consumed) throw Error("Plugin install was already consumed.");
      consumed = true;
      const installSignal = AbortSignal.any([signal, applySignal]);
      installSignal.throwIfAborted();
      host.assertWritable?.();
      guard.assertAuthorized();
      const currentGuard = await toolPathGuard(ctx);
      installSignal.throwIfAborted();
      try {
        if ((await draftPath(currentGuard, path)).absolute !== target.absolute) throw veraError("CONFLICT");
        const installed = await store.installTrial(
          target.absolute,
          sha256,
          () => {
            guard.assertAuthorized();
            installSignal.throwIfAborted();
            host.assertWritable?.();
          },
          installSignal,
        );
        return { plugin: installed, enabledByInstall: false };
      } catch (error) {
        installSignal.throwIfAborted();
        // After the approval the model would otherwise learn only that the tool failed.
        throw explained(error, {
          DENIED: `Plugin ${manifest.id} is installed and is not a trial, so it cannot be replaced. Choose a different ID.`,
          INVALID: "The draft is no longer a valid plugin. Run plugin_validate and fix what it reports.",
        });
      }
    },
  };
}
export const pluginInstallTool: ToolDefinition = {
  name: "plugin_install",
  class: "program",
  description:
    "Request the user's review of a plugin draft (absolute outside sources require Bypass; VERA application data is refused) and install the exact reviewed files as trial. Always asks, including Bypass. The result includes enabledByInstall:false; existing workbench enablement stays in effect. Does not provision or promote plugins.",
  params,
  prepare,
  execute: async () => {
    throw Error("Plugin installation requires a prepared user approval.");
  },
};
