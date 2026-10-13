import { z } from "zod";

export const updateModeSchema = z.enum(["off", "notify", "download"]);
export const updateChannelSchema = z.enum(["latest", "beta"]);
export const updateOfferSchema = z.strictObject({
  version: z.string().min(1).max(128),
  notes: z.string().max(65536),
  link: z
    .url({ protocol: /^https?$/ })
    .max(16384)
    .nullable(),
});
export const updateSnapshotSchema = z.strictObject({
  distribution: z.enum(["installed", "portable", "managed"]),
  configured: z.boolean(),
  phase: z.enum(["idle", "checking", "current", "available", "downloading", "ready", "deferred", "error"]),
  offer: updateOfferSchema.nullable(),
  progress: z.number().min(0).max(100).nullable(),
  errorCode: z.enum(["NETWORK", "INTEGRITY", "UNCONFIGURED", "INSTALL"]).nullable(),
});
export type UpdateMode = z.infer<typeof updateModeSchema>;
export type UpdateChannel = z.infer<typeof updateChannelSchema>;
export type UpdateOffer = z.infer<typeof updateOfferSchema>;
export type UpdateSnapshot = z.infer<typeof updateSnapshotSchema>;
