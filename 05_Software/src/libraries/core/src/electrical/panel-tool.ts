// The panel engineering tools (spec REQ-DATA-a8bf1713 "Tools"): panel_engineering_check reads the model, one panel
// file, its catalogs, a CURRENT motor_drives result (and the network result it chains to) and optional .qet projects,
// and prepares ONE new result through the write flow; panel_engineering (read) drafts equipment from assemblies, shows
// the impact of changes on a stored result and exports its BOM and layout. Nothing physical is touched.
import {
  type ElectricalModel,
  type ElectricalResult,
  electricalIdSchema,
  electricalModelPath,
} from "@vera/shared";
import { z } from "zod";
import type { PreparedChange } from "../tools/changes.js";
import type { ToolContext, ToolDefinition } from "../tools/context.js";
import { readCatalogFile } from "./catalog-tool.js";
import {
  analyzePanel,
  draftEquipment,
  type PanelCatalog,
  type PanelSchematic,
  panelBomCsv,
  panelImpact,
  panelLayoutSvg,
} from "./panel.js";
import { readPanelFile } from "./panel-file.js";
import { readQetFile } from "./qet-tool.js";
import { newRun, prepareResultChange } from "./result-change.js";
import { resultFreshness } from "./results.js";
import { readModelFile, readResultFile } from "./tools.js";

const runId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const qetPath = z
  .string()
  .min(5)
  .max(160)
  .regex(/\.qet$/i, "must be a .qet file");

/** A stored result of the named producer that is current against the model; refused otherwise. */
async function current(
  root: string,
  run: string,
  model: ElectricalModel,
  plugin: string,
  operation: string,
  rerun: string,
): Promise<ElectricalResult> {
  const result = await readResultFile(root, run);
  if (result.producer.plugin !== plugin || result.producer.operation !== operation)
    throw Error(`The result ${run} was not produced by ${plugin}: name a ${rerun} run.`);
  const fresh = resultFreshness(result, model);
  if (fresh.freshness === "stale")
    throw Error(
      `The ${plugin} result ${run} is stale (changed: ${fresh.changed.join(", ") || "none"}; removed: ${fresh.removed.join(", ") || "none"}): run ${rerun} again.`,
    );
  return result;
}

/** The network result the motor_drives result chains to, when it is still current; null otherwise. */
async function chainedNetwork(root: string, motorDrives: ElectricalResult, model: ElectricalModel) {
  const network = motorDrives.conditions.networkRun;
  if (!network || !("text" in network)) return null;
  try {
    return await current(root, network.text, model, "electrical-network", "network", "electrical_network");
  } catch {
    return null;
  }
}

async function readCatalogs(root: string, ids: readonly string[]): Promise<Map<string, PanelCatalog>> {
  const catalogs = new Map<string, PanelCatalog>();
  for (const id of ids) if (!catalogs.has(id)) catalogs.set(id, await readCatalogFile(root, id));
  return catalogs;
}

export const panelEngineeringCheckParams = z.strictObject({
  panel: electricalIdSchema,
  motorDrivesRun: runId,
  schematics: z
    .array(z.strictObject({ path: qetPath, motor: electricalIdSchema.optional() }))
    .max(8)
    .optional(),
});

/** Checks the panel and prepares the new result file; nothing is written before the change is applied. */
export async function preparePanelEngineeringCheck(
  ctx: ToolContext,
  raw: unknown,
  signal: AbortSignal,
): Promise<PreparedChange> {
  signal.throwIfAborted();
  const request = panelEngineeringCheckParams.parse(raw);
  const host = ctx.change;
  if (!host) throw Error("Workbench write host is unavailable.");
  host.assertWritable?.();
  const file = await readModelFile(ctx.root);
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const { panel, stamp } = await readPanelFile(ctx.root, request.panel);
  const board = file.model.objects.find((object) => object.id === panel.board);
  if (board?.type !== "board")
    throw Error(`The panel ${panel.id} names ${panel.board}, which is not a board of the electrical model.`);
  for (const motor of [...panel.equipment, ...panel.strips].flatMap((entry) =>
    entry.motor ? [entry.motor] : [],
  ))
    if (file.model.objects.find((object) => object.id === motor)?.type !== "motor")
      throw Error(
        `The panel ${panel.id} names ${motor} as motor, which is not a motor of the electrical model.`,
      );
  const motorDrives = await current(
    ctx.root,
    request.motorDrivesRun,
    file.model,
    "motor-drives",
    "motor-starting",
    "motor_drives",
  );
  const catalogs = await readCatalogs(ctx.root, [
    ...panel.catalogs,
    ...(motorDrives.catalog ? [motorDrives.catalog.id] : []),
  ]);
  const network = await chainedNetwork(ctx.root, motorDrives, file.model);
  const schematics: PanelSchematic[] = [];
  for (const entry of request.schematics ?? []) {
    if (
      entry.motor !== undefined &&
      file.model.objects.find((object) => object.id === entry.motor)?.type !== "motor"
    )
      throw Error(
        `The schematic ${entry.path} names ${entry.motor}, which is not a motor of the electrical model.`,
      );
    const qet = await readQetFile(ctx.root, entry.path);
    schematics.push({ path: qet.path, sha256: qet.sha256, motor: entry.motor ?? null, project: qet.project });
  }
  signal.throwIfAborted();
  const { runId: run, now } = newRun();
  const result = analyzePanel({
    model: file.model,
    modelPath: electricalModelPath,
    modelSha256: file.sha256,
    panel,
    panelPath: stamp.path,
    panelSha256: stamp.sha256,
    catalogs,
    motorDrives,
    network,
    schematics,
    runId: run,
    now,
  });
  return prepareResultChange({
    ctx,
    signal,
    tool: "panel_engineering_check",
    args: request,
    result,
    model: file.model,
    label: "panel engineering",
  });
}

