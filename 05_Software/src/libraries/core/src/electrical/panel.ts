// The panel engineering engine (spec REQ-DATA-a8bf1713): a pure function from the model, one panel file, its
// catalogs, a CURRENT motor_drives result (and the network result it chains to) and optional QElectroTech projects to
// one electrical result with a BOM, terminal, 24 V, placement, dissipation, thermal and short-circuit criteria and an
// assembly verification report. Nothing here reads files; panel-tool.ts passes them in. No IEC 61439 conformity is
// claimed: the result is preliminary engineering support.
import type {
  CatalogItem,
  ElectricalAssembly,
  ElectricalCondition,
  ElectricalModel,
  ElectricalQuantity,
  ElectricalResult,
  IndustrialCatalog,
  Panel,
  PanelEquipment,
  PanelResult,
  PanelStrip,
} from "@vera/shared";
import type { CatalogStamp } from "./catalog.js";
import { covers } from "./catalog.js";
import { entityHash, modelEntities } from "./model.js";
import type { QetProject } from "./qet.js";
import { toBaseUnit } from "./units.js";

export const panelEngine = { name: "vera-panel", version: "1.0.0" } as const;
type Conditions = Record<string, ElectricalCondition>;
type Verdict = "pass" | "fail" | "unknown" | "not-evaluated";
type Criterion = ElectricalResult["criteria"][number];
type Value = ElectricalResult["intermediate"][number];
type Placement = PanelResult["placements"][number];

export interface PanelCatalog {
  catalog: IndustrialCatalog;
  stamp: CatalogStamp;
}
export interface PanelSchematic {
  path: string;
  sha256: string;
  motor: string | null;
  project: QetProject;
}
export interface PanelInput {
  model: ElectricalModel;
  modelPath: string;
  modelSha256: string;
  panel: Panel;
  panelPath: string;
  panelSha256: string;
  catalogs: ReadonlyMap<string, PanelCatalog>;
  motorDrives: ElectricalResult;
  network: ElectricalResult | null;
  schematics: readonly PanelSchematic[];
  runId: string;
  now: string;
}

/** Effective surface S (m²) of an enclosure of height, width and depth (m) for its installation (p. 8/110). */
export function effectiveSurface(
  installation: Panel["enclosure"]["installation"],
  h: number,
  w: number,
  d: number,
) {
  switch (installation) {
    case "free-standing":
      return 1.8 * h * (w + d) + 1.4 * w * d;
    case "wall":
      return 1.4 * w * (h + d) + 1.8 * d * h;
    case "end-free":
      return 1.4 * d * (h + w) + 1.8 * w * h;
    case "end-wall":
      return 1.4 * h * (w + d) + 1.4 * w * d;
    case "middle":
      return 1.8 * w * h + 1.4 * w * d + d * h;
    case "middle-wall":
      return 1.4 * w * (h + d) + d * h;
    case "middle-wall-covered":
      return 1.4 * w * h + 0.7 * w * d + d * h;
  }
}
/** Air factor of the fan case, m³·K/(W·h) (p. 8/111). */
export const AIR_FACTOR = 3.1;
/** Mean air temperature rise (K) for a dissipation P (W), K (W/(m²·K)), S (m²) and a fan airflow (m³/h). */
export function temperatureRise(power: number, k: number, surface: number, airflow = 0): number {
  return power / (k * surface + airflow / AIR_FACTOR);
}
const PROFILE_HEIGHT = { "TH35-7.5": 7.5, "TH35-15": 15 } as const;

/** The design verification characteristics of low-voltage switchgear assemblies, by name. */
export const verificationCharacteristics = [
  "strength of materials and parts",
  "degree of protection of enclosures",
  "clearances",
  "creepage distances",
  "protection against electric shock and integrity of protective circuits",
  "incorporation of switching devices and components",
  "internal electrical circuits and connections",
  "terminals for external conductors",
  "dielectric properties",
  "temperature-rise limits",
  "short-circuit withstand strength",
  "electromagnetic compatibility",
  "mechanical operation",
] as const;
export const NO_CONFORMITY =
  "No IEC 61439 conformity is claimed: the verification report lists what VERA evaluated and what stays open; design verification of the assembly by test, comparison or assessment is the assembly manufacturer's.";

const sig = (value: number) => Number(value.toPrecision(6));
const fold = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
/** Text from files (QET labels, catalog names) without control characters and cut to `max` characters. */
const clean = (text: string, max: number) => {
  const plain = text.replace(/\p{Cc}/gu, " ");
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
};
const list = (items: readonly string[], max = 12) => {
  const shown = items.slice(0, max).map((item) => clean(item, 60));
  return items.length > max ? `${shown.join(", ")} and ${items.length - max} more` : shown.join(", ");
};

interface Resolved {
  catalog: IndustrialCatalog;
  item: CatalogItem;
  manufacturer: string | null;
}
/** A number in a given unit of the dimension, from a value in any unit of the table. */
function inUnit(value: number, unit: string, target: string): number {
  const base = toBaseUnit(value, unit);
  const scale = toBaseUnit(1, target) - toBaseUnit(0, target);
  return (base - toBaseUnit(0, target)) / scale;
}
interface Picked {
  value: number;
  declared: boolean;
  text: string;
}

/** Engine state shared by the sections of one check. */
class PanelContext {
  readonly criteria: Criterion[] = [];
  readonly intermediate: Value[] = [];
  readonly assumptions: string[] = [];
  readonly messages: string[] = [];
  readonly limits: string[] = [];
  readonly equipment: ReadonlyMap<string, PanelEquipment>;
  readonly strips: ReadonlyMap<string, PanelStrip>;
  readonly refs: ReadonlyMap<string, string>;
  private readonly declaredSeen = new Set<string>();

  constructor(
    readonly input: PanelInput,
    readonly panel: Panel,
  ) {
    this.equipment = new Map(panel.equipment.map((entry) => [entry.tag, entry]));
    this.strips = new Map(panel.strips.map((strip) => [strip.tag, strip]));
    this.refs = new Map(
      input.model.objects.flatMap((object) => (object.ref ? [[object.id, object.ref]] : [])),
    );
  }
  add(entry: Criterion) {
    this.criteria.push({
      ...entry,
      id: clean(entry.id, 200),
      title: clean(entry.title, 200),
      ...(entry.note !== undefined ? { note: clean(entry.note, 1000) } : {}),
    });
  }
  value(name: string, value: number | null, unit: string, subject?: string) {
    this.intermediate.push({
      name,
      ...(subject ? { subject } : {}),
      value: value === null ? null : sig(value),
      unit,
    });
  }
  ref(id: string) {
    return this.refs.get(id) ?? id;
  }
  resolve(ref: { catalog: string; item: string } | null): Resolved | null {
    if (!ref) return null;
    const catalog = this.input.catalogs.get(ref.catalog)?.catalog;
    const item = catalog?.items.find((entry) => entry.id === ref.item);
    if (!catalog || !item) return null;
    const family = catalog.families.find((entry) => entry.id === item.family);
    return { catalog, item, manufacturer: family?.manufacturer ?? null };
  }
  /** Confirmed catalog values of `name` whose conditions cover the wanted ones (keys the value names only). */
  values(resolved: Resolved | null, name: string, wanted: Conditions = {}) {
    if (!resolved) return [];
    return resolved.item.parameters.filter((parameter) => {
      if (parameter.name !== name || parameter.status !== "confirmed" || parameter.value === null)
        return false;
      const offered = parameter.conditions ?? {};
      const asked = Object.fromEntries(
        Object.entries(wanted).filter(
          ([key]) =>
            offered[key] !== undefined ||
            offered[`${key}Min`] !== undefined ||
            offered[`${key}Max`] !== undefined,
        ),
      );
      return covers(offered, asked);
    });
  }
  /** The largest (or smallest) agreeing catalog value of an entry in `unit`, else its declared value. */
  pick(
    tag: string,
    ref: { catalog: string; item: string } | null,
    declared: Record<string, ElectricalQuantity> | undefined,
    conditions: Conditions | undefined,
    name: string,
    unit: string,
    smallest = false,
  ): Picked | null {
    const found = this.values(this.resolve(ref), name, conditions ?? {});
    if (found.length) {
      const numbers = found.map((parameter) => inUnit(parameter.value as number, parameter.unit, unit));
      const value = smallest ? Math.min(...numbers) : Math.max(...numbers);
      return { value, declared: false, text: `${sig(value)} ${unit}` };
    }
    const own = declared?.[name];
    if (own && own.value !== null) {
      const value = inUnit(own.value, own.unit, unit);
      const key = `${tag}.${name}`;
      if (!this.declaredSeen.has(key)) {
        this.declaredSeen.add(key);
        this.assumptions.push(
          `${tag} ${name} ${own.value} ${own.unit} declared in the panel file (${own.basis})${own.note ? `: ${own.note}` : ""}.`,
        );
      }
      return { value, declared: true, text: `${sig(value)} ${unit} (declared)` };
    }
    return null;
  }
  of(entry: PanelEquipment, name: string, unit: string, smallest = false) {
    return this.pick(entry.tag, entry.item, entry.declared, entry.conditions, name, unit, smallest);
  }
}

// ---- fingerprints ---------------------------------------------------------------------------------------------------

