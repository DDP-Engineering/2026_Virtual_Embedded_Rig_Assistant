import { z } from "zod";
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
