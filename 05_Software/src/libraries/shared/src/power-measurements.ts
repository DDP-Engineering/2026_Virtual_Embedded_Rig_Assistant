// Power measurement file, format 1 (spec REQ-DATA-4dc5e2c7 "Measurement file"): a P/Q/S and harmonic profile at
// one board with declared time, units and sign conventions; rows inline or in a CSV file next to it. The schema checks
// the shape; core/src/electrical/measurements.ts checks units, columns, rows and timestamps on top of it.
import { z } from "zod";
import { electricalIdSchema } from "./electrical-model.js";

/** Measurement files, `<id>.json` (and an optional `<id>.csv`), in this workbench folder. */
export const powerMeasurementsDir = "electrical-automation-measurements";
export const powerMeasurementLimits = { columns: 64, rows: 20000, fileBytes: 4 * 1024 * 1024 } as const;
export const measurementQuantities = [
  "time",
  "activePower",
  "reactivePower",
  "apparentPower",
  "voltage",
  "current",
  "powerFactor",
  "displacementFactor",
  "thdCurrent",
  "thdVoltage",
  "harmonicCurrent",
  "harmonicVoltage",
] as const;
export type MeasurementQuantity = (typeof measurementQuantities)[number];

const CONTROL = /\p{Cc}/u;
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value), "must not contain control characters");
const short = text(200);
const amount = z.strictObject({ value: z.number().positive(), unit: z.string().min(1).max(16) });

export const powerMeasurementColumnSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[^,"\p{Cc}]+$/u, "must not contain a comma, a quote or control characters"),
  quantity: z.enum(measurementQuantities),
  unit: z.string().min(1).max(16).optional(),
  order: z.number().int().min(2).max(50).optional(),
});
export const powerMeasurementsSchema = z
  .strictObject({
    kind: z.literal("vera-power-measurements"),
    format: z.literal(1),
    id: electricalIdSchema,
    title: short,
    origin: z.enum(["measured", "fictional"]),
    source: z.strictObject({
      title: short,
      publisher: short.optional(),
      revision: short.optional(),
      uri: text(2000).optional(),
      license: short,
      readAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date YYYY-MM-DD")
        .optional(),
      note: text(1000).optional(),
    }),
    board: electricalIdSchema,
    interval: z.strictObject({ value: z.number().positive(), unit: z.enum(["s", "min", "h"]) }),
    conventions: z.strictObject({
      power: z.enum(["load", "generator"]),
      reactive: z.enum(["fundamental", "nonactive", "undeclared"]),
      reactiveSign: z.enum(["inductive-positive", "capacitive-positive"]),
      powerFactor: z.enum(["unsigned", "lead-negative"]),
    }),
    nominalVoltage: amount,
    frequency: z.strictObject({ value: z.number().positive(), unit: z.literal("Hz") }),
    columns: z.array(powerMeasurementColumnSchema).min(2).max(powerMeasurementLimits.columns),
    rows: z
      .array(z.array(z.union([z.string().max(64), z.number(), z.null()])))
      .min(1)
      .max(powerMeasurementLimits.rows)
      .optional(),
    csv: z
      .string()
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+\.csv$/, "must be a file name <id>.csv")
      .optional(),
  })
  .refine((file) => (file.rows === undefined) !== (file.csv === undefined), {
    message: "give either rows or csv",
    path: ["rows"],
  });
export type PowerMeasurements = z.infer<typeof powerMeasurementsSchema>;
export type PowerMeasurementColumn = z.infer<typeof powerMeasurementColumnSchema>;
