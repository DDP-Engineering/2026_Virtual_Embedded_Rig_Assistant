import type { PermissionMode } from "@vera/shared";
import type { z } from "zod";
import type { ArtifactHost } from "../artifacts/store.js";
import type { DocumentKnowledge } from "../knowledge/search.js";
import type { WorkerPool } from "../ports.js";
import type { SkillCatalog } from "../skills/catalog.js";
import { PathGuard } from "../workbench/path-guard.js";
import type { ChangeHost, PreparedChange } from "./changes.js";
import type { TodoHost } from "./todo.js";

export interface ReadFingerprint {
  sha256: string;
  mtimeMs: number;
}
export interface ToolContext {
  root: string;
  permissionMode?: () => PermissionMode;
  bypassSignal?: () => AbortSignal;
  workers?: WorkerPool;
  lastReads: Map<string, ReadFingerprint>;
  change?: ChangeHost;
  artifacts?: ArtifactHost;
  todos?: TodoHost;
  knowledge?: DocumentKnowledge;
  skills?: SkillCatalog;
}
export interface ToolDefinition {
  name: string;
  class: "read" | "write" | "session";
  description: string;
  params: z.ZodType;
  prepare?(ctx: ToolContext, args: unknown, signal: AbortSignal): Promise<PreparedChange>;
  execute(ctx: ToolContext, args: unknown, signal: AbortSignal): Promise<Record<string, unknown>>;
}
export function createToolContext(root: string, workers?: WorkerPool): ToolContext {
  return { root, ...(workers ? { workers } : {}), lastReads: new Map() };
}

/** Scope comes from the host's current session mode, never from model arguments. */
export function toolSignal(ctx: ToolContext, signal: AbortSignal): AbortSignal {
  return ctx.permissionMode?.() === "bypass" && ctx.bypassSignal
    ? AbortSignal.any([signal, ctx.bypassSignal()])
    : signal;
}
export async function toolPathGuard(ctx: ToolContext): Promise<PathGuard> {
  if (ctx.permissionMode?.() !== "bypass") return PathGuard.create(ctx.root);
  return PathGuard.create(ctx.root, ctx.root, "filesystem", () => {
    if (ctx.permissionMode?.() !== "bypass")
      throw Error("Bypass file access was revoked. Retry under the current permission mode.");
  });
}