export const panelEngineeringCheckTool: ToolDefinition = {
  name: "panel_engineering_check",
  class: "write",
  description:
    "Check a control panel file (electrical-automation-panels/<id>.json: enclosure and plate, rails, ducts, zones and documented rules, equipment, terminal strips, 24 V supply, scenarios, reserve, thermal conditions) against a current motor_drives result, the model and optional .qet schematics, and store one result: BOM reconciled with assemblies, model and schematics, accessories only when the host's catalog item lists them, terminals, 24 V budget, 2D placement (mm) with collisions and missing data, dissipation and enclosure air temperature per scenario, short-circuit/busbars not evaluated without assembly data, verification report. No IEC 61439 conformity is claimed; after approval like a write.",
  params: panelEngineeringCheckParams,
  prepare: (ctx, args, signal) => preparePanelEngineeringCheck(ctx, args, signal),
  execute: async (ctx, args, signal) => (await preparePanelEngineeringCheck(ctx, args, signal)).apply(signal),
};

export const panelEngineeringParams = z.strictObject({
  view: z.enum(["draft", "impact", "export"]),
  motorDrivesRun: runId.optional(),
  motors: z.array(electricalIdSchema).min(1).max(16).optional(),
  runId: runId.optional(),
  format: z.enum(["bom-csv", "layout-svg"]).optional(),
});

async function panelResult(root: string, run: string): Promise<ElectricalResult> {
  const result = await readResultFile(root, run);
  if (result.producer.plugin !== "panel-engineering" || !result.panel)
    throw Error(`The result ${run} is not a panel_engineering_check result.`);
  return result;
}

async function readView(ctx: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const args = panelEngineeringParams.parse(raw);
  const file = await readModelFile(ctx.root);
  if (args.view === "draft") {
    if (!args.motorDrivesRun) throw Error("The draft view needs motorDrivesRun.");
    if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
    const motorDrives = await current(
      ctx.root,
      args.motorDrivesRun,
      file.model,
      "motor-drives",
      "motor-starting",
      "motor_drives",
    );
    const catalog = motorDrives.catalog
      ? (await readCatalogFile(ctx.root, motorDrives.catalog.id)).catalog
      : null;
    return {
      motorDrivesRun: motorDrives.runId,
      catalog: motorDrives.catalog,
      equipment: draftEquipment(motorDrives, file.model, catalog, args.motors),
      note: "A draft for the panel file's equipment: set class, rail or location, conditions and accessories (mountedOn) yourself; accessoryHints list what the catalog item names, with its cited note.",
    };
  }
  if (!args.runId) throw Error(`The ${args.view} view needs runId.`);
  const result = await panelResult(ctx.root, args.runId);
  if (args.view === "export") {
    if (!args.format) throw Error("The export view needs format bom-csv or layout-svg.");
    return {
      runId: result.runId,
      format: args.format,
      mediaType: args.format === "bom-csv" ? "text/csv" : "image/svg+xml",
      text: args.format === "bom-csv" ? panelBomCsv(result) : panelLayoutSvg(result),
    };
  }
  if (!file) throw Error(`The workbench has no electrical model (${electricalModelPath}).`);
  const stored = result.panel as NonNullable<ElectricalResult["panel"]>;
  const { panel } = await readPanelFile(ctx.root, stored.id);
  const ids = [
    ...panel.catalogs,
    ...result.sources.flatMap((source) => {
      const match = /^catalog:([a-z][a-z0-9-]*)@/.exec(source);
      return match ? [match[1] as string] : [];
    }),
  ];
  const catalogs = await readCatalogs(ctx.root, ids);
  const freshness = resultFreshness(result, file.model);
  const impact = panelImpact(result, { panel, catalogs, model: file.model });
  // The schematics the check compared: a changed or missing file reopens its reconciliation and terminal checks.
  const schematics: { path: string; state: "changed" | "missing" }[] = [];
  for (const source of result.sources) {
    const match = /^qet:(.+)@sha256:([0-9a-f]{64})$/.exec(source);
    if (!match) continue;
    const [, path, sha256] = match as unknown as [string, string, string];
    try {
      if ((await readQetFile(ctx.root, path)).sha256 !== sha256) schematics.push({ path, state: "changed" });
    } catch {
      schematics.push({ path, state: "missing" });
    }
  }
  const stale =
    freshness.freshness === "stale" ||
    impact.frameChanged ||
    impact.affected.bom.length > 0 ||
    schematics.length > 0;
  return { runId: result.runId, stale, modelFreshness: freshness, schematics, ...impact };
}

export const panelEngineeringTool: ToolDefinition = {
  name: "panel_engineering",
  class: "read",
  description:
    "Panel engineering views, writing nothing. view draft {motorDrivesRun, motors?}: equipment entries for the assemblies of a current motor_drives result with the accessories their catalog items list; impact {runId}: which BOM lines, rails, 24 V budgets, dissipation and thermal scenarios of a stored panel result a changed device, panel or model affects; export {runId, format bom-csv|layout-svg}: the stored BOM as CSV or the 2D layout as SVG (mm).",
  params: panelEngineeringParams,
  execute: (ctx, args, signal) => {
    signal.throwIfAborted();
    return readView(ctx, args);
  },
};
