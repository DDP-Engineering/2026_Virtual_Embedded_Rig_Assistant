// REQ-FUNC-bf693078, REQ-FUNC-ef7d2de3
import { lstat } from "node:fs/promises";
import { dangerousToken, ruleNamesProgram, veraError } from "@vera/shared";
import { z } from "zod";
import type { PreparedChange } from "../tools/changes.js";
import { type ToolContext, type ToolDefinition, toolPathGuard, toolSignal } from "../tools/context.js";
import type { PathGuard } from "../workbench/path-guard.js";
import { readPluginPackage } from "./store.js";

const params = z.strictObject({ path: z.string().min(1).max(4096) });
/** Draft source authority comes from the host-selected tool scope. */
async function draftPath(guard: PathGuard, raw: unknown): Promise<string> {
  const { path } = params.parse(raw);
  const target = await guard.resolve(path);
  if (!(await lstat(target.absolute)).isDirectory()) throw Error("Choose a plugin draft folder.");
  return target.absolute;
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
    const path = await draftPath(guard, raw);
    const pkg = await readPluginPackage(path);
    await draftPath(guard, raw);
    const warnings: { code: string; path: string; detail: string }[] = [];
    const manifest = pkg.manifest;
    if (manifest) {
      for (const [index, rule] of manifest.rules.entries()) {
        const token = dangerousToken(rule.match);
        if (token && ["safe", "device-read"].includes(rule.risk))
          warnings.push({ code: "token", path: `rules.${index}`, detail: `${token} at ${rule.risk}` });
      }
      for (const [name, program] of Object.entries(manifest.programs)) {
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
  const path = await draftPath(guard, raw);
  const review = await store.review(path);
  signal.throwIfAborted();
  await draftPath(guard, raw);
  if (review.issues.length || !review.manifest)
    throw Error(`Invalid plugin draft: ${JSON.stringify(review.issues)}`);
  const request = Object.freeze({
    tool: "plugin_install" as const,
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    path: (await guard.resolve(params.parse(raw).path)).relative,
    args: Object.freeze({ path }),
    existed: false,
    beforeSha256: null,
    afterSha256: review.sha256,
    diff: JSON.stringify(review.manifest, null, 2),
    bytes: 0,
    protected: true,
  });
  let consumed = false;
  return {
    request,
    apply: async (applySignal) => {
      if (consumed) throw Error("Plugin install was already consumed.");
      consumed = true;
      signal.throwIfAborted();
      applySignal.throwIfAborted();
      host.assertWritable?.();
      guard.assertAuthorized();
      const currentGuard = await toolPathGuard(ctx);
      signal.throwIfAborted();
      if ((await draftPath(currentGuard, raw)) !== path) throw veraError("CONFLICT");
      const installed = await store.installTrial(path, review.sha256, () => {
        guard.assertAuthorized();
        signal.throwIfAborted();
        applySignal.throwIfAborted();
        host.assertWritable?.();
      });
      return { plugin: installed, enabled: false };
    },
  };
}
export const pluginInstallTool: ToolDefinition = {
  name: "plugin_install",
  class: "program",
  description:
    "Request the user's review of a plugin draft (absolute outside sources require Bypass; VERA application data is refused) and install the exact reviewed files as trial. Always asks, including bypass. Does not enable, provision or promote plugins.",
  params,
  prepare,
  execute: async () => {
    throw Error("Plugin installation requires a prepared user approval.");
  },
};
