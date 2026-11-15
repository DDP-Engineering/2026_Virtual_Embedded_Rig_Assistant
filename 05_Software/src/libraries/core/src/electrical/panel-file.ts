// Panel files (spec REQ-DATA-a8bf1713 "Panel file"): strict format-1 reading with tag, reference and unit checks,
// and the confined file access. VERA only reads these files; the engineer writes them.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { electricalIdSchema, type Panel, panelDir, panelLimits, panelSchema } from "@vera/shared";
import { PathGuard } from "../workbench/path-guard.js";
import { jsonPath, type ModelProblem, problemsText } from "./model.js";
import { unitProblem } from "./units.js";

const PROBLEM_LIMIT = 20;

/** The panel, or the problems that make it invalid (at most 20, each with its JSON path). */
export function checkPanel(raw: unknown, fileId?: string): { panel: Panel } | { problems: ModelProblem[] } {
  const parsed = panelSchema.safeParse(raw);
  if (!parsed.success)
    return {
      problems: parsed.error.issues
        .slice(0, PROBLEM_LIMIT)
        .map((issue) => ({ path: jsonPath(issue.path), message: issue.message })),
    };
  const panel = parsed.data;
  const problems: ModelProblem[] = [];
  const add = (path: string, message: string) => {
    if (problems.length < PROBLEM_LIMIT) problems.push({ path, message });
  };
  if (fileId !== undefined && panel.id !== fileId)
    add("id", `panel ID ${panel.id} differs from its file name ${fileId}.json`);
  const tags = new Map<string, string>();
  const tag = (value: string, path: string) => {
    const first = tags.get(value);
    if (first) add(path, `tag ${value} repeats ${first}`);
    else tags.set(value, path);
  };
  for (const [list, entries] of [
    ["zones", panel.zones],
    ["rules", panel.rules],
    ["rails", panel.rails],
    ["ducts", panel.ducts],
    ["equipment", panel.equipment],
    ["strips", panel.strips],
  ] as const)
    entries.forEach((entry, index) => {
      tag(entry.tag, `${list}[${index}].tag`);
    });
  const zones = new Set(panel.zones.map((zone) => zone.tag));
  const rails = new Set(panel.rails.map((rail) => rail.tag));
  const equipment = new Map(panel.equipment.map((entry) => [entry.tag, entry]));
  const strips = new Set(panel.strips.map((strip) => strip.tag));
  const sources = new Set(panel.sources.map((source) => source.id));
  const catalogs = new Set(panel.catalogs);
  const ref = (value: { catalog: string }, path: string) => {
    if (!catalogs.has(value.catalog)) add(`${path}.catalog`, `catalog ${value.catalog} is not in catalogs`);
  };
  if (new Set(panel.catalogs).size !== panel.catalogs.length) add("catalogs", "a catalog repeats");
  ref(panel.enclosure.item, "enclosure.item");
  ref(panel.enclosure.plate, "enclosure.plate");
  panel.rails.forEach((rail, index) => {
    if (!zones.has(rail.zone)) add(`rails[${index}].zone`, `zone ${rail.zone} does not exist`);
  });
  panel.rules.forEach((rule, index) => {
    if (!sources.has(rule.source.id))
      add(`rules[${index}].source.id`, `source ${rule.source.id} is not in sources`);
    if (rule.kind === "segregation")
      rule.zones.forEach((zone, at) => {
        if (!zones.has(zone)) add(`rules[${index}].zones[${at}]`, `zone ${zone} does not exist`);
      });
  });
  const quantity = (
    value: { unit: string; source?: { id: string } | undefined } | undefined,
    name: string,
    path: string,
  ) => {
    if (!value) return;
    const message = unitProblem(value.unit, name);
    if (message) add(`${path}.unit`, message);
    if (value.source && !sources.has(value.source.id))
      add(`${path}.source.id`, `source ${value.source.id} is not in sources`);
  };
  panel.equipment.forEach((entry, index) => {
    const path = `equipment[${index}]`;
    if (entry.item) ref(entry.item, `${path}.item`);
    if (entry.rail !== undefined && !rails.has(entry.rail))
      add(`${path}.rail`, `rail ${entry.rail} does not exist`);
    if (entry.x !== undefined && entry.rail === undefined) add(`${path}.x`, "a position needs a rail");
    if (entry.location !== "plate" && (entry.rail !== undefined || entry.mountedOn !== undefined))
      add(`${path}.location`, `${entry.location} equipment has no rail or host`);
    if (entry.mountedOn !== undefined) {
      const host = equipment.get(entry.mountedOn);
      if (!host) add(`${path}.mountedOn`, `equipment ${entry.mountedOn} does not exist`);
      else if (host.tag === entry.tag) add(`${path}.mountedOn`, "an equipment is not mounted on itself");
      else if (host.mountedOn !== undefined)
        add(`${path}.mountedOn`, `${host.tag} is itself mounted on a host`);
      else if (host.location !== "plate" || entry.location !== "plate")
        add(`${path}.mountedOn`, "a mounted equipment and its host are on the plate");
      if (entry.rail !== undefined) add(`${path}.rail`, "a mounted equipment has no rail of its own");
    }
    if ((entry.mounting === undefined) !== (entry.mountedOn === undefined))
      add(`${path}.mounting`, "mounting is given exactly with mountedOn");
    if (entry.supply !== undefined) {
      if (!equipment.has(entry.supply)) add(`${path}.supply`, `equipment ${entry.supply} does not exist`);
      else if (entry.supply === entry.tag) add(`${path}.supply`, "an equipment does not supply itself");
    }
    for (const [name, value] of Object.entries(entry.declared ?? {}))
      quantity(value, name, `${path}.declared.${name}`);
  });
  panel.strips.forEach((strip, index) => {
    ref(strip.item, `strips[${index}].item`);
    if (!rails.has(strip.rail)) add(`strips[${index}].rail`, `rail ${strip.rail} does not exist`);
  });
  panel.scenarios.forEach((scenario, index) => {
    (scenario.active ?? []).forEach((active, at) => {
      if (!equipment.has(active) && !strips.has(active))
        add(`scenarios[${index}].active[${at}]`, `${active} is no equipment or strip`);
    });
  });
  if (new Set(panel.scenarios.map((scenario) => scenario.tag)).size !== panel.scenarios.length)
    add("scenarios", "a scenario tag repeats");
  if (panel.thermal) {
    quantity(panel.thermal.ambientTemperatureMax, "ambientTemperatureMax", "thermal.ambientTemperatureMax");
    quantity(
      panel.thermal.heatTransferCoefficient,
      "heatTransferCoefficient",
      "thermal.heatTransferCoefficient",
    );
    const k = panel.thermal.heatTransferCoefficient.value;
    if (k !== null && !(k > 0)) add("thermal.heatTransferCoefficient.value", "must be greater than 0");
    quantity(
      panel.thermal.internalTemperatureMax,
      "internalTemperatureMax",
      "thermal.internalTemperatureMax",
    );
    quantity(panel.thermal.wiringLoss, "wiringLoss", "thermal.wiringLoss");
    if (panel.thermal.fan) ref(panel.thermal.fan, "thermal.fan");
  }
  quantity(panel.assembly.shortCircuitRating, "shortCircuitRating", "assembly.shortCircuitRating");
  return problems.length ? { problems } : { panel };
}