function itemJson(
  catalogs: ReadonlyMap<string, PanelCatalog>,
  ref: { catalog: string; item: string } | null,
) {
  if (!ref) return null;
  return catalogs.get(ref.catalog)?.catalog.items.find((item) => item.id === ref.item) ?? null;
}
/** Fingerprints of each equipment and strip (entry, catalog item, model object) and of the panel frame. */
export function panelFingerprints(
  panel: Panel,
  catalogs: ReadonlyMap<string, PanelCatalog>,
  model: ElectricalModel,
): { frame: string; tags: Map<string, string> } {
  const objects = new Map(model.objects.map((object) => [object.id, object]));
  const tags = new Map<string, string>();
  for (const entry of panel.equipment)
    tags.set(
      entry.tag,
      entityHash({
        entry,
        item: itemJson(catalogs, entry.item),
        model: entry.model ? (objects.get(entry.model) ?? null) : null,
        motor: entry.motor ? (objects.get(entry.motor) ?? null) : null,
      }),
    );
  for (const strip of panel.strips)
    tags.set(strip.tag, entityHash({ strip, item: itemJson(catalogs, strip.item) }));
  const { equipment: _equipment, strips: _strips, ...frame } = panel;
  return {
    frame: entityHash({
      frame,
      enclosure: itemJson(catalogs, panel.enclosure.item),
      plate: itemJson(catalogs, panel.enclosure.plate),
      fan: itemJson(catalogs, panel.thermal?.fan ?? null),
    }),
    tags,
  };
}

// ---- reconciliation -------------------------------------------------------------------------------------------------

function boardScope(model: ElectricalModel, board: string) {
  const feeds = model.relations.filter((relation) => relation.type === "feeds");
  const circuits = feeds.filter((relation) => relation.from === board).map((relation) => relation.to);
  const fed = feeds.filter((relation) => circuits.includes(relation.from));
  const contains = model.relations.filter(
    (relation) => relation.type === "contains" && relation.from === board,
  );
  return {
    circuits,
    fed: fed.map((relation) => relation.to),
    contained: contains.map((relation) => relation.to),
    relations: [...feeds.filter((relation) => relation.from === board), ...fed, ...contains].map(
      (relation) => relation.id,
    ),
  };
}

function panelMotors(panel: Panel): string[] {
  const motors: string[] = [];
  for (const entry of [...panel.equipment, ...panel.strips])
    if (entry.motor !== undefined && !motors.includes(entry.motor)) motors.push(entry.motor);
  return motors;
}

function reconcile(ctx: PanelContext, scope: ReturnType<typeof boardScope>) {
  const { panel, input } = ctx;
  const assemblyCatalog = input.motorDrives.catalog?.id ?? null;
  const items = assemblyCatalog ? input.catalogs.get(assemblyCatalog)?.catalog : undefined;
  const code = (id: string | null) =>
    id === null ? "none" : (items?.items.find((item) => item.id === id)?.orderCode ?? id);
  const motors = panelMotors(panel);
  for (const motor of motors) {
    const assembly = (input.motorDrives.assemblies ?? []).find((entry) => entry.motor === motor);
    const id = `assembly:${ctx.ref(motor)}`;
    const title = `Assembly devices of ${ctx.ref(motor)} in the panel`;
    if (!assembly) {
      ctx.add({
        id,
        title,
        subject: motor,
        verdict: "fail",
        note: `The motor_drives result ${input.motorDrives.runId} has no assembly for ${ctx.ref(motor)}.`,
      });
      continue;
    }
    const missing: string[] = [];
    const differs: string[] = [];
    const open: string[] = [];
    for (const device of assembly.devices) {
      const entry = panel.equipment.find(
        (candidate) => candidate.motor === motor && (candidate.schematicTag ?? candidate.tag) === device.tag,
      );
      if (!entry) {
        missing.push(`${device.tag} (${device.orderCode ?? "no item"})`);
        continue;
      }
      if (device.item === null) {
        open.push(`${device.tag} has no item in the assembly`);
        continue;
      }
      if (!entry.item || entry.item.catalog !== assemblyCatalog || entry.item.item !== device.item)
        differs.push(
          `${entry.tag}: panel ${entry.item ? (ctx.resolve(entry.item)?.item.orderCode ?? `${entry.item.catalog}/${entry.item.item}`) : "no item"}, assembly ${code(device.item)}`,
        );
    }
    if (assembly.conditional)
      ctx.messages.push(
        `The ${assembly.method} assembly of ${ctx.ref(motor)} is conditional in ${input.motorDrives.runId}.`,
      );
    const verdict: Verdict = missing.length || differs.length ? "fail" : open.length ? "unknown" : "pass";
    ctx.add({
      id,
      title,
      subject: motor,
      verdict,
      note:
        verdict === "pass"
          ? `${assembly.devices.length} devices of the ${assembly.method} assembly (${input.motorDrives.runId}) are in the panel with the same catalog items.`
          : [
              missing.length ? `Missing: ${list(missing)}.` : "",
              differs.length ? `Other item: ${list(differs)}.` : "",
              open.length ? `${list(open)}.` : "",
            ]
              .filter(Boolean)
              .join(" "),
    });
  }
  // Motors and loads fed from the board.
  const excluded = new Map(panel.excluded.map((entry) => [entry.object, entry.reason]));
  const objects = new Map(input.model.objects.map((object) => [object.id, object]));
  const uncovered: string[] = [];
  const declaredOut: string[] = [];
  for (const id of scope.fed) {
    const object = objects.get(id);
    if (!object || (object.type !== "motor" && object.type !== "load")) continue;
    if (motors.includes(id) || panel.equipment.some((entry) => entry.model === id || entry.motor === id))
      continue;
    if (excluded.has(id)) declaredOut.push(`${ctx.ref(id)} (${excluded.get(id)})`);
    else uncovered.push(ctx.ref(id));
  }
  ctx.add({
    id: "model-loads",
    title: "Motors and loads of the board",
    subject: panel.board,
    verdict: uncovered.length ? "fail" : "pass",
    note: uncovered.length
      ? `Fed from ${ctx.ref(panel.board)} but not in the panel or excluded: ${list(uncovered)}.`
      : `Every motor and load fed from ${ctx.ref(panel.board)} is in the panel${declaredOut.length ? `; excluded by declaration: ${list(declaredOut)}` : ""}.`,
  });
  const absent: string[] = [];
  let devices = 0;
  for (const id of scope.contained) {
    const object = objects.get(id);
    if (!object || !["device", "protection", "terminal"].includes(object.type)) continue;
    devices += 1;
    const found =
      panel.equipment.some(
        (entry) => entry.model === id || (object.ref !== undefined && entry.tag === object.ref),
      ) || panel.strips.some((strip) => object.ref !== undefined && strip.tag === object.ref);
    if (!found) absent.push(object.ref ?? id);
  }
  ctx.add({
    id: "model-devices",
    title: "Devices the board contains in the model",
    subject: panel.board,
    verdict: absent.length ? "fail" : "pass",
    note: absent.length
      ? `In the model's ${ctx.ref(panel.board)} but not in the panel: ${list(absent)}.`
      : devices
        ? `${devices} devices of the model's ${ctx.ref(panel.board)} are in the panel.`
        : `The model's ${ctx.ref(panel.board)} contains no device, protection or terminal object.`,
  });
  // Schematics.
  for (const schematic of input.schematics) {
    const scope = schematic.motor;
    const motorRef = scope ? ctx.ref(scope) : null;
    const labels = new Map<string, string>();
    for (const device of schematic.project.devices) {
      const kind = device.head.definition?.linkType;
      if (!device.label || kind === "next_report" || kind === "previous_report" || kind === "thumbnail")
        continue;
      if (motorRef !== null && fold(device.label) === fold(motorRef)) continue;
      labels.set(fold(device.label), device.label);
    }
    const notInPanel: string[] = [];
    for (const [label, shown] of labels) {
      const found =
        panel.strips.some(
          (strip) => fold(strip.tag) === label && (strip.motor === undefined || strip.motor === scope),
        ) ||
        panel.equipment.some((entry) =>
          scope !== null && entry.motor === scope
            ? fold(entry.schematicTag ?? entry.tag) === label
            : entry.motor === undefined && fold(entry.tag) === label,
        );
      if (!found) notInPanel.push(shown);
    }
    const notDrawn =
      scope === null
        ? []
        : panel.equipment
            .filter(
              (entry) => entry.motor === scope && entry.mountedOn === undefined && entry.location !== "field",
            )
            .filter((entry) => !labels.has(fold(entry.schematicTag ?? entry.tag)))
            .map((entry) => entry.tag);
    const fail = notInPanel.length || notDrawn.length;
    ctx.add({
      id: `schematic:${schematic.path}`.slice(0, 200),
      title: `Schematic ${schematic.path} against the panel`,
      ...(scope ? { subject: scope } : {}),
      verdict: fail ? "fail" : "pass",
      note: fail
        ? [
            notInPanel.length ? `Drawn but not in the panel: ${list(notInPanel)}.` : "",
            notDrawn.length ? `In the panel for ${motorRef} but not drawn: ${list(notDrawn)}.` : "",
          ]
            .filter(Boolean)
            .join(" ")
        : `${labels.size} labelled devices match the panel${scope ? ` for ${motorRef}` : ""}.`,
    });
  }
}

// ---- BOM and accessories --------------------------------------------------------------------------------------------

function activeIn(panel: Panel, scenario: Panel["scenarios"][number], tag: string): boolean {
  if (!scenario.active) return true;
  if (scenario.active.includes(tag)) return true;
  const host = panel.equipment.find((entry) => entry.tag === tag)?.mountedOn;
  return host !== undefined && scenario.active.includes(host);
}

