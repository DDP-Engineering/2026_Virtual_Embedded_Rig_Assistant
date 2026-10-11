import { z } from "zod";
import { type VeraError, veraErrorSchema } from "./errors.js";
import {
  modelReferenceSchema,
  providerCatalogSchema,
  providerListSchema,
  providerModelsRequestSchema,
  providerRemoveSchema,
  providerSaveResultSchema,
  providerSaveSchema,
  providerTestRequestSchema,
  providerTestResultSchema,
} from "./providers.js";
import { permissionModeSchema, sessionIdSchema, sessionSummarySchema } from "./session.js";
import { sessionStateSchema } from "./session-state.js";
import { recentWorkbenchStateSchema, settingsPatchSchema, settingsSnapshotSchema } from "./settings.js";
import {
  configSnapshotSchema,
  pinnedSchema,
  workbenchPatchSchema,
  workbenchSnapshotSchema,
} from "./workbench.js";

export function defineChannel<const Name extends string, Req extends z.ZodType, Res extends z.ZodType>(
  name: Name,
  request: Req,
  response: Res,
) {
  return { name, request, response } as const;
}

export { type VeraError, veraError, veraErrorSchema } from "./errors.js";
export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  portable: z.boolean(),
  locale: z.string().min(1),
});
export const channels = {
  "session.list": defineChannel("session.list", z.strictObject({}), z.array(sessionSummarySchema)),
  "session.create": defineChannel(
    "session.create",
    z.strictObject({
      modelRef: modelReferenceSchema.nullable().optional(),
      mode: permissionModeSchema.optional(),
    }),
    sessionSummarySchema,
  ),
  "session.get": defineChannel(
    "session.get",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.strictObject({
      snapshot: sessionStateSchema,
      seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
  ),
  "session.rename": defineChannel(
    "session.rename",
    z.strictObject({ sessionId: sessionIdSchema, title: z.string().trim().min(1).max(60) }),
    sessionSummarySchema,
  ),
  "session.delete": defineChannel(
    "session.delete",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.strictObject({}),
  ),
  "session.send": defineChannel(
    "session.send",
    z.strictObject({
      sessionId: sessionIdSchema,
      text: z.string().refine((value) => value.trim().length > 0),
    }),
    z.strictObject({ turnId: z.string().min(1), messageId: z.string().min(1) }),
  ),
  "session.stop": defineChannel(
    "session.stop",
    z.strictObject({ sessionId: sessionIdSchema }),
    z.strictObject({ stopped: z.boolean() }),
  ),
  "session.model.set": defineChannel(
    "session.model.set",
    z.strictObject({ sessionId: sessionIdSchema, modelRef: modelReferenceSchema.nullable() }),
    sessionSummarySchema,
  ),
  "session.mode.set": defineChannel(
    "session.mode.set",
    z.strictObject({ sessionId: sessionIdSchema, mode: permissionModeSchema }),
    sessionSummarySchema,
  ),
  "providers.models": defineChannel("providers.models", providerModelsRequestSchema, providerCatalogSchema),
  "providers.test": defineChannel("providers.test", providerTestRequestSchema, providerTestResultSchema),
  "providers.list": defineChannel("providers.list", z.strictObject({}), providerListSchema),
  "providers.save": defineChannel("providers.save", providerSaveSchema, providerSaveResultSchema),
  "providers.remove": defineChannel("providers.remove", providerRemoveSchema, z.strictObject({})),
  "app.info": defineChannel("app.info", z.strictObject({}), appInfoSchema),
  "app.settings.get": defineChannel("app.settings.get", z.strictObject({}), settingsSnapshotSchema),
  "app.settings.update": defineChannel("app.settings.update", settingsPatchSchema, settingsSnapshotSchema),
  "app.chooseFolder": defineChannel(
    "app.chooseFolder",
    z.strictObject({}),
    z.strictObject({ folder: z.string().min(1).nullable() }),
  ),
  "workbench.create": defineChannel(
    "workbench.create",
    z.strictObject({ folder: z.string().min(1), name: z.string().trim().min(1).max(80) }),
    workbenchSnapshotSchema,
  ),
  "workbench.open": defineChannel(
    "workbench.open",
    z.strictObject({ folder: z.string().min(1) }),
    workbenchSnapshotSchema,
  ),
  "workbench.close": defineChannel("workbench.close", z.strictObject({}), z.strictObject({})),
  "workbench.recent": defineChannel(
    "workbench.recent",
    z.strictObject({ remove: z.string().min(1).optional() }),
    z.array(recentWorkbenchStateSchema).max(10),
  ),
  "workbench.config.get": defineChannel(
    "workbench.config.get",
    z.strictObject({}),
    configSnapshotSchema.extend({ readOnly: z.boolean().optional(), folder: z.string().min(1).optional() }),
  ),
  "workbench.config.update": defineChannel(
    "workbench.config.update",
    z.strictObject({ patch: workbenchPatchSchema }),
    configSnapshotSchema,
  ),
  "workbench.pinned.get": defineChannel("workbench.pinned.get", z.strictObject({}), pinnedSchema),
  "workbench.pinned.update": defineChannel(
    "workbench.pinned.update",
    z.strictObject({ content: z.string() }),
    pinnedSchema,
  ),
  "workbench.files": defineChannel(
    "workbench.files",
    z.strictObject({ query: z.string().max(1024) }),
    z.array(z.string().min(1)).max(50),
  ),
} as const;
export type Channel = keyof typeof channels;
export type Request<C extends Channel> = z.input<(typeof channels)[C]["request"]>;
export type Response<C extends Channel> = z.output<(typeof channels)[C]["response"]>;
export type AppInfo = Response<"app.info">;
export type InvokeResult<C extends Channel> =
  | { ok: true; value: Response<C> }
  | { ok: false; error: VeraError };

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && Object.hasOwn(channels, value);
}
export function resultSchema<C extends Channel>(channel: C): z.ZodType<InvokeResult<C>> {
  return z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), value: channels[channel].response }),
    z.strictObject({ ok: z.literal(false), error: veraErrorSchema }),
  ]) as z.ZodType<InvokeResult<C>>;
}
