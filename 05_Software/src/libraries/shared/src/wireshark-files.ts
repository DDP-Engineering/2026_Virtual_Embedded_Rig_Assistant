import { z } from "zod";
import {
  captureDisplayFilterSchema,
  captureFieldsSchema,
  captureFormatSchema,
  captureLimits,
  captureSourceSchema,
} from "./wireshark.js";

export const captureFileLimits = {
  inputBytes: captureLimits.captureBytes,
  outputBytes: captureLimits.captureBytes,
  inputs: 8,
  parts: 16,
  chronologicalRuns: 24,
  interfaces: 64,
  selectionRanges: 512,
  dedupWindow: 256,
  reportRows: 200,
  objectBytes: 256 * 1024,
  lineageRanges: 128,
} as const;

const frame = z.number().int().min(1).max(captureLimits.scanFrames);
const epoch = z.string().regex(/^-?\d{1,12}(?:\.\d{1,9})?$/);
const decimalSeconds = z
  .string()
  .regex(/^\d{1,8}(?:\.\d{1,9})?$/)
  .refine((value) => Number(value) > 0);
const range = z.strictObject({ first: frame, last: frame }).refine(({ first, last }) => first <= last);
const selection = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("frames"),
    ranges: z.array(range).min(1).max(captureFileLimits.selectionRanges),
  }),
  z.strictObject({ kind: z.literal("filter"), filter: captureDisplayFilterSchema }),
  z.strictObject({ kind: z.literal("time"), from: epoch, until: epoch }),
]);
const by = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("count"), packets: frame }),
  z.strictObject({ kind: z.literal("time"), seconds: decimalSeconds }),
]);
const remove = z
  .array(z.enum(["capture_comments", "packet_comments", "secrets"]))
  .min(1)
  .max(3)
  .refine((values) => new Set(values).size === values.length);
const sources = z.array(captureSourceSchema).min(2).max(captureFileLimits.inputs);
const window = z.number().int().min(2).max(captureFileLimits.dedupWindow);
const tap = z.enum(["ethernet", "ip", "osi3", "osi4", "osi7"]);
const protocol = z.literal("http");
const source = captureSourceSchema;
const outputFormat = captureFormatSchema.optional();
const filter = captureDisplayFilterSchema.optional();

export const deriveCaptureSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("select"), source, selection, outputFormat }),
  z.strictObject({ operation: z.literal("split"), source, by, outputFormat }),
  z.strictObject({ operation: z.literal("merge"), sources, outputFormat }),
  z.strictObject({ operation: z.literal("convert"), source, outputFormat: captureFormatSchema }),
  z.strictObject({ operation: z.literal("reorder"), source, outputFormat }),
  z.strictObject({ operation: z.literal("deduplicate"), source, window }),
  z.strictObject({ operation: z.literal("clean"), source, remove }),
  z.strictObject({ operation: z.literal("export_fields"), source, fields: captureFieldsSchema, filter }),
  z.strictObject({ operation: z.literal("export_pdus"), source, tap, filter }),
  z.strictObject({ operation: z.literal("export_objects"), source, protocol }),
]);
export type DeriveCaptureArgs = z.infer<typeof deriveCaptureSchema>;

export const deriveCaptureToolSchema = z
  .strictObject({
    operation: z.enum([
      "select",
      "split",
      "merge",
      "convert",
      "reorder",
      "deduplicate",
      "clean",
      "export_fields",
      "export_pdus",
      "export_objects",
    ]),
    source: source.optional(),
    sources: sources.optional(),
    selection: selection.optional(),
    by: by.optional(),
    outputFormat,
    remove: remove.optional(),
    window: window.optional(),
    fields: captureFieldsSchema.optional(),
    filter,
    tap: tap.optional(),
    protocol: protocol.optional(),
  })
  .refine((args) => deriveCaptureSchema.safeParse(args).success, {
    message: "Supply only the inputs for the selected capture-file operation.",
  });
