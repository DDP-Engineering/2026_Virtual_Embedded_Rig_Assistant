import type { ImageContent } from "@earendil-works/pi-ai";
import { type AdvancedKey, type AdvancedValueOf, advancedSettings, type PermissionMode } from "@vera/shared";
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
import type { LiveCaptureSessions } from "../wireshark/live-session.js";
import type { CaptureWriteAccess } from "../wireshark/storage.js";
import { PathGuard } from "../workbench/path-guard.js";
import type { AskUser } from "./ask-user.js";
import type { AgentBrowserPort } from "./browser.js";
import type { ChangeHost, PreparedChange } from "./changes.js";
import type { DelegatedSessionToolHost } from "./delegated-sessions.js";
import type { HelpHost } from "./help.js";
import type { TerminalReader } from "./terminal-read.js";
import type { TodoHost } from "./todo.js";

export interface ReadFingerprint {
  sha256: string;
  mtimeMs: number;
}
export interface ToolContext {
  /** Delegated authority is assigned by SessionService for every turn of a child. */
  delegated?: true;
  delegation?: DelegatedSessionToolHost;
  terminals?: TerminalReader;
  root: string;
  hasDeliveredImage?: (path: string) => boolean;
  permissionMode?: () => PermissionMode;
  /** The session's resolved Advanced value of a key, read at each call so changes apply live. */
  advanced?: <K extends AdvancedKey>(key: K) => AdvancedValueOf<K>;
  bypassSignal?: () => AbortSignal;
  /** Live host-owned user grants; only ordinary file tools and command cwd use them. */
  additionalFolders?: () => readonly string[];
  workers?: WorkerPool;
  lastReads: Map<string, ReadFingerprint>;
  change?: ChangeHost;
  artifacts?: ArtifactHost;
  todos?: TodoHost;
  askUser?: AskUser;
  knowledge?: DocumentKnowledge;
  /** Project extracted text for the agent before dividing it into parts. */
  maskText?: (text: string) => string;
  web?: WebProvider;
  browser?: AgentBrowserPort;
  downloads?: WebDownloads;
  /** Supplier catalog search of the official parts-search plugin; the host keeps every credential. */
  parts?: PartsSearcher;
  skills?: SkillCatalog;
  /** VERA's own help; absent hosts never offer the help tool. */
  help?: HelpHost;
  /** Plugin programs of the session; absent when the host composes no program host. */
  programs?: ProgramContext;
  /** Digest of the enabled official capture plugin at turn binding. */
  wiresharkPackage?: string;
  /** Verified Dumpcap provider and publication authority owned by this workbench. */
  liveCapture?: { packageSha256: string; sessions: LiveCaptureSessions; access: CaptureWriteAccess };
  pluginBuilder?: PluginStore;
  /** Host-owned application data: never accessible through agent file paths, even in bypass. */
  managedRoots?: readonly string[];
}
export interface ToolDefinition {
  /** Live host policy shared by tool binding, dispatch and execution. */
  available?(ctx: ToolContext): boolean;
  /** Recheck a revocable result before disclosure. Structured replacements are capped by the registry. */
  publish?(ctx: ToolContext, args: unknown, output: string): string | Record<string, unknown>;
  name: string;
  /** `program` tools ask the approval gate per command line, in every permission mode. */
  class: "read" | "write" | "session" | "program";
  description: string;
  requiresImages?: true;
  params: z.ZodType;
  prepare?(ctx: ToolContext, args: unknown, signal: AbortSignal): Promise<PreparedChange>;
  /** With deferred publication, onPublish commits the result after its final checks. */
  execute(
    ctx: ToolContext,
    args: unknown,
    signal: AbortSignal,
    callId?: string,
    deferPublish?: boolean,
  ): Promise<Record<string, unknown> & { image?: ImageContent; onPublish?: () => void }>;
}
export function createToolContext(root: string, workers?: WorkerPool): ToolContext {
  return { root, ...(workers ? { workers } : {}), lastReads: new Map() };
}

/** A tool limit from the session's Advanced settings; the registry default where no session resolves one. */
export function toolLimit<K extends AdvancedKey>(ctx: ToolContext, key: K): AdvancedValueOf<K> {
  return ctx.advanced ? ctx.advanced(key) : (advancedSettings[key].default as AdvancedValueOf<K>);
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
export async function toolPathGuard(
  ctx: ToolContext,
  additional = false,
  options: { allowRunLogs?: boolean } = {},
): Promise<PathGuard> {
  const bypass = ctx.permissionMode?.() === "bypass" && (!ctx.delegated || !!ctx.bypassSignal);
  const grantedFolders = additional && !ctx.delegated;
  const excluded = toolExcludedRoots(ctx);
  if (!bypass) {
    const folders = grantedFolders ? [...(ctx.additionalFolders?.() ?? [])] : [];
    const version = JSON.stringify(folders);
    return PathGuard.create(
      ctx.root,
      ctx.root,
      "workbench",
      () => {
        if (grantedFolders && JSON.stringify(ctx.additionalFolders?.() ?? []) !== version)
          throw Error(
            "Additional folder access was revoked. Retry under the current workbench configuration.",
          );
      },
      excluded,
      folders,
      options,
    );
  }
  const epoch = ctx.bypassSignal?.();
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
