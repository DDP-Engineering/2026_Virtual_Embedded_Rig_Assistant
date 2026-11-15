// Lighting project files and lighting report records, format 1 (spec REQ-DATA-affb2e6b): the room, surfaces,
// calculation plane, luminaires, scenarios and user-entered requirements of one lighting design, and the mapped
// values of one photometric engine report for it. The schemas check the shape; core/src/electrical/lighting-files.ts
// checks IDs and references on top of them.
import { z } from "zod";
import { electricalIdSchema } from "./electrical-model.js";

/** Lighting projects and report records, `<id>.json`, in this workbench folder. */
export const lightingDir = "electrical-automation-lighting";
/** Photometry files (IES LM-63, EULUMDAT) as distributed, in this workbench folder. */
export const photometryDir = "electrical-automation-photometry";
export const photometryFileNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.(?:ies|IES|ldt|LDT)$/;
export const lightingLimits = {
  fileBytes: 1024 * 1024,
  photometryBytes: 1024 * 1024,
  evidenceBytes: 64 * 1024 * 1024,
  types: 10,
  luminaires: 500,
  requirements: 8,
  scenarios: 8,
  utilisationFactors: 200,
  surfaces: 8,
  gridPoints: 10000,
} as const;
export const lightingProfiles = ["interior", "emergency", "exterior"] as const;
export const lightingLengthUnits = ["m", "mm"] as const;

const CONTROL = /\p{Cc}/u;
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value), "must not contain control characters");
const short = text(200);
const long = text(1000);
const positive = z.number().positive();
const nonNegative = z.number().nonnegative();
const share = z.number().min(0).max(1);
const fileName = z.string().regex(photometryFileNamePattern, "must be an .ies or .ldt file name");

export const lightingProjectSchema = z.strictObject({
  kind: z.literal("vera-lighting-project"),
  format: z.literal(1),
  id: electricalIdSchema,
  title: short,
  origin: z.enum(["project", "fictional"]),
  profile: z.enum(lightingProfiles),
  lengthUnit: z.enum(lightingLengthUnits),
  room: z.strictObject({ length: positive, width: positive, height: positive }),
  reflectances: z.strictObject({ ceiling: share, walls: share, floor: share }),
  plane: z.strictObject({ height: nonNegative, border: nonNegative, spacing: positive }),
  maintenanceFactor: z.strictObject({ value: z.number().gt(0).max(1), source: long }),
  types: z
    .array(
      z.strictObject({
        id: electricalIdSchema,
        photometry: fileName,
        orderCode: text(64).optional(),
        load: electricalIdSchema.optional(),
      }),
    )
    .min(1)
    .max(lightingLimits.types),
  luminaires: z
    .array(
      z.strictObject({
        id: electricalIdSchema,
        type: electricalIdSchema,
        x: z.number(),
        y: z.number(),
        z: z.number(),
        rotation: z.number(),
        tilt: z.number().min(0).max(180),
      }),
    )
    .min(1)
    .max(lightingLimits.luminaires),
  requirements: z
    .array(
      z.strictObject({
        id: electricalIdSchema,
        title: short,
        maintainedIlluminance: positive,
        uniformityMin: share.optional(),
        ugrMax: z.number().min(5).max(40).optional(),
        source: long,
      }),
    )
    .min(1)
    .max(lightingLimits.requirements),
  scenarios: z
    .array(
      z.strictObject({
        id: electricalIdSchema,
        title: short,
        requirement: electricalIdSchema,
        luminaires: z.array(electricalIdSchema).min(1).max(lightingLimits.luminaires).optional(),
        dimming: z.number().gt(0).max(1).optional(),
      }),
    )
    .min(1)
    .max(lightingLimits.scenarios),
  utilisationFactors: z
    .array(
      z.strictObject({
        type: electricalIdSchema,
        roomIndex: positive,
        ceiling: share,
        walls: share,
        floor: share,
        value: z.number().gt(0).max(1.5),
        basis: z.enum(["luminaire", "lamp"]),
        source: long,
      }),
    )
    .max(lightingLimits.utilisationFactors)
    .optional(),
});
export type LightingProject = z.infer<typeof lightingProjectSchema>;

export const lightingReportSchema = z.strictObject({
  kind: z.literal("vera-lighting-report"),
  format: z.literal(1),
  id: electricalIdSchema,
  project: electricalIdSchema,
  origin: z.enum(["engine", "fictional"]),
  engine: z.strictObject({ name: short, version: short }),
  evidence: z
    .strictObject({
      path: text(256),
      sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lower-case hex digits"),
    })
    .optional(),
  mapping: long,
  room: z.strictObject({ length: positive, width: positive, height: positive }),
  lengthUnit: z.enum(lightingLengthUnits),
  maintenanceFactor: z.number().gt(0).max(1),
  photometry: z
    .array(z.strictObject({ type: electricalIdSchema, file: fileName }))
    .min(1)
    .max(lightingLimits.types),
  surfaces: z
    .array(
      z.strictObject({
        scenario: electricalIdSchema,
        name: short,
        height: nonNegative,
        border: nonNegative,
        luminaires: z.number().int().positive(),
        average: nonNegative,
        minimum: nonNegative,
        maximum: nonNegative.optional(),
        uniformity: share.optional(),
        ugr: z.number().min(0).max(40).nullable(),
      }),
    )
    .min(1)
    .max(lightingLimits.surfaces),
});
export type LightingReport = z.infer<typeof lightingReportSchema>;
