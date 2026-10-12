import type { PermissionMode } from "@vera/shared";
import type { ChangeRequest } from "../tools/changes.js";
import type { ToolDef } from "./types.js";

export interface PermissionEngine {
  allow(
    request: {
      sessionId: string;
      mode: PermissionMode;
      tool: ToolDef;
      args: unknown;
      prepared?: ChangeRequest;
    },
    signal: AbortSignal,
  ): boolean | Promise<boolean>;
}
/** Explicit host policy for read-only embeddings; the session default owns durable approvals. */
export const readPermissions: PermissionEngine = { allow: ({ tool }) => tool.class === "read" };
