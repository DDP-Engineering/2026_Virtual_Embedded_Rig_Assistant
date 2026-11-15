// Electrical project model and result documents, format 1 (spec REQ-DATA-06c0bd54). The schemas check the shape;
// core/src/electrical checks units, references, relations and cycles on top of them.
import { z } from "zod";

/** The workbench's electrical model, at the workbench root. */
export const electricalModelPath = "electrical-automation-model.json";
/** Run folders of electrical plugin results, each holding result.json. */
export const electricalResultsDir = "electrical-automation-results";
export const electricalResultFile = "result.json";

export const electricalObjectTypes = [
  "source",
  "board",
  "busbar",
  "circuit",
  "cable",
  "load",
  "motor",
  "protection",
  "device",
  "terminal",
  "sensor",
  "actuator",
  "io",
  "tag",
  "document",
] as const;
export type ElectricalObjectType = (typeof electricalObjectTypes)[number];
/** Prefixes of generated IDs (`<prefix>-<8 hex>`). */
export const electricalIdPrefixes: Record<
  ElectricalObjectType | "relation" | "sourceRecord" | "project",
  string
> = {
  source: "sup",
  board: "brd",
  busbar: "bus",
  circuit: "cir",
  cable: "cbl",
  load: "lod",
  motor: "mot",
  protection: "prt",
  device: "dev",
  terminal: "trm",
  sensor: "sen",
  actuator: "act",
  io: "io",
  tag: "tag",
  document: "doc",
  relation: "rel",
  sourceRecord: "src",
  project: "prj",
};
export const electricalRelationTypes = [
  "feeds",
  "contains",
  "protects",
  "routes",
  "controls",
  "signals",
  "tag-of",
  "connects",
  "documents",
] as const;
export type ElectricalRelationType = (typeof electricalRelationTypes)[number];
/** What a value rests on: given data, a requirement, an assumption, a proposal or a measurement. */
export const quantityBases = ["input", "requirement", "assumption", "proposal", "measured"] as const;
export const electricalSourceKinds = [
  "datasheet",
  "standard",
  "drawing",
  "measurement",
  "user",
  "calculation",
  "other",
] as const;
export const electricalRunStatuses = ["completed", "incomplete", "blocked", "error", "interrupted"] as const;
export const electricalVerdicts = ["pass", "fail", "unknown", "not-evaluated"] as const;
export const electricalLimits = {
  sources: 1000,
  objects: 5000,
  relations: 20000,
  modelBytes: 8 * 1024 * 1024,
  resultBytes: 4 * 1024 * 1024,
  resultInputs: 1000,
  resultList: 200,
} as const;

const CONTROL = /\p{Cc}/u;
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value), "must not contain control characters");
const short = text(200);
const long = text(1000);
export const electricalIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/, "must be lowercase words joined by '-', e.g. mot-p1");
const key = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/, "must be a camelCase name");
const unit = z.string().min(1).max(16);
const number = z.number(); // zod 4 numbers are finite: NaN and Infinity are refused
const bounded = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max);
const record = <T extends z.ZodType>(value: T, max: number) =>
  z
    .record(key, value)
    .refine((entries) => Object.keys(entries).length <= max, `must hold at most ${max} entries`);

