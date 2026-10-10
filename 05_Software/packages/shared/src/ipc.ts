import { z } from "zod";
import { settingsPatchSchema, settingsSnapshotSchema } from "./settings.js";

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
