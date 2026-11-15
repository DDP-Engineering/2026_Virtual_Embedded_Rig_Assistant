// The industrial catalog's read tool (spec REQ-DATA-d7e27def "Tool industrial_catalog"): catalog files in
// electrical-automation-catalogs/, confined to the workbench, read strictly; no network, no credential store.
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import {
  catalogRequirementSchema,
  electricalConditionSchema,
  electricalIdSchema,
  type IndustrialCatalog,
  industrialCatalogDir,
  industrialCatalogLimits,
} from "@vera/shared";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { PathGuard } from "../workbench/path-guard.js";
import {
  type CatalogStamp,
  checkCatalog,
  coordinationFor,
  findItems,
  parseCatalog,
  selectItems,
} from "./catalog.js";

const PAGE_ITEMS = 50;
const CATALOG_FILE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+\.json$/;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function catalogBytes(path: string): Promise<Buffer | null> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!info.isFile()) throw Error("The catalog file is not an ordinary file.");
  if (info.size > industrialCatalogLimits.fileBytes)
    throw Error(`The catalog file is larger than ${industrialCatalogLimits.fileBytes / 1024 / 1024} MiB.`);
  return readFile(path);
}

export interface CatalogFile {
  catalog: IndustrialCatalog;
  stamp: CatalogStamp;
}
/** Reads `electrical-automation-catalogs/<id>.json` strictly; throws when it is missing or invalid. */
export async function readCatalogFile(root: string, id: string): Promise<CatalogFile> {
  const catalogId = electricalIdSchema.parse(id);
  const path = `${industrialCatalogDir}/${catalogId}.json`;
  const target = await (await PathGuard.create(root)).resolve(path);
  const bytes = await catalogBytes(target.absolute);
  if (bytes === null) throw Error(`The catalog ${path} does not exist.`);
  const catalog = parseCatalog(bytes.toString("utf8"), catalogId);
  return { catalog, stamp: { id: catalog.id, version: catalog.version, sha256: hash(bytes), path } };
}

export interface CatalogListing {
  file: string;
  valid: boolean;
  problem?: string;
  id?: string;
  version?: string;
  title?: string;
  sha256?: string;
  families?: number;
  items?: number;
  tables?: number;
}
/** Every `*.json` of the catalog folder, by name; a broken one is listed invalid and the others stay usable. */
export async function listCatalogs(root: string): Promise<CatalogListing[]> {
  const guard = await PathGuard.create(root);
  const folder = await guard.resolve(industrialCatalogDir);
  let names: string[];
  try {
    names = (await readdir(folder.absolute)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const listed: CatalogListing[] = [];
  for (const file of names.slice(0, industrialCatalogLimits.files)) {
    const invalid = (problem: string): CatalogListing => ({ file, valid: false, problem });
    if (!CATALOG_FILE.test(file)) {
      listed.push(invalid("The file name is not a catalog id (lowercase words joined by '-') with .json."));
      continue;
    }
    let bytes: Buffer | null;
    try {
      bytes = await catalogBytes((await guard.resolve(`${industrialCatalogDir}/${file}`)).absolute);
    } catch (error) {
      listed.push(invalid(error instanceof Error ? error.message : "The catalog file cannot be read."));
      continue;
    }
    if (bytes === null) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch {
      listed.push(invalid("(document): is not JSON"));
      continue;
    }
    const checked = checkCatalog(raw, file.slice(0, -".json".length));
    if ("problems" in checked) {
      listed.push(
        invalid(checked.problems.map((problem) => `${problem.path}: ${problem.message}`).join("; ")),
      );
      continue;
    }
    const { catalog } = checked;
    listed.push({
      file,
      valid: true,
      id: catalog.id,
      version: catalog.version,
      title: catalog.title,
      sha256: hash(bytes),
      families: catalog.families.length,
      items: catalog.items.length,
      tables: catalog.coordination.length,
    });
  }
  return listed;
}

export const industrialCatalogParams = z.strictObject({
  view: z.enum(["list", "items", "select", "coordination"]),
  catalog: electricalIdSchema.optional(),
  orderCode: z.string().min(1).max(64).optional(),
  sku: z.string().min(1).max(64).optional(),
  family: electricalIdSchema.optional(),
  category: z.string().min(1).max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
  requirements: z.array(catalogRequirementSchema).min(1).max(32).optional(),
  items: z.array(electricalIdSchema).min(1).max(4).optional(),
  conditions: z.record(z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/), electricalConditionSchema).optional(),
});

async function readView(ctx: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const args = industrialCatalogParams.parse(raw);
  if (args.view === "list") return { path: industrialCatalogDir, catalogs: await listCatalogs(ctx.root) };
  if (args.catalog === undefined)
    throw Error(`view ${args.view} needs catalog, a catalog id from view list.`);
  const { catalog, stamp } = await readCatalogFile(ctx.root, args.catalog);
  if (args.view === "select") {
    if (!args.requirements) throw Error("view select needs requirements.");
    return { ...selectItems(catalog, stamp, { ...args, requirements: args.requirements }) };
  }
  if (args.view === "coordination") {
    if (!args.items) throw Error("view coordination needs items, the item IDs of one combination.");
    return { ...coordinationFor(catalog, stamp, args.items, args.conditions) };
  }
  if (args.orderCode !== undefined && args.sku !== undefined)
    throw Error(
      "Give orderCode or sku, not both: an order code is the manufacturer's, a SKU the distributor's.",
    );
  const all = findItems(catalog, args);
  const offset = args.offset ?? 0;
  const page = all.slice(offset, offset + PAGE_ITEMS);
  return {
    catalog: stamp,
    total: all.length,
    offset,
    items: page,
    ...(offset + page.length < all.length ? { next: offset + page.length } : {}),
  };
}

export const industrialCatalogTool: ToolDefinition = {
  name: "industrial_catalog",
  class: "read",
  description:
    "Read the workbench's industrial catalogs (electrical-automation-catalogs/<id>.json, format 1: manufacturer order codes, variants, accessories, distributor SKUs and cited parameters with conditions). view list: catalogs with id, version and validity; items: items of a catalog by exact orderCode or distributor sku (the match says which), family or category; select: firm requirements {id, parameter, op >=|<=|==, value {value, unit} or {text}, conditions} - each item eligible, unknown (absent, off-condition or unconfirmed value) or eliminated with the failing value, every value cited with source, revision and page/table; coordination: entries for exactly the given item IDs under the given conditions, others reported not applicable. Cite the returned catalog {id, version} in results. Files only: no live prices, orders or schematic changes.",
  params: industrialCatalogParams,
  execute: (ctx, args, signal) => {
    signal.throwIfAborted();
    return readView(ctx, args);
  },
};
