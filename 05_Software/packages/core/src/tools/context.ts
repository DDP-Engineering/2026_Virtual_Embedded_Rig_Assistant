import type { z } from "zod";
import type { WorkerPool } from "../ports.js";

export interface ReadFingerprint {
  sha256: string;
  mtimeMs: number;
}
export interface ToolContext {
  root: string;
  workers?: WorkerPool;
  lastReads: Map<string, ReadFingerprint>;
}
export interface ToolDefinition {
  name: string;
  class: "read" | "write" | "session";
  description: string;
  params: z.ZodType;
  execute(ctx: ToolContext, args: unknown, signal: AbortSignal): Promise<Record<string, unknown>>;
}
export function createToolContext(root: string, workers?: WorkerPool): ToolContext {
  return { root, ...(workers ? { workers } : {}), lastReads: new Map() };
}
