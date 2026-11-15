// Industrial catalog, format 1 (spec REQ-DATA-d7e27def): manufacturer data for LV equipment with conditioned,
// cited parameters in the electrical model's quantity shape. The schema checks the shape; core/src/electrical/
// catalog.ts checks units, references, unique IDs and links on top of it.
import { z } from "zod";
import {
  electricalConditionSchema,
  electricalIdSchema,
  electricalQuantitySchema,
  electricalSourceSchema,
} from "./electrical-model.js";

/** Catalog files, `<catalog id>.json`, in this workbench folder. */
export const industrialCatalogDir = "electrical-automation-catalogs";
export const industrialCatalogLimits = {
  sources: 200,
  families: 100,
  items: 2000,
  parameters: 256,
  accessories: 32,
  distributors: 16,
  tables: 100,
  entries: 200,
  fileBytes: 4 * 1024 * 1024,
  files: 50,
} as const;
export const catalogParameterStatuses = ["confirmed", "extracted"] as const;

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
const record = <T extends z.ZodType>(value: T, max: number) =>
  z
    .record(key, value)
    .refine((entries) => Object.keys(entries).length <= max, `must hold at most ${max} entries`);

export const catalogSourceSchema = electricalSourceSchema.extend({ license: short });
export const catalogParameterSchema = electricalQuantitySchema.extend({
  name: key,
  source: z.strictObject({ id: electricalIdSchema, page: short.optional(), table: short.optional() }),
  status: z.enum(catalogParameterStatuses),
});
export const catalogFamilySchema = z.strictObject({
  id: electricalIdSchema,
  manufacturer: short,
  name: short,
  category: short,
  note: long.optional(),
});
export const catalogItemSchema = z.strictObject({
  id: electricalIdSchema,
  family: electricalIdSchema,
  orderCode: text(64),
  name: short.optional(),
  variant: z.strictObject({ base: text(64), label: short }).optional(),
  attributes: record(z.union([short, z.boolean()]), 64).optional(),
  parameters: z.array(catalogParameterSchema).max(industrialCatalogLimits.parameters),
  accessories: z
    .array(z.strictObject({ item: electricalIdSchema, role: short, note: long.optional() }))
    .max(industrialCatalogLimits.accessories)
    .optional(),
  distributors: z
    .array(
      z.strictObject({
        supplier: short,
        sku: text(64),
        capturedAt: z.iso.datetime({ offset: true }),
        uri: text(2000).optional(),
      }),
    )
    .max(industrialCatalogLimits.distributors)
    .optional(),
});
export const catalogCoordinationSchema = z.strictObject({
  id: electricalIdSchema,
  title: short,
  kind: short,
  conditions: record(electricalConditionSchema, 16),
  entries: z
    .array(
      z.strictObject({
        items: z.array(electricalIdSchema).min(1).max(4),
        parameters: z.array(catalogParameterSchema).min(1).max(16),
        note: long.optional(),
      }),
    )
    .min(1)
    .max(industrialCatalogLimits.entries),
});
export const industrialCatalogSchema = z.strictObject({
  kind: z.literal("vera-industrial-catalog"),
  format: z.literal(1),
  id: electricalIdSchema,
  version: short,
  title: short,
  sources: z.array(catalogSourceSchema).max(industrialCatalogLimits.sources),
  families: z.array(catalogFamilySchema).max(industrialCatalogLimits.families),
  items: z.array(catalogItemSchema).max(industrialCatalogLimits.items),
  coordination: z.array(catalogCoordinationSchema).max(industrialCatalogLimits.tables),
});
export type CatalogSource = z.infer<typeof catalogSourceSchema>;
export type CatalogParameter = z.infer<typeof catalogParameterSchema>;
export type CatalogFamily = z.infer<typeof catalogFamilySchema>;
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type CatalogCoordination = z.infer<typeof catalogCoordinationSchema>;
export type IndustrialCatalog = z.infer<typeof industrialCatalogSchema>;

/** A firm requirement of a selection: a number with its unit, or a text compared with an attribute. */
export const catalogRequirementSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "use lower-case letters, digits and '-'"),
  parameter: key,
  op: z.enum([">=", "<=", "=="]),
  value: electricalConditionSchema,
  conditions: record(electricalConditionSchema, 16).optional(),
});
export type CatalogRequirement = z.infer<typeof catalogRequirementSchema>;
