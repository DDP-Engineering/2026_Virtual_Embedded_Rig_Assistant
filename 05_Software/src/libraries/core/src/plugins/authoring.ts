// REQ-FUNC-bf693078, REQ-FUNC-ef7d2de3
import { lstat } from "node:fs/promises";
import { dangerousToken, ruleNamesProgram, veraError, veraErrorSchema } from "@vera/shared";
import { z } from "zod";
import { waitForAbort } from "../abort.js";
import type { PreparedChange } from "../tools/changes.js";
import { type ToolContext, type ToolDefinition, toolPathGuard, toolSignal } from "../tools/context.js";
import type { PathGuard } from "../workbench/path-guard.js";
import { readPluginPackage } from "./store.js";

const params = z.strictObject({ path: z.string().min(1).max(4096) });
/** Draft source authority comes from the host-selected tool scope. */
async function draftPath(guard: PathGuard, path: string) {
  const target = await guard.resolve(path);
  if (!(await lstat(target.absolute)).isDirectory()) throw Error("Choose a plugin draft folder.");
  return target;
}

async function inspectDraft(guard: PathGuard, path: string, signal: AbortSignal) {
  const target = await draftPath(guard, path);
  signal.throwIfAborted();
  const pkg = await waitForAbort(readPluginPackage(target.absolute, signal), signal);
  if ((await draftPath(guard, path)).absolute !== target.absolute) throw veraError("CONFLICT");
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
    return { errors: pkg.issues, warnings: warnings.slice(0, 64), truncated: warnings.length > 64 };
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
  if (issues.length || !manifest) throw Error(`Invalid plugin draft: ${JSON.stringify(issues)}`);
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