/** Strictly reads a panel from JSON text; throws `Invalid panel file <id>:` with its problems. */
export function parsePanel(text: string, fileId?: string): Panel {
  const label = `panel file ${fileId ?? "(text)"}`;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error(problemsText(label, [{ path: "(document)", message: "is not JSON" }]));
  }
  const checked = checkPanel(raw, fileId);
  if ("problems" in checked) throw Error(problemsText(label, checked.problems));
  return checked.panel;
}

export interface PanelStamp {
  id: string;
  path: string;
  sha256: string;
}
/** Reads `electrical-automation-panels/<id>.json` strictly, confined to the workbench. */
export async function readPanelFile(root: string, id: string): Promise<{ panel: Panel; stamp: PanelStamp }> {
  const panelId = electricalIdSchema.parse(id);
  const path = `${panelDir}/${panelId}.json`;
  const target = await (await PathGuard.create(root)).resolve(path);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(`The panel file ${path} does not exist.`);
    throw error;
  }
  if (!info.isFile()) throw Error(`The panel file ${path} is not an ordinary file.`);
  if (info.size > panelLimits.fileBytes) throw Error(`The panel file ${path} is larger than 1 MiB.`);
  const bytes = await readFile(target.absolute);
  const panel = parsePanel(bytes.toString("utf8"), panelId);
  return { panel, stamp: { id: panel.id, path, sha256: createHash("sha256").update(bytes).digest("hex") } };
}
