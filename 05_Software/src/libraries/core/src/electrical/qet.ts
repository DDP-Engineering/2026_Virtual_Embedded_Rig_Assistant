// QElectroTech project reader (spec REQ-DATA-963cbdf6 "Project mapping", "Devices and cross-references"): maps the
// strict XML tree of a .qet file to folios, embedded element definitions, elements, conductors with both ends
// resolved, potentials and devices, and reports every reference it cannot resolve as a problem instead of dropping it.
import { attr, childNamed, childrenNamed, parseStrictXml, type XmlElement } from "./xml-strict.js";

export const qetLinkTypes = [
  "simple",
  "master",
  "slave",
  "next_report",
  "previous_report",
  "terminal",
  "thumbnail",
] as const;
export type QetLinkType = (typeof qetLinkTypes)[number];
const ORIENTATIONS = ["n", "e", "s", "w"] as const;

export interface QetTerminalDefinition {
  uuid: string | null;
  name: string;
  x: number;
  y: number;
  orientation: number;
}
export interface QetDefinition {
  path: string;
  linkType: QetLinkType;
  kind: { type?: string; state?: string; number?: string };
  name: string;
  terminals: QetTerminalDefinition[];
}
export interface QetElement {
  uuid: string;
  type: string;
  folio: number;
  x: number;
  y: number;
  prefix: string;
  info: Record<string, string>;
  label: string | null;
  links: string[];
  definition: QetDefinition | null;
  position: string;
  node: XmlElement;
}
export interface QetEnd {
  element: string;
  terminal: number;
}
export interface QetConductor {
  folio: number;
  index: number;
  ends: [QetEnd | null, QetEnd | null];
  num: string;
  function: string;
  section: string;
  color: string;
  cable: string;
}
export interface QetFolio {
  index: number;
  order: number | null;
  title: string;
  folio: string;
  elements: number;
  conductors: number;
}
export interface QetProblem {
  code: string;
  message: string;
  uuids?: string[];
  folio?: number;
}
export interface QetPotential {
  id: string;
  terminals: QetEnd[];
  numbers: string[];
}
export interface QetDevice {
  label: string | null;
  /** The master, or the element itself for a simple, terminal or unlinked slave element. */
  head: QetElement;
  members: QetElement[];
}
export interface QetProject {
  version: string | null;
  title: string | null;
  properties: Record<string, string>;
  folios: QetFolio[];
  definitions: Map<string, QetDefinition>;
  elements: QetElement[];
  byUuid: Map<string, QetElement>;
  conductors: QetConductor[];
  potentials: QetPotential[];
  /** Potential ID of each connected terminal, by `terminalKey`. */
  potentialOf: Map<string, string>;
  devices: QetDevice[];
  problems: QetProblem[];
  root: XmlElement;
  source: string;
}

/** `{lower-case uuid}` as QET writes it; anything else is returned as given. */
export function normalUuid(value: string): string {
  const bare = value
    .trim()
    .replace(/^\{|\}$/g, "")
    .toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bare) ? `{${bare}}` : value;
}
export const terminalKey = (end: QetEnd) => `${end.element}#${end.terminal}`;
const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Index of a definition terminal by its name, or -1. */
export function terminalIndex(element: QetElement, name: string): number {
  return element.definition?.terminals.findIndex((terminal) => terminal.name === name) ?? -1;
}
export const elementName = (element: QetElement) =>
  `${element.label ?? element.definition?.name ?? "element"} ${element.uuid}`;

function readDefinition(path: string, node: XmlElement): QetDefinition {
  const raw = attr(node, "link_type") ?? "simple";
  const linkType = (qetLinkTypes as readonly string[]).includes(raw) ? (raw as QetLinkType) : "simple";
  const kind: QetDefinition["kind"] = {};
  for (const entry of childrenNamed(childNamed(node, "kindInformations") ?? node, "kindInformation")) {
    const key = attr(entry, "name");
    if (key === "type" || key === "state" || key === "number") kind[key] = entry.text.trim();
  }
  const names = childrenNamed(childNamed(node, "names") ?? node, "name");
  const name =
    (names.find((entry) => attr(entry, "lang") === "en") ?? names[0])?.text.trim() ||
    (path.split("/").pop() ?? path);
  const terminals: QetTerminalDefinition[] = [];
  for (const terminal of childrenNamed(childNamed(node, "description") ?? node, "terminal")) {
    const orientation = ORIENTATIONS.indexOf((attr(terminal, "orientation") ?? "n") as "n");
    const uuid = attr(terminal, "uuid");
    terminals.push({
      uuid: uuid ? normalUuid(uuid) : null,
      name: attr(terminal, "name") ?? "",
      x: number(attr(terminal, "x"), 0),
      y: number(attr(terminal, "y"), 0),
      orientation: orientation < 0 ? 0 : orientation,
    });
  }
  return { path, linkType, kind, name, terminals };
}

