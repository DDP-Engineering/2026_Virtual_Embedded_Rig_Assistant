import { z } from "zod";
import { trafficPageCursorSchema } from "./wireshark-traffic.js";

export const automotiveLimits = {
  selectors: 8,
  observationPoints: 16,
  entriesPerPdu: 32,
  framesPerPdu: 48,
  issueFrameSamples: 10,
  nativeTreeBytes: 16 * 1024 * 1024,
} as const;

export const automotiveProfileSchema = z.enum(["doip", "someip", "someip_sd"]);
export type AutomotiveProfile = z.infer<typeof automotiveProfileSchema>;

export const automotiveInputs = {
  automotiveProfile: automotiveProfileSchema,
  vlan: z.number().int().min(0).max(4095).optional(),
  addresses: z
    .array(z.union([z.ipv4(), z.ipv6()]))
    .min(1)
    .max(automotiveLimits.selectors)
    .optional(),
  ports: z.array(z.number().int().min(1).max(65535)).min(1).max(automotiveLimits.selectors).optional(),
  expectedPoints: z
    .array(
      z.strictObject({
        section: z.number().int().positive().max(4_294_967_295),
        interfaceId: z.number().int().nonnegative().max(4_294_967_295),
      }),
    )
    .min(1)
    .max(automotiveLimits.observationPoints)
    .optional(),
  automotiveCursor: trafficPageCursorSchema.optional(),
};
