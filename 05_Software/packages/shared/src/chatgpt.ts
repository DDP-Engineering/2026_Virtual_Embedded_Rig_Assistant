import { z } from "zod";
import { veraErrorSchema } from "./errors.js";

export const chatgptLoginSchema = z.union([
  z.strictObject({ storageConsent: z.boolean().optional() }),
  z.strictObject({ manualCode: z.string().trim().min(1).max(16384), promptId: z.string().min(1).max(80) }),
]);
export const chatgptStatusSchema = z.strictObject({
  connected: z.boolean(),
  expiresAt: z.iso.datetime().optional(),
  state: z.enum(["idle", "pending", "manual", "error", "consent-required"]),
  promptId: z.string().min(1).max(80).optional(),
  error: veraErrorSchema.optional(),
});
export type ChatgptLogin = z.infer<typeof chatgptLoginSchema>;
export type ChatgptStatus = z.infer<typeof chatgptStatusSchema>;
