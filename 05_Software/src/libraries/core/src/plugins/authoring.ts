// REQ-FUNC-bf693078, REQ-FUNC-ef7d2de3
import { lstat } from "node:fs/promises";
import { dangerousToken, ruleNamesProgram, veraError } from "@vera/shared";
import { z } from "zod";
import type { PreparedChange } from "../tools/changes.js";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import { readPluginPackage } from "./store.js";

const params = z.strictObject({ path: z.string().min(1).max(4096) });
/** Drafts stay in the workbench even when ordinary file tools have bypass scope. */
async function draftPath(ctx: ToolContext, raw: unknown): Promise<string> {
  const { path } = params.parse(raw);
  const target = await (await PathGuard.create(ctx.root)).resolve(path);
  if (!(await lstat(target.absolute)).isDirectory()) throw Error("Choose a plugin draft folder.");
  return target.absolute;
}
export const pluginValidateTool: ToolDefinition = {
  name: "plugin_validate",
  class: "read",
  description:
    "Validate a workbench plugin draft folder. Returns schema errors and lint warnings; installs nothing.",
  params,
  execute: async (ctx, raw, signal) => {
    signal.throwIfAborted();
    const pkg = await readPluginPackage(await draftPath(ctx, raw));
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
  signal.throwIfAborted();
  const host = ctx.change,
    store = ctx.pluginBuilder;
  if (!host || !store) throw Error("Plugin builder host is unavailable.");
  host.assertWritable?.();
  const path = await draftPath(ctx, raw);
  const review = await store.review(path);
  if (review.issues.length || !review.manifest)
    throw Error(`Invalid plugin draft: ${JSON.stringify(review.issues)}`);
  const request = Object.freeze({
    tool: "plugin_install" as const,
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    path: params.parse(raw).path,
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
      if ((await draftPath(ctx, raw)) !== path) throw veraError("CONFLICT");
      const installed = await store.installTrial(path, review.sha256, () => {
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
    "Request the user's review of a workbench plugin draft and install the exact reviewed files as trial. Always asks, including bypass. Does not enable, provision or promote plugins.",
  params,
  prepare,
  execute: async () => {
    throw Error("Plugin installation requires a prepared user approval.");
  },
};
