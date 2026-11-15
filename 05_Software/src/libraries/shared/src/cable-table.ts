// Cable table, format 1 (spec REQ-DATA-42ce122f): current ratings, conductor data and correction factors of one
// cable type, typed from a cited public source. The format fixes its units: mm², A, °C, Ω/km, A·s^0.5/mm².
// core/src/electrical/cable-table.ts checks references, order and links on top of the schema.
import { z } from "zod";
import { electricalIdSchema } from "./electrical-model.js";

/** Cable table files, `<table id>.json`, in this workbench folder. */
export const cableTableDir = "electrical-automation-tables";
export const cableTableLimits = {
  conductors: 40,
  methods: 20,
  ratings: 200,
  points: 30,
  fileBytes: 1024 * 1024,
  files: 50,
} as const;
export const cableMaterials = ["copper", "aluminium"] as const;

const CONTROL = /\p{Cc}/u;
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value), "must not contain control characters");
const short = text(200);
const positive = z.number().positive();
const temperature = z.number().min(-60).max(400);

export const cableTableSchema = z.strictObject({
  kind: z.literal("vera-cable-table"),
  format: z.literal(1),
  id: electricalIdSchema,
  title: short,
  version: short,
  source: z.strictObject({
    title: short,
    publisher: short,
    revision: short,
    readAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date YYYY-MM-DD"),
    uri: text(2000),
    pages: short,
    license: short,
  }),
  cable: z.strictObject({
    designation: short,
    material: z.enum(cableMaterials),
    insulation: short,
    maxConductorTemperature: temperature,
    shortCircuitTemperature: temperature,
    k: positive.nullable(),
    note: text(1000).optional(),
  }),
  conductors: z
    .array(
      z.strictObject({
        crossSection: positive,
        resistance20: positive,
        reactance: positive.nullable(),
        note: short.optional(),
      }),
    )
    .min(1)
    .max(cableTableLimits.conductors),
  methods: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "must be a lowercase method id"),
        title: short,
        referenceTemperature: temperature,
        note: text(1000).optional(),
        ratings: z
          .array(
            z.strictObject({
              crossSection: positive,
              loadedConductors: z.union([z.literal(2), z.literal(3)]),
              current: positive,
              note: short.optional(),
            }),
          )
          .min(1)
          .max(cableTableLimits.ratings),
      }),
    )
    .min(1)
    .max(cableTableLimits.methods),
  temperatureFactors: z
    .array(
      z.strictObject({
        methods: z.array(z.string()).min(1).max(cableTableLimits.methods),
        note: short.optional(),
        points: z
          .array(z.strictObject({ ambient: temperature, factor: positive }))
          .min(1)
          .max(cableTableLimits.points),
      }),
    )
    .max(cableTableLimits.methods),
  groupingFactors: z
    .array(
      z.strictObject({
        methods: z.array(z.string()).min(1).max(cableTableLimits.methods),
        note: short.optional(),
        points: z
          .array(z.strictObject({ circuits: z.number().int().min(1), factor: positive }))
          .min(1)
          .max(cableTableLimits.points),
      }),
    )
    .max(cableTableLimits.methods),
});
export type CableTable = z.infer<typeof cableTableSchema>;