function collectDefinitions(category: XmlElement, prefix: string, into: Map<string, QetDefinition>) {
  for (const child of category.children) {
    const name = attr(child, "name");
    if (!name) continue;
    if (child.name === "category") collectDefinitions(child, `${prefix}${name}/`, into);
    else if (child.name === "element") {
      const definition = childNamed(child, "definition");
      if (definition)
        into.set(`embed://${prefix}${name}`, readDefinition(`embed://${prefix}${name}`, definition));
    }
  }
}

/** Reads a QElectroTech project strictly; structural problems are listed, XML problems throw. */
export function readQetProject(source: string, label: string): QetProject {
  const root = parseStrictXml(source, label);
  if (root.name !== "project")
    throw Error(
      `Invalid QElectroTech project ${label}: line ${root.line}: the root element is <${root.name}>, not <project>.`,
    );
  const problems: QetProblem[] = [];
  const problem = (entry: QetProblem) => problems.push(entry);
  const definitions = new Map<string, QetDefinition>();
  for (const collection of childrenNamed(root, "collection")) collectDefinitions(collection, "", definitions);
  const properties: Record<string, string> = {};
  for (const property of childrenNamed(childNamed(root, "properties") ?? root, "property")) {
    const key = attr(property, "name");
    if (key) properties[key] = property.text;
  }

  const folios: QetFolio[] = [];
  const elements: QetElement[] = [];
  const byUuid = new Map<string, QetElement>();
  const conductors: QetConductor[] = [];
  for (const [index, diagram] of childrenNamed(root, "diagram").entries()) {
    const colsize = number(attr(diagram, "colsize"), 60);
    const rowsize = number(attr(diagram, "rowsize"), 80);
    const order = attr(diagram, "order");
    const legacy = new Map<number, QetEnd>();
    const folioElements = childrenNamed(childNamed(diagram, "elements") ?? diagram, "element");
    for (const node of folioElements) {
      const uuid = normalUuid(attr(node, "uuid") ?? "");
      const type = attr(node, "type") ?? "";
      const x = number(attr(node, "x"), 0);
      const y = number(attr(node, "y"), 0);
      const info: Record<string, string> = {};
      for (const entry of childrenNamed(
        childNamed(node, "elementInformations") ?? node,
        "elementInformation",
      )) {
        const key = attr(entry, "name");
        if (key) info[key] = entry.text;
      }
      const definition = definitions.get(type) ?? null;
      const column = Math.floor(x / colsize) + 1;
      const row = String.fromCharCode(65 + Math.max(0, Math.min(25, Math.floor(y / rowsize))));
      const element: QetElement = {
        uuid,
        type,
        folio: index,
        x,
        y,
        prefix: attr(node, "prefix") ?? "",
        info,
        label: info.label?.trim() || null,
        links: childrenNamed(childNamed(node, "links_uuids") ?? node, "link_uuid").map((link) =>
          normalUuid(attr(link, "uuid") ?? ""),
        ),
        definition,
        position: `${index + 1}-${row}${column}`,
        node,
      };
      if (!uuid.startsWith("{"))
        problem({
          code: "uuid",
          message: `An element on folio ${index + 1} has no valid uuid.`,
          folio: index,
        });
      else if (byUuid.has(uuid))
        problem({ code: "uuid-duplicate", message: `The uuid ${uuid} is used twice.`, uuids: [uuid] });
      else byUuid.set(uuid, element);
      if (!definition)
        problem({
          code: "definition-missing",
          message: `${elementName(element)} uses ${type || "no type"}, which is not embedded in the project.`,
          uuids: [uuid],
          folio: index,
        });
      else
        for (const terminal of childrenNamed(childNamed(node, "terminals") ?? node, "terminal")) {
          const id = attr(terminal, "id");
          if (id === undefined) continue;
          const tx = number(attr(terminal, "x"), Number.NaN);
          const ty = number(attr(terminal, "y"), Number.NaN);
          const to = number(attr(terminal, "orientation"), 0);
          const found = definition.terminals.findIndex(
            (entry) => near(entry.x, tx) && near(entry.y, ty) && entry.orientation === to,
          );
          if (found >= 0) legacy.set(Number(id), { element: uuid, terminal: found });
        }
      elements.push(element);
    }
    const folioConductors = childrenNamed(childNamed(diagram, "conductors") ?? diagram, "conductor");
    for (const [position, node] of folioConductors.entries()) {
      const end = (n: 1 | 2): QetEnd | null => {
        const elementUuid = attr(node, `element${n}`);
        const terminal = attr(node, `terminal${n}`) ?? "";
        if (elementUuid !== undefined) {
          const element = byUuid.get(normalUuid(elementUuid));
          if (!element || element.folio !== index) return null;
          const wanted = normalUuid(terminal);
          const found = element.definition?.terminals.findIndex((entry) => entry.uuid === wanted) ?? -1;
          return found < 0 ? null : { element: element.uuid, terminal: found };
        }
        return /^\d+$/.test(terminal) ? (legacy.get(Number(terminal)) ?? null) : null;
      };
      const conductor: QetConductor = {
        folio: index,
        index: position,
        ends: [end(1), end(2)],
        num: attr(node, "num") ?? "",
        function: attr(node, "function") ?? "",
        section: attr(node, "conductor_section") ?? "",
        color: attr(node, "conductor_color") ?? "",
        cable: attr(node, "cable") ?? "",
      };
      for (const [side, value] of conductor.ends.entries())
        if (value === null)
          problem({
            code: "conductor-end",
            message: `Conductor ${position + 1} on folio ${index + 1}: end ${side + 1} (${attr(node, `element${side + 1}`) ?? "legacy id"} ${attr(node, `terminal${side + 1}`) ?? ""}) does not resolve to a terminal.`,
            folio: index,
          });
      conductors.push(conductor);
    }
    folios.push({
      index,
      order: order === undefined ? null : number(order, index + 1),
      title: attr(diagram, "title") ?? "",
      folio: attr(diagram, "folio") ?? "",
      elements: folioElements.length,
      conductors: folioConductors.length,
    });
  }

  // Potentials: terminals joined by conductors and by linked folio report pairs.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let at = key;
    while (parent.get(at) !== at) {
      const up = parent.get(at) ?? at;
      parent.set(at, parent.get(up) ?? up);
      at = up;
    }
    return at;
  };
  const join = (a: QetEnd, b: QetEnd) => {
    for (const end of [a, b])
      if (!parent.has(terminalKey(end))) parent.set(terminalKey(end), terminalKey(end));
    const ra = find(terminalKey(a));
    const rb = find(terminalKey(b));
    if (ra !== rb) parent.set(rb, ra);
  };
  const order: string[] = [];
  const touch = (end: QetEnd) => {
    if (!parent.has(terminalKey(end))) {
      parent.set(terminalKey(end), terminalKey(end));
      order.push(terminalKey(end));
    }
  };
  for (const conductor of conductors) {
    const [a, b] = conductor.ends;
    if (a) touch(a);
    if (b) touch(b);
    if (a && b) join(a, b);
  }
  for (const element of elements) {
    const type = element.definition?.linkType;
    if (type !== "next_report" && type !== "previous_report") continue;
    const other = element.links.length === 1 ? byUuid.get(element.links[0] as string) : undefined;
    const otherType = other?.definition?.linkType;
    if (!other || (otherType !== "next_report" && otherType !== "previous_report") || otherType === type) {
      problem({
        code: "report-unlinked",
        message: `Folio report ${elementName(element)} is not linked to one opposite report.`,
        uuids: [element.uuid],
      });
      continue;
    }
    if (element.definition?.terminals.length && other.definition?.terminals.length) {
      touch({ element: element.uuid, terminal: 0 });
      touch({ element: other.uuid, terminal: 0 });
      join({ element: element.uuid, terminal: 0 }, { element: other.uuid, terminal: 0 });
    }
  }
  const groups = new Map<string, QetEnd[]>();
  for (const key of order) {
    const rootKey = find(key);
    const [element, terminal] = key.split("#") as [string, string];
    const list = groups.get(rootKey) ?? [];
    list.push({ element, terminal: Number(terminal) });
    groups.set(rootKey, list);
  }
  const potentials: QetPotential[] = [];
  const potentialOf = new Map<string, string>();
  for (const terminals of groups.values()) {
    const id = `P${potentials.length + 1}`;
    for (const end of terminals) potentialOf.set(terminalKey(end), id);
    potentials.push({ id, terminals, numbers: [] });
  }
  const byId = new Map(potentials.map((entry) => [entry.id, entry]));
  for (const conductor of conductors) {
    const end = conductor.ends[0] ?? conductor.ends[1];
    const potential = end ? byId.get(potentialOf.get(terminalKey(end)) ?? "") : undefined;
    if (potential && conductor.num.trim() && !potential.numbers.includes(conductor.num.trim()))
      potential.numbers.push(conductor.num.trim());
  }

  const devices = groupDevices(elements, byUuid, problem);
  return {
    version: attr(root, "version") ?? null,
    title: attr(root, "title") ?? null,
    properties,
    folios,
    definitions,
    elements,
    byUuid,
    conductors,
    potentials,
    potentialOf,
    devices,
    problems,
    root,
    source,
  };
}