function bom(ctx: PanelContext, fingerprints: Map<string, string>): PanelResult["bom"] {
  const { panel } = ctx;
  const lines: PanelResult["bom"] = [];
  const noItem: string[] = [];
  const missing: string[] = [];
  const line = (
    tag: string,
    kind: "equipment" | "strip",
    ref: { catalog: string; item: string } | null,
    extra: {
      role: string;
      location: PanelEquipment["location"];
      quantity: number;
      motor?: string | undefined;
      mountedOn?: string | undefined;
      supply?: string | undefined;
    },
  ) => {
    const resolved = ctx.resolve(ref);
    if (!ref) noItem.push(tag);
    else if (!resolved) missing.push(`${tag} (${ref.catalog}/${ref.item})`);
    lines.push({
      tag,
      kind,
      role: extra.role,
      location: extra.location,
      quantity: extra.quantity,
      catalog: ref?.catalog ?? null,
      item: ref?.item ?? null,
      orderCode: resolved?.item.orderCode ?? null,
      manufacturer: resolved?.manufacturer ?? null,
      name: resolved?.item.name ?? null,
      motor: extra.motor ?? null,
      mountedOn: extra.mountedOn ?? null,
      supply: extra.supply ?? null,
      scenarios: panel.scenarios
        .filter((scenario) => activeIn(panel, scenario, tag))
        .map((scenario) => scenario.tag),
      sha256: fingerprints.get(tag) as string,
    });
  };
  for (const entry of panel.equipment)
    line(entry.tag, "equipment", entry.item, {
      role: entry.role,
      location: entry.location,
      quantity: 1,
      motor: entry.motor,
      mountedOn: entry.mountedOn,
      supply: entry.supply,
    });
  for (const strip of panel.strips)
    line(strip.tag, "strip", strip.item, {
      role: `terminal strip (${strip.count} + ${strip.spare} spare)`,
      location: "plate",
      quantity: strip.count + strip.spare,
      motor: strip.motor,
    });
  ctx.add({
    id: "bom-items",
    title: "Catalog item of every BOM line",
    verdict: missing.length ? "fail" : noItem.length ? "unknown" : "pass",
    note: missing.length
      ? `Not found in the named catalogs: ${list(missing)}.${noItem.length ? ` Without item (order code unknown): ${list(noItem)}.` : ""}`
      : noItem.length
        ? `Without item (order code unknown): ${list(noItem)}.`
        : `${lines.length} lines, each with a catalog item and order code.`,
  });
  return lines;
}

function accessories(ctx: PanelContext) {
  const { panel } = ctx;
  const check = (
    id: string,
    title: string,
    hostRef: PanelEquipment["item"],
    accRef: PanelEquipment["item"],
    what: string,
  ) => {
    const host = ctx.resolve(hostRef);
    const accessory = ctx.resolve(accRef);
    if (!host || !accessory) {
      ctx.add({
        id,
        title,
        verdict: "unknown",
        note: `${what}: ${!accessory ? "the accessory" : "the host"} has no catalog item, so compatibility is not established in the catalog.`,
      });
      return;
    }
    const listed =
      host.catalog.id === accessory.catalog.id
        ? host.item.accessories?.find((entry) => entry.item === accessory.item.id)
        : undefined;
    ctx.add({
      id,
      title,
      verdict: listed ? "pass" : "unknown",
      note: listed
        ? `${accessory.item.orderCode} is listed as ${listed.role} of ${host.item.orderCode}${listed.note ? `: ${listed.note.replace(/\.$/, "")}` : ""}.`
        : `${host.item.orderCode} does not list ${accessory.item.orderCode} as an accessory: compatibility is not established in the catalog and is not assumed.`,
    });
  };
  check(
    "accessory:plate",
    "Mounting plate in the enclosure",
    panel.enclosure.item,
    panel.enclosure.plate,
    "Mounting plate",
  );
  for (const entry of panel.equipment) {
    if (entry.mountedOn === undefined) continue;
    const host = ctx.equipment.get(entry.mountedOn);
    check(
      `accessory:${entry.tag}`,
      `${entry.tag} mounted ${entry.mounting} ${entry.mountedOn}`,
      host?.item ?? null,
      entry.item,
      `${entry.tag} on ${entry.mountedOn}`,
    );
  }
}

// ---- terminals ------------------------------------------------------------------------------------------------------

function motorTerminals(assembly: ElectricalAssembly): number {
  const names = new Set<string>();
  for (const connection of assembly.connections) {
    if (connection.to !== "motor" && !connection.to.startsWith("motor:")) continue;
    const at = connection.to.indexOf(":");
    const terminals = at < 0 ? ["1", "2", "3"] : connection.to.slice(at + 1).split(",");
    for (const name of terminals) names.add(name);
  }
  return names.size;
}

function terminals(ctx: PanelContext) {
  const { panel, input } = ctx;
  for (const strip of panel.strips) {
    const needs: string[] = [];
    let required = 0;
    if (strip.motor !== undefined) {
      const assembly = (input.motorDrives.assemblies ?? []).find((entry) => entry.motor === strip.motor);
      const count = assembly ? motorTerminals(assembly) : 0;
      if (count) {
        required = Math.max(required, count);
        needs.push(`${count} motor terminals of the ${assembly?.method} assembly of ${ctx.ref(strip.motor)}`);
      }
    }
    for (const schematic of input.schematics) {
      if (schematic.motor !== null && strip.motor !== undefined && schematic.motor !== strip.motor) continue;
      const devices = schematic.project.devices.filter(
        (entry) => entry.label !== null && fold(entry.label) === fold(strip.tag),
      );
      if (!devices.length) continue;
      const members = new Set(
        devices.flatMap((device) => [device.head.uuid, ...device.members.map((m) => m.uuid)]),
      );
      let connected = 0;
      for (const key of schematic.project.potentialOf.keys())
        if (members.has(key.slice(0, key.lastIndexOf("#")))) connected += 1;
      if (connected) {
        required = Math.max(required, connected);
        needs.push(`${connected} connected terminals of ${strip.tag} in ${schematic.path}`);
      }
    }
    ctx.add({
      id: `terminals:${strip.tag}`,
      title: `Terminal strip ${strip.tag}`,
      ...(strip.motor ? { subject: strip.motor } : {}),
      verdict: !needs.length ? "unknown" : strip.count >= required ? "pass" : "fail",
      measured: { value: strip.count, unit: "1" },
      ...(needs.length ? { limit: { value: required, unit: "1" } } : {}),
      note: needs.length
        ? `${strip.count} terminals against ${needs.join("; ")}.`
        : `No motor assembly or schematic device names what ${strip.tag} must provide.`,
    });
    const spare = Math.ceil((strip.count * panel.reserve.terminalsPercent) / 100 - 1e-9);
    ctx.add({
      id: `terminal-spare:${strip.tag}`,
      title: `Spare terminals of ${strip.tag}`,
      verdict: strip.spare >= spare ? "pass" : "fail",
      measured: { value: strip.spare, unit: "1" },
      limit: { value: spare, unit: "1" },
      note: `${strip.spare} spare against ${panel.reserve.terminalsPercent} % of ${strip.count} declared reserve.`,
    });
  }
}

// ---- placement ------------------------------------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - 1e-9 &&
  b.x < a.x + a.width - 1e-9 &&
  a.y < b.y + b.height - 1e-9 &&
  b.y < a.y + a.height - 1e-9;
const inside = (a: Rect, b: Rect) =>
  a.x >= b.x - 1e-9 &&
  a.y >= b.y - 1e-9 &&
  a.x + a.width <= b.x + b.width + 1e-9 &&
  a.y + a.height <= b.y + b.height + 1e-9;
