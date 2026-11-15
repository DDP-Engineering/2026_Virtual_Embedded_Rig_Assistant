// Panel file, format 1 (spec REQ-DATA-a8bf1713): the physical arrangement of one control panel - enclosure and
// mounting plate, rails, ducts, zones with documented rules, equipment, terminal strips, scenarios, declared reserve
// and thermal conditions. Geometry is in millimetres on the plate (origin top-left, y downwards). The schema checks
// the shape; core/src/electrical/panel-file.ts checks references, tags and units on top of it.
import { z } from "zod";
import {
  electricalConditionSchema,
  electricalIdSchema,
  electricalQuantitySchema,
  electricalSourceSchema,
  panelLimits,
  panelLocations,
  panelTagSchema,
} from "./electrical-model.js";

/** Panel files, `<panel id>.json`, in this workbench folder. */
export const panelDir = "electrical-automation-panels";
/** Effective-surface cases of the enclosure heat balance (Schneider Electric enclosure catalogue p. 8/110). */
export const panelInstallations = [
  "free-standing",
  "wall",
  "end-free",
  "end-wall",
  "middle",
  "middle-wall",
  "middle-wall-covered",
] as const;
export const panelRailProfiles = ["TH35-7.5", "TH35-15"] as const;

const CONTROL = /\p{Cc}/u;
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value), "must not contain control characters");
const short = text(200);
const long = text(1000);
const key = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/, "must be a camelCase name");
const word = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "must be a lower-case word");
const mm = z.number().nonnegative();
const size = z.number().positive();
const bounded = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max);
const record = <T extends z.ZodType>(value: T, max: number) =>
  z
    .record(key, value)
    .refine((entries) => Object.keys(entries).length <= max, `must hold at most ${max} entries`);
const rect = { x: mm, y: mm, width: size, height: size };
export const panelItemRefSchema = z.strictObject({ catalog: electricalIdSchema, item: electricalIdSchema });
const cited = z.strictObject({ id: electricalIdSchema, page: short.optional() });

export const panelEquipmentSchema = z.strictObject({
  tag: panelTagSchema,
  item: panelItemRefSchema.nullable(),
  role: short,
  class: word,
  location: z.enum(panelLocations),
  rail: panelTagSchema.optional(),
  x: mm.optional(),
  mountedOn: panelTagSchema.optional(),
  mounting: z.enum(["below", "side"]).optional(),
  motor: electricalIdSchema.optional(),
  schematicTag: panelTagSchema.optional(),
  model: electricalIdSchema.optional(),
  supply: panelTagSchema.optional(),
  conditions: record(electricalConditionSchema, 8).optional(),
  declared: record(electricalQuantitySchema, 8).optional(),
  note: long.optional(),
});
export const panelStripSchema = z.strictObject({
  tag: panelTagSchema,
  item: panelItemRefSchema,
  class: word,
  count: z.number().int().min(1).max(500),
  spare: z.number().int().min(0).max(500),
  rail: panelTagSchema,
  x: mm.optional(),
  motor: electricalIdSchema.optional(),
  note: long.optional(),
});
export const panelSchema = z.strictObject({
  kind: z.literal("vera-panel"),
  format: z.literal(1),
  id: electricalIdSchema,
  title: short,
  board: electricalIdSchema,
  catalogs: z.array(electricalIdSchema).min(1).max(panelLimits.catalogs),
  sources: bounded(electricalSourceSchema, panelLimits.sources),
  enclosure: z.strictObject({
    item: panelItemRefSchema,
    plate: panelItemRefSchema,
    installation: z.enum(panelInstallations),
    mountingDepth: size,
  }),
  zones: bounded(
    z.strictObject({ tag: panelTagSchema, title: short, ...rect, classes: z.array(word).min(1).max(8) }),
    panelLimits.zones,
  ),
  rules: bounded(
    z.union([
      z.strictObject({
        tag: panelTagSchema,
        kind: z.literal("segregation"),
        text: long,
        zones: z.tuple([panelTagSchema, panelTagSchema]),
        distance: size,
        source: cited,
      }),
      z.strictObject({
        tag: panelTagSchema,
        kind: z.literal("keep-out"),
        text: long,
        area: z.strictObject(rect),
        source: cited,
      }),
    ]),
    panelLimits.rules,
  ),
  rails: bounded(
    z.strictObject({
      tag: panelTagSchema,
      zone: panelTagSchema,
      x: mm,
      y: mm,
      length: size,
      profile: z.enum(panelRailProfiles),
      gap: mm,
    }),
    panelLimits.rails,
  ),
  ducts: bounded(z.strictObject({ tag: panelTagSchema, ...rect }), panelLimits.ducts),
  equipment: bounded(panelEquipmentSchema, panelLimits.equipment),
  strips: bounded(panelStripSchema, panelLimits.strips),
  scenarios: z
    .array(
      z.strictObject({
        tag: panelTagSchema,
        title: short,
        active: z
          .array(panelTagSchema)
          .max(panelLimits.equipment + panelLimits.strips)
          .optional(),
      }),
    )
    .min(1)
    .max(panelLimits.scenarios),
  reserve: z.strictObject({
    railPercent: z.number().min(0).max(100),
    terminalsPercent: z.number().min(0).max(100),
    supplyPercent: z.number().min(0).max(100),
  }),
  thermal: z
    .strictObject({
      ambientTemperatureMax: electricalQuantitySchema,
      heatTransferCoefficient: electricalQuantitySchema,
      fan: panelItemRefSchema.optional(),
      internalTemperatureMax: electricalQuantitySchema.optional(),
      wiringLoss: electricalQuantitySchema.optional(),
    })
    .nullable(),
  assembly: z.strictObject({ shortCircuitRating: electricalQuantitySchema.optional() }),
  excluded: bounded(z.strictObject({ object: electricalIdSchema, reason: long }), panelLimits.excluded),
});
export type PanelItemRef = z.infer<typeof panelItemRefSchema>;
export type PanelEquipment = z.infer<typeof panelEquipmentSchema>;
export type PanelStrip = z.infer<typeof panelStripSchema>;
export type Panel = z.infer<typeof panelSchema>;
