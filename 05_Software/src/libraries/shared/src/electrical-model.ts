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
/** Limits of panel files and of the panel section of a result (spec REQ-DATA-a8bf1713). */
export const panelLimits = {
  catalogs: 4,
  sources: 50,
  zones: 16,
  rules: 32,
  rails: 16,
  ducts: 32,
  equipment: 200,
  strips: 32,
  scenarios: 8,
  excluded: 64,
  fileBytes: 1024 * 1024,
} as const;
export const panelLocations = ["plate", "door", "field"] as const;
export const panelTagSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9.+-]{0,31}$/, "must be a tag of letters, digits, '.', '+' or '-'");
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const tagOrNull = panelTagSchema.nullable();
const n = z.number().nullable();
/** The `panel` section of a panel-engineering result (REQ-FUNC-b0b55ff0). */
export const panelResultSchema = z.strictObject({
  id: electricalIdSchema,
  path: short,
  board: electricalIdSchema,
  frame: sha,
  plate: z.strictObject({ width: z.number(), height: z.number() }).nullable(),
  bom: bounded(
    z.strictObject({
      tag: panelTagSchema,
      kind: z.enum(["equipment", "strip"]),
      role: short,
      location: z.enum(panelLocations),
      quantity: z.number().int().min(1),
      catalog: electricalIdSchema.nullable(),
      item: electricalIdSchema.nullable(),
      orderCode: text(64).nullable(),
      manufacturer: short.nullable(),
      name: short.nullable(),
      motor: electricalIdSchema.nullable(),
      mountedOn: tagOrNull,
      supply: tagOrNull,
      scenarios: z.array(panelTagSchema).max(panelLimits.scenarios),
      sha256: sha,
    }),
    panelLimits.equipment + panelLimits.strips,
  ),
  rails: bounded(
    z.strictObject({ tag: panelTagSchema, x: z.number(), y: z.number(), length: z.number(), used: n }),
    panelLimits.rails,
  ),
  zones: bounded(
    z.strictObject({
      tag: panelTagSchema,
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    panelLimits.zones,
  ),
  ducts: bounded(
    z.strictObject({
      tag: panelTagSchema,
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
    panelLimits.ducts,
  ),
  placements: bounded(
    z.strictObject({
      tag: panelTagSchema,
      rail: tagOrNull,
      x: n,
      y: n,
      width: n,
      height: n,
      state: z.enum(["placed", "unplaced", "mounted", "door", "field"]),
    }),
    panelLimits.equipment + panelLimits.strips,
  ),
  verification: bounded(
    z.strictObject({
      characteristic: short,
      method: long,
      evidence: z.array(short).max(32),
      state: z.enum(["partial", "not-covered"]),
    }),
    16,
  ),
});
export type PanelResult = z.infer<typeof panelResultSchema>;

/** The lists of an electrical-documentation result, in this order (spec REQ-DATA-aa83ed5c). */
export const documentationLists = [
  "materials",
  "connections",
  "cables",
  "terminals",
  "labels",
  "io",
  "contents",
] as const;
export type DocumentationListName = (typeof documentationLists)[number];
/** The fixed columns of each list. */
export const documentationColumns: Readonly<Record<DocumentationListName, readonly string[]>> = {
  materials: ["orderCode", "manufacturer", "name", "quantity", "tags", "catalog", "item"],
  connections: ["wire", "from", "to", "potential", "folio", "section", "color", "cable", "schematic"],
  cables: ["cable", "circuit", "from", "to", "crossSection", "length", "installation", "state"],
  terminals: ["strip", "point", "wire", "inside", "outside", "cable", "io", "origin"],
  labels: ["text", "kind", "at", "schematic"],
  io: ["address", "signal", "module", "device", "terminal", "tag", "tagFile", "state"],
  contents: ["list", "title", "rows", "sha256", "revision"],
};
export const documentationLimits = { rows: 2000, changes: 500, results: 100, sources: 200 } as const;
const runIdText = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const cell = z
  .string()
  .max(1000)
  .refine((value) => !CONTROL.test(value), "must not contain control characters")
  .nullable();
const documentationListSchema = z
  .strictObject({
    list: z.enum(documentationLists),
    title: short,
    columns: z.array(z.string()).max(16),
    rows: bounded(
      z.strictObject({ key: text(300), cells: z.array(cell).max(16), source: long }),
      documentationLimits.rows,
    ),
    sha256: sha,
  })
  .superRefine((value, ctx) => {
    const wanted = documentationColumns[value.list];
    if (value.columns.length !== wanted.length || value.columns.some((column, i) => column !== wanted[i]))
      ctx.addIssue({ code: "custom", path: ["columns"], message: `must be ${wanted.join(", ")}` });
    value.rows.forEach((row, i) => {
      if (row.cells.length !== wanted.length)
        ctx.addIssue({
          code: "custom",
          path: ["rows", i, "cells"],
          message: `must hold ${wanted.length} cells`,
        });
    });
  });
/** The `documentation` section of an electrical-documentation result (REQ-DATA-aa83ed5c). */
export const documentationResultSchema = z.strictObject({
  project: z.strictObject({ id: electricalIdSchema, name: short }),
  revision: z.strictObject({
    value: short.nullable(),
    document: electricalIdSchema.nullable(),
    date: short.nullable(),
    author: short.nullable(),
  }),
  panel: z.strictObject({ run: runIdText, path: short, sha256: sha }),
  lists: z
    .array(documentationListSchema)
    .length(documentationLists.length)
    .refine(
      (lists) => lists.every((entry, i) => entry.list === documentationLists[i]),
      `must be the lists ${documentationLists.join(", ")} in this order`,
    ),
  changes: z
    .strictObject({
      previousRun: runIdText,
      previousRevision: short.nullable(),
      rows: bounded(
        z.strictObject({
          list: z.enum(documentationLists),
          key: text(300),
          change: z.enum(["added", "removed", "changed"]),
        }),
        documentationLimits.changes,
      ),
      truncated: z.boolean(),
      objects: z.strictObject({
        changed: bounded(electricalIdSchema, electricalLimits.resultInputs),
        removed: bounded(electricalIdSchema, electricalLimits.resultInputs),
      }),
      sources: bounded(
        z.strictObject({ source: long, state: z.enum(["changed", "missing"]) }),
        documentationLimits.sources,
      ),
      results: bounded(
        z.strictObject({
          runId: runIdText,
          plugin: short.nullable(),
          freshness: z.enum(["stale", "invalid"]),
        }),
        documentationLimits.results,
      ),
    })
    .optional(),
});
export type DocumentationResult = z.infer<typeof documentationResultSchema>;
export type DocumentationList = DocumentationResult["lists"][number];

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
  panel: panelResultSchema.optional(),
  documentation: documentationResultSchema.optional(),
});
export type ElectricalResult = z.infer<typeof electricalResultSchema>;
export type ElectricalFreshness = "current" | "stale" | "invalid";