function gap(a: Rect, b: Rect) {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

interface Footprint {
  width: number;
  height: number;
  /** Height above the rail centre line. */
  top: number;
  depth: number;
}
interface Mountable {
  tag: string;
  class: string;
  rail?: string | undefined;
  x?: number | undefined;
}

function footprints(ctx: PanelContext) {
  const { panel } = ctx;
  const sizes = new Map<string, Footprint>();
  const missing = new Map<string, string[]>();
  const size = (entry: PanelEquipment) => {
    const lacking: string[] = [];
    const get = (name: string) => {
      const picked = ctx.of(entry, name, "mm");
      if (!picked) lacking.push(`${entry.tag} ${name}`);
      return picked?.value ?? 0;
    };
    const out = { width: get("width"), height: get("height"), depth: get("depth") };
    return { out, lacking };
  };
  for (const entry of panel.equipment) {
    if (entry.location !== "plate" || entry.mountedOn !== undefined) continue;
    const own = size(entry);
    const lacking = [...own.lacking];
    let { width, height, depth } = own.out;
    const top = height / 2;
    for (const accessory of panel.equipment.filter((candidate) => candidate.mountedOn === entry.tag)) {
      const acc = size(accessory);
      lacking.push(...acc.lacking);
      if (accessory.mounting === "below") {
        height += acc.out.height;
        width = Math.max(width, acc.out.width);
      } else {
        width += acc.out.width;
        height = Math.max(height, acc.out.height);
      }
      depth = Math.max(depth, acc.out.depth);
    }
    if (lacking.length) missing.set(entry.tag, lacking);
    else sizes.set(entry.tag, { width, height, top, depth });
  }
  for (const strip of panel.strips) {
    const resolved = ctx.resolve(strip.item);
    const lacking: string[] = [];
    const get = (name: string) => {
      const picked = ctx.pick(strip.tag, strip.item, undefined, undefined, name, "mm");
      if (!picked) lacking.push(`${strip.tag} ${name}`);
      return picked?.value ?? 0;
    };
    const width = get("width") * (strip.count + strip.spare);
    const height = get("height");
    const depth = get("depth");
    if (!resolved) lacking.push(`${strip.tag} item`);
    if (lacking.length) missing.set(strip.tag, lacking);
    else sizes.set(strip.tag, { width, height, top: height / 2, depth });
  }
  return { sizes, missing };
}

function placement(ctx: PanelContext): {
  placements: Placement[];
  rails: PanelResult["rails"];
  plate: { width: number; height: number } | null;
} {
  const { panel } = ctx;
  const plateResolved = ctx.resolve(panel.enclosure.plate);
  const plateW = ctx.pick("plate", panel.enclosure.plate, undefined, undefined, "width", "mm");
  const plateH = ctx.pick("plate", panel.enclosure.plate, undefined, undefined, "height", "mm");
  const plate =
    plateResolved && plateW && plateH ? { x: 0, y: 0, width: plateW.value, height: plateH.value } : null;
  const zones = new Map(panel.zones.map((zone) => [zone.tag, zone]));
  const rails = new Map(panel.rails.map((rail) => [rail.tag, rail]));
  const { sizes, missing } = footprints(ctx);
  const problems = new Map<string, string[]>();
  const problem = (tag: string, text: string) => problems.set(tag, [...(problems.get(tag) ?? []), text]);
  const placed = new Map<string, Rect & { rail: string }>();
  const occupied = new Map<string, { start: number; end: number }[]>();
  for (const rail of panel.rails) {
    occupied.set(rail.tag, []);
    const line = { x: rail.x, y: rail.y, width: rail.length, height: 1e-6 };
    const zone = zones.get(rail.zone);
    const fails = [
      plate && !inside(line, plate) ? "leaves the plate" : "",
      zone && !inside(line, zone) ? `leaves zone ${zone.tag}` : "",
    ].filter(Boolean);
    if (!plate)
      ctx.messages.push(
        "The plate has no stated width and height: rails and placements are not checked against it.",
      );
    if (fails.length)
      ctx.add({
        id: `rail:${rail.tag}`,
        title: `Rail ${rail.tag}`,
        verdict: "fail",
        note: `Rail ${rail.tag} ${fails.join(" and ")}.`,
      });
  }
  const put = (entry: Mountable, railTag: string, start: number) => {
    const rail = rails.get(railTag);
    const size = sizes.get(entry.tag);
    if (!rail || !size) return;
    placed.set(entry.tag, {
      x: start,
      y: rail.y - size.top,
      width: size.width,
      height: size.height,
      rail: railTag,
    });
    occupied.get(railTag)?.push({ start, end: start + size.width });
  };
  const fits = (railTag: string, width: number): number | null => {
    const rail = rails.get(railTag);
    if (!rail) return null;
    const taken = [...(occupied.get(railTag) ?? [])].sort((a, b) => a.start - b.start);
    let cursor = rail.x;
    for (const span of taken) {
      if (cursor + width + rail.gap <= span.start + 1e-9) return cursor;
      cursor = Math.max(cursor, span.end + rail.gap);
    }
    return cursor + width <= rail.x + rail.length + 1e-9 ? cursor : null;
  };
  const mountables: Mountable[] = [
    ...panel.equipment.filter((entry) => entry.location === "plate" && entry.mountedOn === undefined),
    ...panel.strips,
  ];
  // Pinned first, then file order.
  for (const entry of mountables) {
    if (entry.rail === undefined || entry.x === undefined) continue;
    const size = sizes.get(entry.tag);
    const rail = rails.get(entry.rail);
    if (!size || !rail) continue;
    const start = rail.x + entry.x;
    if (start + size.width > rail.x + rail.length + 1e-9)
      problem(entry.tag, `ends ${sig(start + size.width - rail.x - rail.length)} mm beyond rail ${rail.tag}`);
    put(entry, entry.rail, start);
  }
  for (const entry of mountables) {
    if (entry.x !== undefined || !sizes.has(entry.tag)) continue;
    const size = sizes.get(entry.tag) as Footprint;
    const candidates =
      entry.rail !== undefined
        ? [entry.rail]
        : panel.rails
            .filter((rail) => zones.get(rail.zone)?.classes.includes(entry.class))
            .map((rail) => rail.tag);
    if (!candidates.length) {
      problem(entry.tag, `no rail lies in a zone accepting class ${entry.class}`);
      continue;
    }
    const chosen = candidates
      .map((rail) => [rail, fits(rail, size.width)] as const)
      .find(([, at]) => at !== null);
    if (!chosen) {
      problem(
        entry.tag,
        `no room on ${entry.rail !== undefined ? `rail ${entry.rail}` : `the rails of class ${entry.class} (${candidates.join(", ")})`}`,
      );
      continue;
    }
    put(entry, chosen[0], chosen[1] as number);
  }
  // Checks on the placed footprints.
  const placedList = [...placed.entries()];
  const keepOut = panel.rules.filter((rule) => rule.kind === "keep-out");
  for (const [tag, rect] of placedList) {
    const entry = mountables.find((candidate) => candidate.tag === tag) as Mountable;
    const rail = rails.get(rect.rail);
    const zone = rail ? zones.get(rail.zone) : undefined;
    if (plate && !inside(rect, plate)) problem(tag, "leaves the plate");
    if (zone && !zone.classes.includes(entry.class))
      problem(tag, `zone ${zone.tag} does not accept class ${entry.class}`);
    else if (zone && !inside(rect, zone)) problem(tag, `leaves zone ${zone.tag}`);
    for (const [other, otherRect] of placedList)
      if (other !== tag && overlaps(rect, otherRect)) problem(tag, `overlaps ${other}`);
    for (const duct of panel.ducts) if (overlaps(rect, duct)) problem(tag, `overlaps duct ${duct.tag}`);
    for (const rule of keepOut)
      if (overlaps(rect, rule.area)) problem(tag, `enters keep-out area ${rule.tag}`);
    const size = sizes.get(tag) as Footprint;
    const profile = rail ? PROFILE_HEIGHT[rail.profile] : 0;
    if (size.depth + profile > panel.enclosure.mountingDepth + 1e-9)
      problem(
        tag,
        `depth ${sig(size.depth)} mm + ${profile} mm rail exceeds the mounting depth ${panel.enclosure.mountingDepth} mm`,
      );
  }
  for (const entry of mountables) {
    const lacking = missing.get(entry.tag);
    const issues = problems.get(entry.tag);
    if (lacking)
      ctx.add({
        id: `placement:${entry.tag}`,
        title: `Placement of ${entry.tag}`,
        verdict: "unknown",
        note: `Not placed: missing ${list(lacking)}.`,
      });
    else if (issues)
      ctx.add({
        id: `placement:${entry.tag}`,
        title: `Placement of ${entry.tag}`,
        verdict: "fail",
        note: `${entry.tag} ${issues.join("; ")}.`,
      });
  }
  const failing = mountables.filter((entry) => problems.has(entry.tag)).length;
  const unknown = mountables.filter((entry) => missing.has(entry.tag)).length;
  const unplaced = mountables.filter((entry) => !placed.has(entry.tag)).length;
  ctx.add({
    id: "layout",
    title: "2D layout on the rails",
    verdict: failing ? "fail" : unknown ? "unknown" : "pass",
    note: `${placed.size} of ${mountables.length} plate entries placed${failing ? `, ${failing} with a problem` : ""}${unknown ? `, ${unknown} without dimensions` : ""}; devices are centred on their rail, mounted accessories stacked on their host.`,
  });
  // Segregation.
  for (const rule of panel.rules) {
    if (rule.kind !== "segregation") continue;
    const inZone = (zone: string) =>
      placedList.filter(([, rect]) => rails.get(rect.rail)?.zone === zone).map(([, rect]) => rect);
    const a = inZone(rule.zones[0]);
    const b = inZone(rule.zones[1]);
    const smallest = a.length && b.length ? Math.min(...a.flatMap((ra) => b.map((rb) => gap(ra, rb)))) : null;
    // Entries not placed whose rail lies in one of the zones, or that have no rail of their own, may still land there.
    const pending = mountables
      .filter((entry) => !placed.has(entry.tag))
      .filter((entry) => {
        const zone = entry.rail === undefined ? undefined : rails.get(entry.rail)?.zone;
        return zone === undefined || rule.zones.includes(zone);
      })
      .map((entry) => entry.tag);
    const tooClose = smallest !== null && smallest + 1e-9 < rule.distance;
    ctx.add({
      id: `segregation:${rule.tag}`,
      title: `Segregation ${rule.zones.join("/")}`,
      verdict: tooClose ? "fail" : pending.length ? "unknown" : "pass",
      ...(smallest !== null ? { measured: { value: sig(smallest), unit: "mm" } } : {}),
      limit: { value: rule.distance, unit: "mm" },
      note: `${rule.text} (${rule.source.id}${rule.source.page ? ` p. ${rule.source.page}` : ""})${smallest === null ? " - one of the zones holds no placed device" : ""}${pending.length && !tooClose ? `; not placed yet: ${list(pending)}` : ""}.`,
    });
  }
  // Rail reserve.
  const railRows: PanelResult["rails"] = panel.rails.map((rail) => {
    const spans = occupied.get(rail.tag) ?? [];
    const used =
      spans.reduce((sum, span) => sum + (span.end - span.start), 0) +
      Math.max(0, spans.length - 1) * rail.gap;
    return { tag: rail.tag, x: rail.x, y: rail.y, length: rail.length, used: sig(used) };
  });
  const total = panel.rails.reduce((sum, rail) => sum + rail.length, 0);
  const free = railRows.reduce((sum, rail) => sum + (rail.length - (rail.used ?? 0)), 0);
  const share = total > 0 ? (free / total) * 100 : 0;
  ctx.value("railFree", total > 0 ? share : null, "%");
  ctx.add({
    id: "reserve-rails",
    title: "Free rail length",
    verdict: share + 1e-9 < panel.reserve.railPercent ? "fail" : unplaced ? "unknown" : "pass",
    measured: { value: sig(share), unit: "%" },
    limit: { value: panel.reserve.railPercent, unit: "%" },
    note: `${sig(free)} of ${total} mm rail free${unplaced ? `; ${unplaced} entries not placed still need room` : ""}.`,
  });
  const placements: Placement[] = [];
  const rect = (tag: string) => placed.get(tag);
  for (const entry of panel.equipment) {
    if (entry.location !== "plate") {
      placements.push({
        tag: entry.tag,
        rail: null,
        x: null,
        y: null,
        width: null,
        height: null,
        state: entry.location,
      });
      continue;
    }
    if (entry.mountedOn !== undefined) {
      const host = rect(entry.mountedOn);
      placements.push({
        tag: entry.tag,
        rail: host?.rail ?? null,
        x: null,
        y: null,
        width: null,
        height: null,
        state: "mounted",
      });
      continue;
    }
    const at = rect(entry.tag);
    placements.push(
      at
        ? {
            tag: entry.tag,
            rail: at.rail,
            x: sig(at.x),
            y: sig(at.y),
            width: sig(at.width),
            height: sig(at.height),
            state: "placed",
          }
        : { tag: entry.tag, rail: null, x: null, y: null, width: null, height: null, state: "unplaced" },
    );
  }
  for (const strip of panel.strips) {
    const at = rect(strip.tag);
    placements.push(
      at
        ? {
            tag: strip.tag,
            rail: at.rail,
            x: sig(at.x),
            y: sig(at.y),
            width: sig(at.width),
            height: sig(at.height),
            state: "placed",
          }
        : { tag: strip.tag, rail: null, x: null, y: null, width: null, height: null, state: "unplaced" },
    );
  }
  return { placements, rails: railRows, plate: plate ? { width: plate.width, height: plate.height } : null };
}

// ---- dissipation, thermal, 24 V -------------------------------------------------------------------------------------

function poles(ctx: PanelContext, entry: PanelEquipment): number | null {
  const counted = ctx.of(entry, "poles", "1");
  if (counted) return counted.value;
  const attribute = ctx.resolve(entry.item)?.item.attributes?.poles;
  const match = typeof attribute === "string" ? /^(\d+)P$/.exec(attribute.trim()) : null;
  return match ? Number(match[1]) : null;
}

/** Loss (W) of one non-supply entry, or the missing data. */
function entryLoss(ctx: PanelContext, entry: PanelEquipment): { loss: number } | { missing: string } {
  const whole = ctx.of(entry, "powerLoss", "W");
  const coil = ctx.of(entry, "coilPowerLoss", "W");
  // An item with a stated control (coil) voltage has a coil: its loss must be stated too, never taken as 0 W.
  const hasCoil = ctx.values(ctx.resolve(entry.item), "controlVoltage").length > 0;
  if ((whole || ctx.of(entry, "powerLossPerPole", "W")) && hasCoil && !coil)
    return { missing: `${entry.tag} coil loss` };
  if (whole) return { loss: whole.value + (coil?.value ?? 0) };
  const perPole = ctx.of(entry, "powerLossPerPole", "W");
  if (perPole) {
    const count = poles(ctx, entry);
    if (count === null) return { missing: `${entry.tag} pole count` };
    return { loss: perPole.value * count + (coil?.value ?? 0) };
  }
  if (entry.supply !== undefined) {
    const used = ctx.of(entry, "powerConsumption", "W");
    if (used) return { loss: used.value };
    const current = ctx.of(entry, "current", "A");
    const voltage = ctx.equipment.get(entry.supply);
    const volts = voltage ? ctx.of(voltage, "outputVoltage", "V") : null;
    if (current && volts) return { loss: current.value * volts.value };
  }
  return { missing: `${entry.tag} power loss` };
}

interface ScenarioHeat {
  dissipation: number | null;
  internal: number | null;
}

function supplyOutput(ctx: PanelContext, supply: PanelEquipment, scenario: Panel["scenarios"][number]) {
  const consumers = ctx.panel.equipment.filter(
    (entry) => entry.supply === supply.tag && activeIn(ctx.panel, scenario, entry.tag),
  );
  const voltage = ctx.of(supply, "outputVoltage", "V");
  let power = 0;
  const missing: string[] = [];
  for (const consumer of consumers) {
    // A stated consumption, else a stated current at the supply's output voltage.
    const used = ctx.of(consumer, "powerConsumption", "W");
    const current = used ? null : ctx.of(consumer, "current", "A");
    if (used) power += used.value;
    else if (current && voltage) power += current.value * voltage.value;
    else missing.push(consumer.tag);
  }
  return { consumers, voltage: voltage?.value ?? null, power: missing.length ? null : power, missing };
}

function heat(ctx: PanelContext): Map<string, ScenarioHeat> {
  const { panel } = ctx;
  const out = new Map<string, ScenarioHeat>();
  const supplies = new Set(panel.equipment.flatMap((entry) => (entry.supply ? [entry.supply] : [])));
  const enclosure = ctx.resolve(panel.enclosure.item);
  const dims = ["height", "width", "depth"].map((name) =>
    ctx.pick("enclosure", panel.enclosure.item, undefined, undefined, name, "m"),
  );
  const thermal = panel.thermal;
  let surface: number | null = null;
  if (enclosure && dims.every(Boolean)) {
    const [h, w, d] = dims.map((picked) => (picked as Picked).value) as [number, number, number];
    surface = effectiveSurface(panel.enclosure.installation, h, w, d);
  }
  ctx.value("effectiveSurface", surface, "m²");
  const k = thermal?.heatTransferCoefficient.value ?? null;
  const ambient =
    thermal && thermal.ambientTemperatureMax.value !== null
      ? inUnit(thermal.ambientTemperatureMax.value, thermal.ambientTemperatureMax.unit, "°C")
      : null;
  let airflow: number | null = 0;
  if (thermal?.fan) {
    const fan = ctx.pick("fan", thermal.fan, undefined, undefined, "airflow", "m³/h");
    airflow = fan ? fan.value : null;
  }
  const wiring = thermal?.wiringLoss;
  if (!thermal) {
    ctx.add({
      id: "thermal",
      title: "Enclosure air temperature",
      verdict: "not-evaluated",
      note: "The panel declares no thermal conditions (ambient, heat-transfer coefficient, installation).",
    });
  } else {
    ctx.limits.push(
      "Enclosure heat balance (Schneider Electric enclosure catalogue, Thermal management system pp. 8/110-8/111, surfaces after IEC 890): the result is the mean air temperature; the air at the top is warmer and is not evaluated; no solar radiation; air properties at sea level (3.1 m³·K/(W·h)); device losses at their stated rating, not scaled to the load.",
    );
    if (!wiring)
      ctx.limits.push(
        "Internal wiring and terminal losses are not included: the panel declares no wiring loss.",
      );
  }
  const lossValues = new Map<string, number>();
  for (const scenario of panel.scenarios) {
    const missing: string[] = [];
    let total = 0;
    for (const entry of panel.equipment) {
      if (entry.location === "field" || !activeIn(panel, scenario, entry.tag)) continue;
      if (supplies.has(entry.tag)) {
        const output = supplyOutput(ctx, entry, scenario);
        const efficiency = ctx.of(entry, "efficiency", "1", true);
        if (output.power === null) missing.push(`${entry.tag} output (${list(output.missing)})`);
        else if (efficiency && efficiency.value > 0 && efficiency.value <= 1)
          total += output.power * (1 / efficiency.value - 1);
        else {
          const stated = ctx.of(entry, "powerLoss", "W");
          if (stated) total += stated.value;
          else missing.push(`${entry.tag} efficiency or power loss`);
        }
        continue;
      }
      const loss = entryLoss(ctx, entry);
      if ("missing" in loss) missing.push(loss.missing);
      else {
        total += loss.loss;
        lossValues.set(entry.tag, loss.loss);
      }
    }
    if (wiring) {
      if (wiring.value === null) missing.push("declared wiring loss");
      else {
        total += inUnit(wiring.value, wiring.unit, "W");
      }
    }
    const dissipation = missing.length ? null : total;
    ctx.value(`dissipation:${scenario.tag}`, dissipation, "W");
    ctx.add({
      id: `dissipation:${scenario.tag}`,
      title: `Dissipation, ${scenario.title}`,
      verdict: dissipation === null ? "unknown" : "pass",
      ...(dissipation !== null ? { measured: { value: sig(dissipation), unit: "W" } } : {}),
      note:
        dissipation === null
          ? `Not established: ${list(missing)}; an unknown loss is never counted as 0 W.`
          : `Sum of the stated losses of the active equipment inside the enclosure${wiring ? " and the declared wiring loss" : ""}.`,
    });
    let internal: number | null = null;
    if (thermal) {
      const computed =
        dissipation !== null && k !== null && k > 0 && surface !== null && airflow !== null
          ? temperatureRise(
              dissipation,
              inUnit(k, thermal.heatTransferCoefficient.unit, "W/(m²·K)"),
              surface,
              airflow,
            )
          : null;
      const rise = computed !== null && Number.isFinite(computed) ? computed : null;
      internal = rise !== null && ambient !== null ? ambient + rise : null;
      ctx.value(`temperatureRise:${scenario.tag}`, rise, "K");
      ctx.value(`internalTemperature:${scenario.tag}`, internal, "°C");
      const limits: { tag: string; value: number }[] = [];
      const unknownLimits: string[] = [];
      if (thermal.internalTemperatureMax?.value != null)
        limits.push({
          tag: "declared internal maximum",
          value: inUnit(thermal.internalTemperatureMax.value, thermal.internalTemperatureMax.unit, "°C"),
        });
      for (const entry of panel.equipment) {
        if (entry.location === "field" || !activeIn(panel, scenario, entry.tag)) continue;
        const max = ctx.of(entry, "ambientTemperatureMax", "°C");
        if (max) limits.push({ tag: entry.tag, value: max.value });
        else unknownLimits.push(entry.tag);
      }
      for (const strip of panel.strips) {
        if (!activeIn(panel, scenario, strip.tag)) continue;
        const max = ctx.pick(strip.tag, strip.item, undefined, undefined, "ambientTemperatureMax", "°C");
        if (max) limits.push({ tag: strip.tag, value: max.value });
        else unknownLimits.push(strip.tag);
      }
      const lowest = limits.length ? limits.reduce((a, b) => (b.value < a.value ? b : a)) : null;
      const missingInputs = [
        dissipation === null ? "dissipation" : "",
        k === null ? "heat-transfer coefficient" : "",
        surface === null ? "enclosure height, width and depth" : "",
        airflow === null ? "fan airflow" : "",
        ambient === null ? "ambient temperature" : "",
      ].filter(Boolean);
      const verdict: Verdict =
        internal === null
          ? "unknown"
          : lowest && internal > lowest.value + 1e-9
            ? "fail"
            : unknownLimits.length || !lowest
              ? "unknown"
              : "pass";
      const fanNote =
        airflow && rise !== null && rise < 5
          ? " The fan case of the method assumes an internal temperature at least 5 K above the ambient."
          : "";
      ctx.add({
        id: `thermal:${scenario.tag}`,
        title: `Enclosure air temperature, ${scenario.title}`,
        verdict,
        ...(internal !== null ? { measured: { value: sig(internal), unit: "°C" } } : {}),
        ...(lowest ? { limit: { value: sig(lowest.value), unit: "°C" } } : {}),
        note:
          internal === null
            ? `Not established: ${missingInputs.join(", ")}.`
            : `Ti = ${sig(ambient as number)} °C + ${sig(dissipation as number)} W / (${k} W/(m²·K) x ${sig(surface as number)} m²${airflow ? ` + ${airflow} m³/h / ${AIR_FACTOR}` : ""}) = ${sig(internal)} °C against ${lowest ? `${sig(lowest.value)} °C (${lowest.tag})` : "no stated limit"}${unknownLimits.length ? `; no stated maximum ambient for ${list(unknownLimits)}` : ""}.${fanNote}`,
      });
    }
    out.set(scenario.tag, { dissipation, internal });
  }
  for (const [tag, loss] of lossValues) ctx.value(`loss:${tag}`, loss, "W");
  return out;
}

function budget(ctx: PanelContext, heats: Map<string, ScenarioHeat>) {
  const { panel } = ctx;
  const supplies = [...new Set(panel.equipment.flatMap((entry) => (entry.supply ? [entry.supply] : [])))];
  for (const tag of supplies) {
    const supply = ctx.equipment.get(tag) as PanelEquipment;
    const resolved = ctx.resolve(supply.item);
    for (const scenario of panel.scenarios) {
      const output = supplyOutput(ctx, supply, scenario);
      const load = output.power !== null && output.voltage ? output.power / output.voltage : null;
      const temperature = heats.get(scenario.tag)?.internal ?? null;
      // Rated output and its temperature range, then a cited derating above it.
      const wanted = Object.fromEntries(
        Object.entries(supply.conditions ?? {}).filter(([key]) => !key.startsWith("ambientTemperature")),
      );
      let available: number | null = null;
      let basis = "";
      const rated = ctx.values(resolved, "outputCurrent", wanted);
      const ratedDeclared = rated.length ? null : ctx.of(supply, "outputCurrent", "A");
      const entries = rated.length
        ? rated.map((parameter) => {
            const limit = parameter.conditions?.ambientTemperatureMax;
            return {
              current: inUnit(parameter.value as number, parameter.unit, "A"),
              upTo: limit && "unit" in limit ? inUnit(limit.value, limit.unit, "°C") : null,
            };
          })
        : ratedDeclared
          ? [{ current: ratedDeclared.value, upTo: null }]
          : [];
      if (!entries.length) basis = `${tag} has no stated output current`;
      else {
        const open = entries.find((entry) => entry.upTo === null);
        if (open) {
          available = open.current;
          basis = `${sig(open.current)} A stated without a temperature condition`;
        } else if (temperature === null) basis = "the enclosure air temperature is not established";
        else {
          const within = entries.filter((entry) => temperature <= (entry.upTo as number) + 1e-9);
          if (within.length) {
            available = Math.max(...within.map((entry) => entry.current));
            basis = `${sig(available)} A up to ${sig(Math.min(...within.map((entry) => entry.upTo as number)))} °C at ${sig(temperature)} °C`;
          } else {
            const base = entries.reduce((a, b) => ((a.upTo as number) > (b.upTo as number) ? a : b));
            const derating = ctx.values(resolved, "ambientDeratingPerKelvin", wanted).find((parameter) => {
              const low = parameter.conditions?.ambientTemperatureMin;
              const high = parameter.conditions?.ambientTemperatureMax;
              return (
                low !== undefined &&
                high !== undefined &&
                "unit" in low &&
                "unit" in high &&
                temperature >= inUnit(low.value, low.unit, "°C") - 1e-9 &&
                temperature <= inUnit(high.value, high.unit, "°C") + 1e-9
              );
            });
            if (derating) {
              const low = derating.conditions?.ambientTemperatureMin as { value: number; unit: string };
              const factor = inUnit(derating.value as number, derating.unit, "1");
              available = base.current * (1 - factor * (temperature - inUnit(low.value, low.unit, "°C")));
              basis = `${sig(base.current)} A derated by ${derating.value} ${derating.unit} per K above ${low.value} °C to ${sig(available)} A at ${sig(temperature)} °C`;
            } else
              basis = `${sig(temperature)} °C is above the stated ${sig(base.upTo as number)} °C and no cited derating covers it`;
          }
        }
      }
      const usable = available === null ? null : available * (1 - panel.reserve.supplyPercent / 100);
      ctx.value(`supplyLoad:${tag}:${scenario.tag}`, load, "A");
      ctx.value(`supplyAvailable:${tag}:${scenario.tag}`, usable, "A");
      const reasons = [
        output.missing.length ? `no stated consumption for ${list(output.missing)}` : "",
        output.voltage === null ? `${tag} has no stated output voltage` : "",
        available === null ? basis : "",
      ].filter(Boolean);
      ctx.add({
        id: `supply:${tag}:${scenario.tag}`,
        title: `24 V supply ${tag}, ${scenario.title}`,
        verdict: load === null || usable === null ? "unknown" : load <= usable + 1e-9 ? "pass" : "fail",
        ...(load !== null ? { measured: { value: sig(load), unit: "A" } } : {}),
        ...(usable !== null ? { limit: { value: sig(usable), unit: "A" } } : {}),
        note: reasons.length
          ? `Not established: ${reasons.join("; ")}.`
          : `${output.consumers.length} active consumers (${list(output.consumers.map((entry) => entry.tag))}) take ${sig(load as number)} A; available ${basis}, less the declared ${panel.reserve.supplyPercent} % reserve.`,
      });
    }
  }
}

// ---- short-circuit, busbars, verification -----------------------------------------------------------------------------

function shortCircuit(ctx: PanelContext) {
  const { panel, input } = ctx;
  const rating = panel.assembly.shortCircuitRating;
  if (!rating)
    ctx.add({
      id: "short-circuit-withstand",
      title: "Short-circuit withstand of the assembly",
      subject: panel.board,
      verdict: "not-evaluated",
      note: "Needs the assembly's rated short-circuit current from its design verification (system and assembly data); it does not follow from the list of individual devices.",
    });
  else {
    const ik = input.network?.intermediate.find(
      (entry) => entry.name === "ik3Max" && entry.subject === panel.board,
    );
    const ikA = ik && ik.value !== null ? inUnit(ik.value, ik.unit, "kA") : null;
    const ratingKa = rating.value === null ? null : inUnit(rating.value, rating.unit, "kA");
    ctx.add({
      id: "short-circuit-withstand",
      title: "Short-circuit withstand of the assembly",
      subject: panel.board,
      verdict: ikA === null || ratingKa === null ? "unknown" : ratingKa + 1e-9 >= ikA ? "pass" : "fail",
      ...(ikA !== null ? { measured: { value: sig(ikA), unit: "kA" } } : {}),
      ...(ratingKa !== null ? { limit: { value: sig(ratingKa), unit: "kA" } } : {}),
      note:
        ikA === null
          ? `No current network result gives Ik3max at ${ctx.ref(panel.board)}.`
          : ratingKa === null
            ? "The declared rating is unknown."
            : `Declared assembly rating ${sig(ratingKa)} kA (not verified by VERA) against Ik3max ${sig(ikA)} kA at ${ctx.ref(panel.board)} from ${input.network?.runId}.`,
    });
  }
  ctx.add({
    id: "busbars",
    title: "Busbars",
    subject: panel.board,
    verdict: "not-evaluated",
    note: "Busbar sizing, temperature rise and short-circuit strength need the assembly design data and a suitable method; VERA does not evaluate them.",
  });
}

function verification(ctx: PanelContext): PanelResult["verification"] {
  const ids = (prefix: string) =>
    ctx.criteria
      .filter((entry) => entry.id === prefix || entry.id.startsWith(`${prefix}:`))
      .map((entry) => entry.id);
  const thermal = ids("thermal").filter((id) => id !== "thermal");
  const sc = ctx.criteria.find((entry) => entry.id === "short-circuit-withstand");
  return verificationCharacteristics.map((characteristic) => {
    switch (characteristic) {
      case "incorporation of switching devices and components":
        return {
          characteristic,
          method:
            "Catalog data of each device (dimensions, depth, mounting accessories listed by the host's item), 2D placement on rails, zones and documented segregation rules.",
          evidence: ["bom-items", "layout", ...ids("accessory"), ...ids("segregation")].slice(0, 32),
          state: "partial" as const,
        };
      case "terminals for external conductors":
        return {
          characteristic,
          method: "Terminal counts against the motor assemblies and the schematic, declared spare.",
          evidence: [...ids("terminals"), ...ids("terminal-spare")].slice(0, 32),
          state: ids("terminals").length ? ("partial" as const) : ("not-covered" as const),
        };
      case "temperature-rise limits":
        return {
          characteristic,
          method: thermal.length
            ? "Enclosure heat balance of the mean air temperature against the devices' stated maximum ambient; not a temperature-rise verification of the assembly."
            : "Not evaluated: no thermal conditions declared.",
          evidence: [...ids("dissipation"), ...thermal].slice(0, 32),
          state: thermal.length ? ("partial" as const) : ("not-covered" as const),
        };
      case "short-circuit withstand strength":
        return {
          characteristic,
          method:
            sc && sc.verdict !== "not-evaluated"
              ? "Declared assembly rating against the prospective fault current at the board; the rating itself is not verified."
              : "Not evaluated: needs the assembly's rated short-circuit current.",
          evidence: ["short-circuit-withstand", "busbars"],
          state: sc && sc.verdict !== "not-evaluated" ? ("partial" as const) : ("not-covered" as const),
        };
      default:
        return {
          characteristic,
          method: "Not evaluated by VERA.",
          evidence: [],
          state: "not-covered" as const,
        };
    }
  });
}

// ---- the check ------------------------------------------------------------------------------------------------------

/** Runs every section of the check and returns one preliminary electrical result. */
export function analyzePanel(input: PanelInput): ElectricalResult {
  const { panel, model } = input;
  const ctx = new PanelContext(input, panel);
  const scope = boardScope(model, panel.board);
  const fingerprints = panelFingerprints(panel, input.catalogs, model);
  const lines = bom(ctx, fingerprints.tags);
  reconcile(ctx, scope);
  accessories(ctx);
  terminals(ctx);
  const layout = placement(ctx);
  const heats = heat(ctx);
  budget(ctx, heats);
  shortCircuit(ctx);
  const verificationReport = verification(ctx);
  ctx.limits.push(
    NO_CONFORMITY,
    "Layout in 2D on the mounting plate only: no 3D arrangement, door cut-outs or machining data.",
  );
  // Inputs: the board, its circuits and fed objects, contained, excluded, mapped and motor objects, their relations.
  const entities = modelEntities(model);
  const wanted = [
    panel.board,
    ...scope.circuits,
    ...scope.fed,
    ...scope.contained,
    ...panel.excluded.map((entry) => entry.object),
    ...panel.equipment.flatMap((entry) =>
      [entry.model, entry.motor].filter((id): id is string => id !== undefined),
    ),
    ...scope.relations,
  ];
  const inputs = [...new Set(wanted)]
    .filter((id) => entities.has(id))
    .slice(0, 1000)
    .map((id) => ({ id, snapshot: JSON.parse(JSON.stringify(entities.get(id))) }));
  let status: ElectricalResult["status"] = "completed";
  if (ctx.criteria.length > 200) {
    // Passing criteria go first, from the end, so failures and open checks stay in the result.
    const over = ctx.criteria.length - 200;
    let dropped = 0;
    for (let at = ctx.criteria.length - 1; at >= 0 && dropped < over; at -= 1)
      if (ctx.criteria[at]?.verdict === "pass") {
        ctx.criteria.splice(at, 1);
        dropped += 1;
      }
    if (ctx.criteria.length > 200) ctx.criteria.length = 200;
    ctx.messages.unshift(
      `${over} criteria were left out (limit 200, passing ones first); check a smaller panel.`,
    );
    status = "incomplete";
  }
  if (ctx.intermediate.length > 200) {
    ctx.messages.unshift(
      `${ctx.intermediate.length - 200} intermediate values were left out (limit 200); check a smaller panel.`,
    );
    ctx.intermediate.length = 200;
    status = "incomplete";
  }
  const kept = new Set(ctx.criteria.map((entry) => entry.id));
  const report = verificationReport.map((entry) => ({
    ...entry,
    evidence: entry.evidence.filter((id) => kept.has(id)),
  }));
  if (ctx.criteria.some((entry) => entry.verdict === "unknown" || entry.verdict === "not-evaluated"))
    status = "incomplete";
  const thermal = panel.thermal;
  const conditions: Record<string, ElectricalCondition> = {
    panel: { text: panel.id },
    motorDrivesRun: { text: input.motorDrives.runId },
    installation: { text: panel.enclosure.installation },
    mountingDepth: { value: panel.enclosure.mountingDepth, unit: "mm" },
  };
  if (thermal?.ambientTemperatureMax.value != null)
    conditions.ambientTemperatureMax = {
      value: thermal.ambientTemperatureMax.value,
      unit: thermal.ambientTemperatureMax.unit,
    };
  if (thermal?.heatTransferCoefficient.value != null)
    conditions.heatTransferCoefficient = {
      value: thermal.heatTransferCoefficient.value,
      unit: thermal.heatTransferCoefficient.unit,
    };
  if (thermal) conditions.ventilation = { text: thermal.fan ? `fan ${thermal.fan.item}` : "none" };
  if (input.network) conditions.networkRun = { text: input.network.runId };
  const sources = [
    `panel:${input.panelPath}@sha256:${input.panelSha256}`,
    ...[...input.catalogs.values()].map((entry) => `catalog:${entry.stamp.id}@sha256:${entry.stamp.sha256}`),
    ...input.schematics.map((schematic) => `qet:${schematic.path}@sha256:${schematic.sha256}`.slice(0, 200)),
    `motor-drives:${input.motorDrives.runId}`,
    ...panel.sources.map((source) => `${source.id}: ${source.title}`.slice(0, 200)),
  ].slice(0, 200);
  return {
    kind: "vera-electrical-result",
    format: 1,
    runId: input.runId,
    producer: { plugin: "panel-engineering", operation: "panel", engine: { ...panelEngine } },
    method: {
      id: "panel-engineering",
      title:
        "Panel engineering: BOM, terminals, 24 V supply, 2D layout, dissipation and enclosure heat balance",
      reference:
        "Enclosure heat balance after the Schneider Electric enclosure catalogue, Thermal management system, pp. 8/110-8/111 (IEC 890 surfaces)",
    },
    status,
    preliminary: true,
    startedAt: input.now,
    finishedAt: input.now,
    model: { path: input.modelPath, sha256: input.modelSha256 },
    catalog: null,
    inputs: inputs.length ? inputs : [{ id: panel.board, snapshot: null }],
    assumptions: [
      "Device losses are taken at their stated rating (rated current), not scaled to the operating current: an upper bound for devices running below their rating.",
      "Devices are centred on their rail; an accessory mounted below or beside its host adds its whole height or width to the host's footprint.",
      ...ctx.assumptions,
    ].slice(0, 200),
    sources,
    conditions,
    intermediate: ctx.intermediate,
    criteria: ctx.criteria,
    limits: ctx.limits.slice(0, 200),
    messages: ctx.messages.slice(0, 200),
    panel: {
      id: panel.id,
      path: input.panelPath,
      board: panel.board,
      frame: fingerprints.frame,
      plate: layout.plate,
      bom: lines,
      rails: layout.rails,
      zones: panel.zones.map((zone) => ({
        tag: zone.tag,
        x: zone.x,
        y: zone.y,
        width: zone.width,
        height: zone.height,
      })),
      ducts: panel.ducts.map((duct) => ({
        tag: duct.tag,
        x: duct.x,
        y: duct.y,
        width: duct.width,
        height: duct.height,
      })),
      placements: layout.placements,
      verification: report,
    },
  };
}

// ---- draft, impact, exports -----------------------------------------------------------------------------------------

/** Equipment entries for the assemblies of a motor_drives result, with the accessories their items list. */
export function draftEquipment(
  motorDrives: ElectricalResult,
  model: ElectricalModel,
  catalog: IndustrialCatalog | null,
  motors?: readonly string[],
) {
  const refs = new Map(model.objects.flatMap((object) => (object.ref ? [[object.id, object.ref]] : [])));
  const assemblies = (motorDrives.assemblies ?? []).filter(
    (entry) => !motors || motors.includes(entry.motor),
  );
  const several = (motorDrives.assemblies ?? []).length > 1;
  return assemblies.flatMap((assembly) => {
    const motorRef = refs.get(assembly.motor) ?? assembly.motor;
    return assembly.devices.map((device) => {
      const item = device.item ? catalog?.items.find((entry) => entry.id === device.item) : undefined;
      const tag = (several ? `${device.tag}-${motorRef}` : device.tag)
        .replace(/[^A-Za-z0-9.+-]/g, "-")
        .slice(0, 32);
      return {
        tag,
        item: device.item && catalog ? { catalog: catalog.id, item: device.item } : null,
        role: device.role,
        class: "power",
        location: "plate" as const,
        motor: assembly.motor,
        schematicTag: device.tag,
        accessoryHints: (item?.accessories ?? []).map((accessory) => ({
          item: accessory.item,
          orderCode: catalog?.items.find((entry) => entry.id === accessory.item)?.orderCode ?? null,
          role: accessory.role,
          ...(accessory.note ? { note: accessory.note } : {}),
        })),
      };
    });
  });
}

/** What a stored panel result has to redo after the panel, its catalogs or the model changed. */
export function panelImpact(
  result: ElectricalResult,
  current: { panel: Panel; catalogs: ReadonlyMap<string, PanelCatalog>; model: ElectricalModel },
) {
  const stored = result.panel as PanelResult;
  const now = panelFingerprints(current.panel, current.catalogs, current.model);
  const before = new Map(stored.bom.map((line) => [line.tag, line]));
  const changed: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of stored.bom) {
    const sha = now.tags.get(line.tag);
    if (sha === undefined) removed.push(line.tag);
    else if (sha !== line.sha256) changed.push(line.tag);
  }
  for (const tag of now.tags.keys()) if (!before.has(tag)) added.push(tag);
  const frameChanged = now.frame !== stored.frame;
  const touched = [...changed, ...removed, ...added];
  const entryNow = new Map<
    string,
    {
      mountedOn?: string | undefined;
      supply?: string | undefined;
      rail?: string | undefined;
      location: string;
    }
  >([
    ...current.panel.equipment.map((entry) => [entry.tag, entry] as const),
    ...current.panel.strips.map((strip) => [strip.tag, { rail: strip.rail, location: "plate" }] as const),
  ]);
  // A changed accessory changes its host's footprint and a changed host its accessories' fit.
  const related = new Set(touched);
  for (const tag of touched) {
    const host = before.get(tag)?.mountedOn ?? entryNow.get(tag)?.mountedOn;
    if (host) related.add(host);
    for (const line of stored.bom) if (line.mountedOn === tag) related.add(line.tag);
  }
  const placements = new Map(stored.placements.map((entry) => [entry.tag, entry]));
  const rails = new Set<string>();
  let wholeLayout = frameChanged;
  for (const tag of related) {
    const location = before.get(tag)?.location ?? entryNow.get(tag)?.location;
    if (location && location !== "plate") continue;
    const rail = placements.get(tag)?.rail ?? null;
    const railNow = entryNow.get(tag)?.rail;
    if (rail) rails.add(rail);
    if (railNow) rails.add(railNow);
    // An entry placed automatically may land on another rail once it changes.
    const mounted = entryNow.get(tag)?.mountedOn !== undefined;
    if (!mounted && entryNow.has(tag) && !railNow) wholeLayout = true;
    if (!rail && !railNow) wholeLayout = true;
  }
  const scenariosNow = new Map(
    current.panel.scenarios.map((scenario) => [
      scenario.tag,
      scenario.active ? new Set(scenario.active) : null,
    ]),
  );
  const activeTags = (tag: string) => {
    const old = before.get(tag)?.scenarios ?? [];
    const fresh = [...scenariosNow.entries()]
      .filter(([, active]) => !active || active.has(tag))
      .map(([name]) => name);
    return [...new Set([...old, ...(entryNow.has(tag) ? fresh : [])])];
  };
  const allScenarios = [
    ...new Set([...scenariosNow.keys(), ...stored.bom.flatMap((line) => line.scenarios)]),
  ];
  const supplyTags = new Set([
    ...stored.bom.flatMap((line) => (line.supply ? [line.supply] : [])),
    ...current.panel.equipment.flatMap((entry) => (entry.supply ? [entry.supply] : [])),
  ]);
  const supplies = new Map<string, Set<string>>();
  const dissipation = new Set<string>();
  const thermal = new Set<string>();
  const mark = (supply: string, scenarios: readonly string[]) => {
    const set = supplies.get(supply) ?? new Set<string>();
    for (const scenario of scenarios) set.add(scenario);
    supplies.set(supply, set);
  };
  for (const tag of touched) {
    const line = before.get(tag);
    const entry = entryNow.get(tag);
    // A supply's budget runs in every scenario; a consumer's only where it is active.
    if (supplyTags.has(tag)) mark(tag, allScenarios);
    for (const supply of [line?.supply, entry?.supply].filter((value): value is string => !!value))
      mark(supply, activeTags(tag));
    const location = line?.location ?? entry?.location;
    if (location === "field") continue;
    const strip =
      (line?.kind ??
        (current.panel.strips.some((candidate) => candidate.tag === tag) ? "strip" : "equipment")) ===
      "strip";
    for (const scenario of activeTags(tag)) {
      if (!strip) dissipation.add(scenario);
      // A strip's maximum ambient is one of the thermal limits.
      thermal.add(scenario);
    }
  }
  if (frameChanged) {
    for (const scenario of allScenarios) {
      dissipation.add(scenario);
      thermal.add(scenario);
    }
    for (const supply of supplyTags) mark(supply, allScenarios);
  }
  // Every 24 V budget reads the enclosure air temperature of its scenario.
  for (const supply of supplyTags) if (thermal.size) mark(supply, [...thermal]);
  const affectedRails = wholeLayout ? stored.rails.map((rail) => rail.tag) : [...rails].sort();
  const strips = touched.some(
    (tag) =>
      (before.get(tag)?.kind ??
        (current.panel.strips.some((strip) => strip.tag === tag) ? "strip" : "equipment")) === "strip",
  );
  const verificationAffected = [
    ...(touched.length || frameChanged ? ["incorporation of switching devices and components"] : []),
    ...(strips || frameChanged ? ["terminals for external conductors"] : []),
    ...(thermal.size ? ["temperature-rise limits"] : []),
  ];
  return {
    changed,
    added,
    removed,
    frameChanged,
    affected: {
      bom: touched,
      layout: affectedRails,
      wholeLayout,
      supplies: [...supplies.entries()].map(([supply, scenarios]) => ({
        supply,
        scenarios: [...scenarios].sort(),
      })),
      dissipation: [...dissipation].sort(),
      thermal: current.panel.thermal || frameChanged ? [...thermal].sort() : [],
      verification: verificationAffected,
    },
  };
}