function groupDevices(
  elements: QetElement[],
  byUuid: Map<string, QetElement>,
  problem: (entry: QetProblem) => void,
): QetDevice[] {
  const devices: QetDevice[] = [];
  const slaveOf = new Map<string, QetElement>();
  for (const element of elements) {
    const type = element.definition?.linkType;
    for (const link of element.links) {
      const other = byUuid.get(link);
      if (!other) {
        problem({
          code: "link-missing",
          message: `${elementName(element)} links to ${link}, which is not in the project.`,
          uuids: [element.uuid],
        });
        continue;
      }
      const otherType = other.definition?.linkType;
      const reports =
        (type === "next_report" || type === "previous_report") &&
        (otherType === "next_report" || otherType === "previous_report");
      if (
        !reports &&
        !((type === "master" && otherType === "slave") || (type === "slave" && otherType === "master"))
      )
        problem({
          code: "link-type",
          message: `${elementName(element)} (${type ?? "unknown"}) links to ${elementName(other)} (${otherType ?? "unknown"}).`,
          uuids: [element.uuid, other.uuid],
        });
      else if (!other.links.includes(element.uuid))
        problem({
          code: "link-not-reciprocal",
          message: `${elementName(element)} links to ${elementName(other)}, which does not link back.`,
          uuids: [element.uuid, other.uuid],
        });
      if (type === "master" && otherType === "slave") slaveOf.set(other.uuid, element);
      if (type === "slave" && otherType === "master" && !slaveOf.has(element.uuid))
        slaveOf.set(element.uuid, other);
    }
  }
  const members = new Map<string, QetElement[]>();
  for (const element of elements) {
    const type = element.definition?.linkType ?? "simple";
    if (type === "next_report" || type === "previous_report" || type === "thumbnail") continue;
    if (type === "master") members.set(element.uuid, [element, ...(members.get(element.uuid) ?? [])]);
    else if (type === "slave") {
      const master = slaveOf.get(element.uuid);
      if (!master) {
        problem({
          code: "slave-unlinked",
          message: `${elementName(element)} is a contact linked to no coil or master.`,
          uuids: [element.uuid],
        });
        devices.push({ label: element.label, head: element, members: [element] });
        continue;
      }
      if (element.label !== null && master.label !== null && element.label !== master.label)
        problem({
          code: "slave-label",
          message: `${elementName(element)} is labelled ${element.label} but belongs to ${master.label}.`,
          uuids: [element.uuid, master.uuid],
        });
      members.set(master.uuid, [...(members.get(master.uuid) ?? []), element]);
    } else devices.push({ label: element.label, head: element, members: [element] });
  }
  for (const [uuid, list] of members) {
    const head = byUuid.get(uuid) as QetElement;
    devices.push({
      label: head.label,
      head,
      members: list.sort((a, b) => (a === head ? -1 : b === head ? 1 : 0)),
    });
  }
  const seen = new Map<string, QetDevice>();
  for (const device of devices) {
    // Terminals of one strip share its label (X1); an unlinked slave is already a problem; every other device has its own.
    const type = device.head.definition?.linkType;
    if (device.label === null || type === "terminal" || type === "slave") continue;
    const first = seen.get(device.label);
    if (first)
      problem({
        code: "label-duplicate",
        message: `Two devices are labelled ${device.label} (${first.head.uuid}, ${device.head.uuid}).`,
        uuids: [first.head.uuid, device.head.uuid],
      });
    else seen.set(device.label, device);
  }
  return devices.sort((a, b) => (a.label ?? "￿").localeCompare(b.label ?? "￿", "en", { numeric: true }));
}