export const electricalConditionSchema = z.union([
  z.strictObject({ value: number, unit }),
  z.strictObject({ text: short }),
]);
/** `value: null` is unknown, never zero; the key itself is required. */
export const electricalQuantitySchema = z.strictObject({
  value: number.nullable(),
  unit,
  basis: z.enum(quantityBases),
  conditions: record(electricalConditionSchema, 16).optional(),
  source: z.strictObject({ id: electricalIdSchema, page: short.optional() }).optional(),
  note: long.optional(),
});
export const electricalSourceSchema = z.strictObject({
  id: electricalIdSchema,
  kind: z.enum(electricalSourceKinds),
  title: short,
  publisher: short.optional(),
  revision: short.optional(),
  date: short.optional(),
  uri: text(2000).optional(),
});
export const electricalObjectSchema = z.strictObject({
  id: electricalIdSchema,
  type: z.enum(electricalObjectTypes),
  ref: text(64).optional(),
  name: short.optional(),
  note: long.optional(),
  attributes: record(z.union([short, z.boolean()]), 64).optional(),
  properties: record(electricalQuantitySchema, 64).optional(),
});
export const electricalRelationSchema = z.strictObject({
  id: electricalIdSchema,
  type: z.enum(electricalRelationTypes),
  from: electricalIdSchema,
  to: electricalIdSchema,
  note: long.optional(),
});
export const electricalProfileSchema = z.strictObject({
  jurisdiction: short.nullable(),
  domain: short.nullable(),
  standards: bounded(z.strictObject({ id: short, edition: short.nullable() }), 50),
  limits: bounded(long, 50),
});
export const electricalProjectSchema = z.strictObject({
  id: electricalIdSchema,
  name: short,
  profile: electricalProfileSchema,
});
export const electricalModelSchema = z.strictObject({
  kind: z.literal("vera-electrical-model"),
  format: z.literal(1),
  project: electricalProjectSchema,
  sources: bounded(electricalSourceSchema, electricalLimits.sources),
  objects: bounded(electricalObjectSchema, electricalLimits.objects),
  relations: bounded(electricalRelationSchema, electricalLimits.relations),
});
export type ElectricalQuantity = z.infer<typeof electricalQuantitySchema>;
export type ElectricalCondition = z.infer<typeof electricalConditionSchema>;
export type ElectricalSource = z.infer<typeof electricalSourceSchema>;
export type ElectricalObject = z.infer<typeof electricalObjectSchema>;
export type ElectricalRelation = z.infer<typeof electricalRelationSchema>;
export type ElectricalProfile = z.infer<typeof electricalProfileSchema>;
export type ElectricalProject = z.infer<typeof electricalProjectSchema>;
export type ElectricalModel = z.infer<typeof electricalModelSchema>;

const resultValue = z.strictObject({ value: number.nullable(), unit });
const tag = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9:,.+-]{0,63}$/, "must be a device tag or terminal reference");
/** A logical starter or drive assembly with its connections and interlocks, for a later ECAD adapter (REQ-DATA-e3d5c15f). */
export const electricalAssemblySchema = z.strictObject({
  motor: electricalIdSchema,
  circuit: electricalIdSchema,
  method: short,
  conditional: z.boolean(),
  devices: bounded(
    z.strictObject({
      tag,
      role: short,
      item: electricalIdSchema.nullable(),
      orderCode: text(64).nullable(),
      setting: z.strictObject({ value: number, unit }).optional(),
    }),
    16,
  ),
  connections: bounded(z.strictObject({ from: tag, to: tag, kind: z.enum(["power", "control"]) }), 32),
  interlocks: bounded(
    z.strictObject({
      kind: z.enum(["mechanical", "electrical", "sequence"]),
      devices: z.array(tag).min(1).max(8),
      note: long,
    }),
    8,
  ),
});
export type ElectricalAssembly = z.infer<typeof electricalAssemblySchema>;
export const electricalResultSchema = z.strictObject({
  kind: z.literal("vera-electrical-result"),
  format: z.literal(1),
  runId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  producer: z.strictObject({
    plugin: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    operation: short,
    engine: z.strictObject({ name: short, version: short }),
  }),
  method: z.strictObject({ id: short, title: short, reference: short.optional() }),
  status: z.enum(electricalRunStatuses),
  preliminary: z.boolean(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  model: z.strictObject({ path: short, sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  catalog: z.strictObject({ id: short, version: short }).nullable(),
  inputs: z
    .array(z.strictObject({ id: electricalIdSchema, snapshot: z.json() }))
    .min(1)
    .max(electricalLimits.resultInputs),
  assumptions: bounded(long, electricalLimits.resultList),
  sources: bounded(short, electricalLimits.resultList),
  conditions: record(electricalConditionSchema, 64),
  intermediate: bounded(
    z.strictObject({ name: short, subject: electricalIdSchema.optional(), value: number.nullable(), unit }),
    electricalLimits.resultList,
  ),
  criteria: bounded(
    z.strictObject({
      id: short,
      title: short,
      subject: electricalIdSchema.optional(),
      verdict: z.enum(electricalVerdicts),
      measured: resultValue.optional(),
      limit: resultValue.optional(),
      note: long.optional(),
    }),
    electricalLimits.resultList,
  ),
  limits: bounded(long, electricalLimits.resultList),
  messages: bounded(long, electricalLimits.resultList),
  assemblies: bounded(electricalAssemblySchema, 16).optional(),
});
export type ElectricalResult = z.infer<typeof electricalResultSchema>;
export type ElectricalFreshness = "current" | "stale" | "invalid";
