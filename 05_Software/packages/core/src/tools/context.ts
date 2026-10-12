import type { z } from "zod";
import type { ArtifactHost } from "../artifacts/store.js";
import type { DocumentKnowledge } from "../knowledge/search.js";
import type { WorkerPool } from "../ports.js";
import type { ChangeHost, PreparedChange } from "./changes.js";
import type { TodoHost } from "./todo.js";

export interface ReadFingerprint {
  sha256: string;
  mtimeMs: number;
}
export interface ToolContext {
  root: string;
  workers?: WorkerPool;
  lastReads: Map<string, ReadFingerprint>;
  change?: ChangeHost;
  artifacts?: ArtifactHost;
  todos?: TodoHost;
  knowledge?: DocumentKnowledge;
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
