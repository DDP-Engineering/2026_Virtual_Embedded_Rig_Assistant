// EPLAN exchange contracts, format 1 (spec REQ-DATA-203d52e6): the mapping profile that names the declared EPLAN
// target, the project link file and the columns of the exchange tables, and the outcome file the eplan-tool helper
// writes. The schemas check the shape; core/src/electrical/eplan.ts checks the rest (file name, header uniqueness).
import { z } from "zod";
import { electricalIdSchema } from "./electrical-model.js";

/** EPLAN mapping profiles, `<profile id>.json`, in this workbench folder. */
export const eplanProfileDir = "electrical-automation-eplan";
/** The exchange tables: the device list (devicelist, XDLCsvImporterExporter) and two external-editing exports. */
export const eplanTables = ["devices", "terminals", "connections"] as const;
export type EplanTable = (typeof eplanTables)[number];
/** The columns a profile may map, per table; the first ones are required. */
export const eplanColumns: Readonly<
  Record<EplanTable, { required: readonly string[]; optional: readonly string[] }>
> = {
  devices: { required: ["tag"], optional: ["part", "description", "vera"] },
  terminals: { required: ["strip", "point"], optional: [] },
  connections: { required: ["from", "to"], optional: ["wire", "crossSection", "color"] },
};
export const eplanLimits = {
  profileBytes: 64 * 1024,
  tableBytes: 4 * 1024 * 1024,
  tableRecords: 20_000,
  outcomeBytes: 256 * 1024,
} as const;
export const eplanStepNames = [
  "snapshot",
  "import",
  "reports",
  "export-devices",
  "export-terminals",
  "export-connections",
] as const;

const CONTROL = /\p{Cc}/u;
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value), "must not contain control characters");
const sha = z.string().regex(/^[0-9a-f]{64}$/, "must be a lower-case sha256");
/** A header name the helper and the reader can carry unquoted: no `;`, no `"`. */
const header = text(100).refine((value) => !/[;"]/.test(value), 'must not contain ; or "');
/** An absolute Windows path to a project link file, passed unquoted in /PROJECTNAME:<path>. */
export const eplanLinkSchema = z
  .string()
  .max(240)
  .regex(
    /^[A-Za-z]:\\(?:[^\\/:*?"<>|\s\p{Cc}]+\\)*[^\\/:*?"<>|\s\p{Cc}]+\.elk$/u,
    "must be an absolute Windows path to a .elk file without spaces or quotes",
  );
const scheme = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, "must be 1 to 64 letters, digits, _ . or -");
const language = z.string().regex(/^[a-z]{2}_[A-Z]{2}$/, "must look like en_US");
const columns = (required: readonly string[], optional: readonly string[]) =>
  z.strictObject(
    Object.fromEntries([
      ...required.map((name) => [name, header]),
      ...optional.map((name) => [name, header.optional()]),
    ]) as Record<string, z.ZodType<string | undefined>>,
  );
const schemeTable = (table: EplanTable) =>
  z.strictObject({
    scheme,
    language,
    columns: columns(eplanColumns[table].required, eplanColumns[table].optional),
  });

export const eplanProfileSchema = z.strictObject({
  kind: z.literal("vera-eplan-profile"),
  format: z.literal(1),
  id: electricalIdSchema,
  title: text(200),
  target: z.strictObject({
    product: z.literal("EPLAN Electric P8"),
    version: z.literal("2025"),
    platform: z.literal("windows-x64"),
  }),
  project: z.strictObject({ link: eplanLinkSchema }),
  tables: z.strictObject({
    devices: z.strictObject({
      columns: columns(eplanColumns.devices.required, eplanColumns.devices.optional),
      /** The part number prefix per catalog manufacturer, e.g. `{"Schneider Electric": "SE."}`. */
      partPrefixes: z
        .record(text(100), z.string().regex(/^[^;"\s\p{Cc}]{1,16}$/u, "must be 1 to 16 characters"))
        .refine((value) => Object.keys(value).length <= 32, "must hold at most 32 manufacturers")
        .optional(),
    }),
    terminals: schemeTable("terminals").optional(),
    connections: schemeTable("connections").optional(),
  }),
});
export type EplanProfile = z.infer<typeof eplanProfileSchema>;

/** The outcome file of one eplan-tool export or import (spec REQ-DATA-203d52e6 section 5). */
export const eplanOutcomeSchema = z.strictObject({
  kind: z.literal("vera-eplan-outcome"),
  format: z.literal(1),
  tool: text(100),
  operation: z.enum(["export", "import"]),
  status: z.enum(["completed", "failed", "interrupted", "refused"]),
  reason: text(1000).nullable(),
  profile: z.strictObject({ path: text(240), sha256: sha }).nullable(),
  project: text(240).nullable(),
  copy: text(240).nullable(),
  candidate: z.strictObject({ path: text(240), sha256: sha }).nullable(),
  eplan: text(1000).nullable(),
  steps: z
    .array(
      z.strictObject({
        name: z.enum(eplanStepNames),
        command: text(4000),
        exit: z.number().int().nullable(),
        seconds: z.number().min(0),
        file: text(240).nullable(),
      }),
    )
    .max(16),
  files: z.array(z.strictObject({ table: z.enum(eplanTables), path: text(240), sha256: sha })).max(3),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type EplanOutcome = z.infer<typeof eplanOutcomeSchema>;
