import { z } from "zod";
import type { Channel, Request, Response } from "./ipc.js";

export const appEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("settings.changed") }),
]);
export type AppEvent = z.infer<typeof appEventSchema>;
export const eventEnvelopeSchema = z.strictObject({
  topic: z.literal("app"),
  id: z.literal("app"),
  seq: z.number().int().nonnegative().optional(),
  event: appEventSchema,
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export interface VeraBridge {
  invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>>;
  subscribe(topic: "app", on: (event: AppEvent) => void): () => void;
}
