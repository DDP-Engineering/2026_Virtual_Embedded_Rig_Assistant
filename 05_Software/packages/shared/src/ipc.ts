import { z } from "zod";
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

export const veraErrorSchema = z.strictObject({
  code: z.enum([
    "INVALID",
    "NOT_FOUND",
    "CONFLICT",
    "BUSY",
    "DENIED",
    "CONTEXT_LIMIT",
    "PROVIDER",
    "OFFLINE",
    "INTERNAL",
    "WORKBENCH_TOO_NEW",
  ]),
  messageKey: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number().finite()])).optional(),
});
export type VeraError = z.infer<typeof veraErrorSchema>;
export const veraError = (code: VeraError["code"]): VeraError => ({ code, messageKey: `errors.${code}` });

export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  portable: z.boolean(),
  locale: z.string().min(1),
});
export const channels = {
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
  "workbench.config.get": defineChannel("workbench.config.get", z.strictObject({}), configSnapshotSchema),
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
