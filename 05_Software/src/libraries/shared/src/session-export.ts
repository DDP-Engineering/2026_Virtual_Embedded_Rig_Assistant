import { z } from "zod";
import { isLiveSessionEvent, sessionEventSchema } from "./events.js";
import { sessionSummarySchema } from "./session.js";

export const sessionSearchQuerySchema = z.string().trim().min(1).max(1000);
export const sessionExportFormatSchema = z.enum(["md", "json"]);
/** Archival durable events; identities and sequence order survive JSON serialization. */
export const sessionExportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  session: sessionSummarySchema,
  events: z
    .array(
      z.strictObject({
        seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        createdAt: z.string().datetime().nullable(),
        event: sessionEventSchema.refine((event) => !isLiveSessionEvent(event)),
      }),
    )
    .refine((rows) => rows.every((row, index) => index === 0 || row.seq > (rows[index - 1]?.seq ?? 0))),
});
export type SessionExport = z.infer<typeof sessionExportSchema>;
export type SessionExportFormat = z.infer<typeof sessionExportFormatSchema>;