export const csvField = (value: string | number | null) => {
  const raw = value === null ? "" : String(value);
  // A cell starting with = + - @ would run as a formula in a spreadsheet.
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
/** The BOM of a stored panel result as CSV, one line per equipment and strip. */
export function panelBomCsv(result: ElectricalResult): string {
  const panel = result.panel as PanelResult;
  const header = [
    "tag",
    "kind",
    "role",
    "location",
    "quantity",
    "manufacturer",
    "orderCode",
    "name",
    "catalog",
    "item",
    "motor",
    "mountedOn",
    "supply",
  ];
  const rows = panel.bom.map((line) =>
    [
      line.tag,
      line.kind,
      line.role,
      line.location,
      line.quantity,
      line.manufacturer,
      line.orderCode,
      line.name,
      line.catalog,
      line.item,
      line.motor,
      line.mountedOn,
      line.supply,
    ]
      .map(csvField)
      .join(","),
  );
  return `${[header.join(","), ...rows].join("\r\n")}\r\n`;
}

const xml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The 2D layout of a stored panel result as SVG in millimetres. */
export function panelLayoutSvg(result: ElectricalResult): string {
  const panel = result.panel as PanelResult;
  const width = panel.plate?.width ?? Math.max(100, ...panel.rails.map((rail) => rail.x + rail.length));
  const height = panel.plate?.height ?? Math.max(100, ...panel.rails.map((rail) => rail.y + 50));
  const unplaced = panel.placements.filter((entry) => entry.state === "unplaced").map((entry) => entry.tag);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height + (unplaced.length ? 12 : 0)}mm" viewBox="0 0 ${width} ${height + (unplaced.length ? 12 : 0)}">`,
    `  <title>${xml(`Panel ${panel.id} - run ${result.runId}`)}</title>`,
    `  <rect x="0" y="0" width="${width}" height="${height}" fill="#f4f4f4" stroke="#333" stroke-width="0.8"/>`,
    ...panel.zones.map(
      (zone) =>
        `  <rect x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" fill="none" stroke="#2a7" stroke-dasharray="4 2" stroke-width="0.5"><title>${xml(zone.tag)}</title></rect>`,
    ),
    ...panel.ducts.map(
      (duct) =>
        `  <rect x="${duct.x}" y="${duct.y}" width="${duct.width}" height="${duct.height}" fill="#ccc" stroke="#999" stroke-width="0.3"><title>${xml(duct.tag)}</title></rect>`,
    ),
    ...panel.rails.map(
      (rail) =>
        `  <line x1="${rail.x}" y1="${rail.y}" x2="${rail.x + rail.length}" y2="${rail.y}" stroke="#777" stroke-width="2"><title>${xml(rail.tag)}</title></line>`,
    ),
    ...panel.placements
      .filter((entry) => entry.state === "placed")
      .map(
        (entry) =>
          `  <g><rect x="${entry.x}" y="${entry.y}" width="${entry.width}" height="${entry.height}" fill="#fff" stroke="#036" stroke-width="0.5"/><text x="${(entry.x ?? 0) + 1.5}" y="${(entry.y ?? 0) + 6}" font-size="5" font-family="sans-serif">${xml(entry.tag)}</text></g>`,
      ),
    ...(unplaced.length
      ? [
          `  <text x="2" y="${height + 8}" font-size="5" font-family="sans-serif" fill="#a00">${xml(`Not placed: ${unplaced.join(", ")}`)}</text>`,
        ]
      : []),
    "</svg>",
    "",
  ];
  return lines.join("\n");
}
