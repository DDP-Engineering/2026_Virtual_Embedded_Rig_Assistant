import type { ImageContent } from "@earendil-works/pi-ai";
import type { PermissionMode } from "@vera/shared";
import type { z } from "zod";
import type { ArtifactHost } from "../artifacts/store.js";
import type { DocumentKnowledge } from "../knowledge/search.js";
import type { PartsSearcher } from "../parts/configured.js";
import type { ProgramContext } from "../plugins/program-tools.js";
import type { PluginStore } from "../plugins/store.js";
import type { WorkerPool } from "../ports.js";
import type { SkillCatalog } from "../skills/catalog.js";
import type { WebDownloads } from "../web/downloads.js";
import type { WebProvider } from "../web/provider.js";
import { PathGuard } from "../workbench/path-guard.js";
import type { ChangeHost, PreparedChange } from "./changes.js";
import type { HelpHost } from "./help.js";
import type { TerminalReader } from "./terminal-read.js";
import type { TodoHost } from "./todo.js";

export interface ReadFingerprint {
  sha256: string;
  mtimeMs: number;
}
export interface ToolContext {
  terminals?: TerminalReader;
  root: string;
  hasDeliveredImage?: (path: string) => boolean;
  permissionMode?: () => PermissionMode;
  bypassSignal?: () => AbortSignal;
  /** Live host-owned user grants; only ordinary file tools and command cwd use them. */
  additionalFolders?: () => readonly string[];
  workers?: WorkerPool;
  lastReads: Map<string, ReadFingerprint>;
  change?: ChangeHost;
  artifacts?: ArtifactHost;
  todos?: TodoHost;
  knowledge?: DocumentKnowledge;
  web?: WebProvider;
  downloads?: WebDownloads;
  /** Supplier catalog search of the official parts-search plugin; the host keeps every credential. */
  parts?: PartsSearcher;
  skills?: SkillCatalog;
  /** VERA's own help; absent hosts never offer the help tool. */
  help?: HelpHost;
  /** Plugin programs of the session; absent when the host composes no program host. */
  programs?: ProgramContext;
  pluginBuilder?: PluginStore;
  /** Host-owned application data: never accessible through agent file paths, even in bypass. */
  managedRoots?: readonly string[];
}
export interface ToolDefinition {
  /** Recheck a revocable read immediately before runtime disclosure. */
  publish?(ctx: ToolContext, args: unknown, output: string): string;
  name: string;
  /** `program` tools ask the approval gate per command line, in every permission mode. */
  class: "read" | "write" | "session" | "program";
  description: string;
  requiresImages?: true;
  params: z.ZodType;
  prepare?(ctx: ToolContext, args: unknown, signal: AbortSignal): Promise<PreparedChange>;
  execute(
    ctx: ToolContext,
    args: unknown,
    signal: AbortSignal,
  ): Promise<Record<string, unknown> & { image?: ImageContent }>;
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
/** Exclusions belong to the host; internal plugin/credential readers retain their own authority. */
export function toolExcludedRoots(ctx: ToolContext): readonly string[] {
  return [...(ctx.managedRoots ?? []), ...(ctx.pluginBuilder ? [ctx.pluginBuilder.root] : [])];
}
export async function toolPathGuard(ctx: ToolContext, additional = false): Promise<PathGuard> {
  const epoch = ctx.permissionMode?.() === "bypass" ? ctx.bypassSignal?.() : undefined;
  const excluded = toolExcludedRoots(ctx);
  if (ctx.permissionMode?.() !== "bypass") {
    const folders = additional ? [...(ctx.additionalFolders?.() ?? [])] : [];
    const version = JSON.stringify(folders);
    return PathGuard.create(
      ctx.root,
      ctx.root,
      "workbench",
      () => {
        if (additional && JSON.stringify(ctx.additionalFolders?.() ?? []) !== version)
          throw Error(
            "Additional folder access was revoked. Retry under the current workbench configuration.",
          );
      },
      excluded,
      folders,
    );
  }
  return PathGuard.create(
    ctx.root,
    ctx.root,
    "filesystem",
    () => {
      epoch?.throwIfAborted();
      if (ctx.permissionMode?.() !== "bypass")
        throw Error("Bypass file access was revoked. Retry under the current permission mode.");
    },
    excluded,
  );
}
