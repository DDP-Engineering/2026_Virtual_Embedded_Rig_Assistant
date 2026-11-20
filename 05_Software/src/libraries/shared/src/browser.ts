import { z } from "zod";
import { workbenchIdSchema } from "./workbench.js";

export const browserFailureCodeSchema = z.enum([
  "unsupported-platform",
  "runtime-missing",
  "integrity",
  "download",
  "cleanup",
  "storage",
  "prerequisite",
  "sandbox-unavailable",
  "remote-launch-configured",
  "launch",
  "startup-timeout",
  "policy-denied",
  "policy-unavailable",
  "destination-denied",
  "resource-limit",
  "session-limit",
  "stale-reference",
  "page-closed",
  "window-closed",
  "unsupported-content",
  "operation-timeout",
  "operation-limit",
  "navigation-failed",
  "operation-failed",
  "tab-limit",
  "cancelled",
]);
export type BrowserFailureCode = z.infer<typeof browserFailureCodeSchema>;

export const browserRuntimeViewSchema = z.discriminatedUnion("phase", [
  z.strictObject({
    phase: z.enum(["unknown", "missing", "verifying", "installing", "cancelled", "removing"]),
  }),
  z.strictObject({
    phase: z.literal("downloading"),
    received: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  }),
  z.strictObject({ phase: z.literal("ready"), version: z.string().max(40) }),
  z.strictObject({ phase: z.literal("failed"), failure: browserFailureCodeSchema }),
]);
export type BrowserRuntimeView = z.infer<typeof browserRuntimeViewSchema>;

export const browserSettingsSchema = z.strictObject({
  runtime: browserRuntimeViewSchema,
  appEnabled: z.boolean(),
  workbench: z
    .strictObject({ id: workbenchIdSchema, enabled: z.boolean(), readOnly: z.boolean() })
    .nullable(),
});

export const browserSessionViewSchema = z.strictObject({
  enabled: z.boolean(),
  canGrant: z.boolean(),
  origins: z.array(z.string().max(4096)).max(32),
  busy: z.boolean(),
  open: z.boolean(),
  currentUrl: z.string().max(4096).nullable(),
  failure: browserFailureCodeSchema.nullable(),
});
export type BrowserSessionView = z.infer<typeof browserSessionViewSchema>;
