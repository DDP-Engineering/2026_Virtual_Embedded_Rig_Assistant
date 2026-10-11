import type { PermissionMode } from "@vera/shared";
import type { ToolDef } from "./types.js";

export interface PermissionEngine {
  allow(
    request: { sessionId: string; mode: PermissionMode; tool: ToolDef; args: unknown },
    signal: AbortSignal,
  ): boolean | Promise<boolean>;
}
/** M1 executes read tools. Prepared writes and their approval lifecycle are supplied by WP17. */
export const readPermissions: PermissionEngine = { allow: ({ tool }) => tool.class === "read" };
