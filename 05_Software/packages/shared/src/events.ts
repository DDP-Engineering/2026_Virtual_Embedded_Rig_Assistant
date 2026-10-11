import { z } from "zod";
import type { Channel, Request, Response } from "./ipc.js";
import {
  workbenchIdSchema,
  workbenchSchema,
  workbenchSnapshotSchema,
  workbenchWarningSchema,
} from "./workbench.js";

export const appEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("settings.changed") }),
]);
export type AppEvent = z.infer<typeof appEventSchema>;
export const workbenchEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("opened"), workbench: workbenchSnapshotSchema }),
  z.strictObject({ type: z.literal("closed") }),
  z.strictObject({
    type: z.literal("config.changed"),
    config: workbenchSchema,
    warnings: z.array(workbenchWarningSchema),
  }),
]);
export type WorkbenchEvent = z.infer<typeof workbenchEventSchema>;
export const eventEnvelopeSchema = z.discriminatedUnion("topic", [
  z.strictObject({
    topic: z.literal("app"),
    id: z.literal("app"),
    seq: z.number().int().nonnegative().optional(),
    event: appEventSchema,
  }),
  z.strictObject({ topic: z.literal("workbench"), id: workbenchIdSchema, event: workbenchEventSchema }),
]);
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export interface VeraBridge {
  invoke<C extends Channel>(channel: C, request: Request<C>): Promise<Response<C>>;
  subscribe(topic: "app", on: (event: AppEvent) => void): () => void;
  subscribe(topic: "workbench", id: string, on: (event: WorkbenchEvent) => void): () => void;
}
