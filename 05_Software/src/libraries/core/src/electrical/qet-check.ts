// Checks on a read QElectroTech project (spec REQ-DATA-963cbdf6 "Candidate validation", "Model reconciliation",
// "Tools" numbering): power connections phase by phase, interlocks as cuts of the control graph, cross-references,
// labels, conductor numbering and the device list against the electrical model. The drawing alone never proves an
// interlock: an electrical one must be an NC contact on every coil path, a mechanical one comes from motor_drives.
import type { ElectricalAssembly, ElectricalModel } from "@vera/shared";
import type { ElectricalOperation } from "./edit.js";
import { type QetElement, type QetProject, terminalIndex, terminalKey } from "./qet.js";
import { CONTROL_TAG, connectionTarget, POLE_IN, POLE_OUT, SUPPLY_TAG, TIMER_TAG } from "./qet-templates.js";

export type QetVerdict = "pass" | "fail" | "unknown" | "not-evaluated";
export interface QetCheck {
  id: string;
  title: string;
  verdict: QetVerdict;
  note: string;
}
const XREF_CODES = ["slave-unlinked", "link-not-reciprocal", "slave-label", "link-type", "report-unlinked"];
const READ_CODES = ["uuid", "uuid-duplicate", "definition-missing", "conductor-end", "link-missing"];
const list = (items: string[], max = 12) =>
  items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", ");

/** The element labelled `tag` (device head or member) that has every named terminal. */
function elementWith(project: QetProject, tag: string, names: string[]): QetElement | undefined {
  return project.elements.find(
    (element) =>
      (element.label === tag ||
        project.devices.some((d) => d.label === tag && d.members.includes(element))) &&
      names.every((name) => terminalIndex(element, name) >= 0),
  );
}
const potentialAt = (project: QetProject, element: QetElement, name: string) =>
  project.potentialOf.get(terminalKey({ element: element.uuid, terminal: terminalIndex(element, name) }));

interface Edge {
  element: QetElement;
  a: string;
  b: string;
}
/** Two-terminal contacts and buttons of the control circuit as edges between potentials; coils are not edges. */
function controlEdges(project: QetProject): Edge[] {
  const edges: Edge[] = [];
  for (const element of project.elements) {
    const definition = element.definition;
    if (definition?.terminals.length !== 2 || definition.kind.type === "coil") continue;
    if (definition.linkType !== "slave" && definition.linkType !== "simple") continue;
    const a = project.potentialOf.get(terminalKey({ element: element.uuid, terminal: 0 }));
    const b = project.potentialOf.get(terminalKey({ element: element.uuid, terminal: 1 }));
    if (a && b) edges.push({ element, a, b });
  }
  return edges;
}
function reaches(edges: Edge[], from: string, to: string, blocked: (edge: Edge) => boolean): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift() as string;
    if (at === to) return true;
    for (const edge of edges) {
      if (blocked(edge)) continue;
      const next = edge.a === at ? edge.b : edge.b === at ? edge.a : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}
const masterOf = (project: QetProject, slave: QetElement) =>
  project.devices.find((device) => device.members.includes(slave))?.head;

/**
 * The candidate checks of one assembly on a read project. `mechanical` is the motor_drives criterion of the mechanical
 * interlock (null when the assembly has none or the result holds none).
 */
export function assemblyChecks(
  project: QetProject,
  assembly: ElectricalAssembly,
  motorRef: string,
  mechanical: { verdict: QetVerdict; note?: string } | null,
): QetCheck[] {
  const checks: QetCheck[] = [];
  const add = (id: string, title: string, verdict: QetVerdict, note: string) =>
    checks.push({ id, title, verdict, note });
  const labels = new Map<string, number>();
  for (const device of project.devices)
    if (device.label) labels.set(device.label, (labels.get(device.label) ?? 0) + 1);
  const wanted = [
    ...assembly.devices.filter((d) => d.role !== "mechanical-interlock").map((d) => d.tag),
    motorRef,
  ];
  const missing = wanted.filter((tag) => labels.get(tag) !== 1);
  add(
    "assembly-devices",
    "Assembly devices drawn",
    missing.length ? "fail" : "pass",
    missing.length ? `Not exactly one device labelled ${list(missing)}.` : `${list(wanted)} each drawn once.`,
  );

  const resolve = (tag: string, names: string[]) => {
    if (tag === "supply") return elementWith(project, SUPPLY_TAG, names);
    return elementWith(project, tag === "motor" ? motorRef : tag, names);
  };
  for (const connection of assembly.connections) {
    if (connection.kind !== "power") continue;
    const target = connectionTarget(connection.to);
    const outputs = connection.from === "supply" ? ["L1", "L2", "L3"] : POLE_OUT;
    const inputs = target.terminals ?? POLE_IN;
    const from = resolve(connection.from, outputs);
    const to = resolve(target.tag, inputs);
    const id = `connection:${connection.from}/${connection.to}`;
    const title = `Power connection ${connection.from} -> ${connection.to}`;
    if (!from || !to) {
      add(
        id,
        title,
        "fail",
        `No drawn ${!from ? connection.from : target.tag} with terminals ${(!from ? outputs : inputs).join(", ")}.`,
      );
      continue;
    }
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (let phase = 0; phase < 3; phase++) {
      const a = potentialAt(project, from, outputs[phase] as string);
      const b = potentialAt(project, to, inputs[phase] as string);
      if (!a || a !== b) wrong.push(`L${phase + 1} (${outputs[phase]} -> ${inputs[phase]})`);
      else if (seen.has(a)) wrong.push(`L${phase + 1} shares a potential with another phase`);
      if (a) seen.add(a);
    }
    add(
      id,
      title,
      wrong.length ? "fail" : "pass",
      wrong.length
        ? `Not joined: ${wrong.join("; ")}.`
        : "Every phase joins its terminal on its own potential.",
    );
  }
  if (assembly.method === "star-delta") {
    const star = assembly.devices.find((d) => d.role === "star-contactor");
    const element = star && elementWith(project, star.tag, POLE_IN);
    const points = element ? POLE_IN.map((name) => potentialAt(project, element, name)) : [];
    const joined = points.length === 3 && points[0] !== undefined && points.every((p) => p === points[0]);
    add(
      "star-point",
      "Star point",
      joined ? "pass" : "fail",
      joined
        ? `${star?.tag} terminals 1, 3, 5 joined as the star point.`
        : `${star?.tag ?? "The star contactor"} terminals 1, 3, 5 are not joined into one star point.`,
    );
  }

  // Control circuit: every path from X1 L to a coil's A1 must pass the interlocking contacts.
  const edges = controlEdges(project);
  const lineL = elementWith(project, CONTROL_TAG, ["L"]);
  const lineN = elementWith(project, CONTROL_TAG, ["N"]);
  const source = lineL && potentialAt(project, lineL, "L");
  const neutral = lineN && potentialAt(project, lineN, "N");
  const coil = (tag: string) =>
    project.elements.find(
      (e) => e.label === tag && e.definition?.linkType === "master" && e.definition.kind.type === "coil",
    );
  const coilTags = assembly.devices.filter((d) => /-contactor$/.test(d.role)).map((d) => d.tag);
  const cut = (coilTag: string, blocked: (edge: Edge) => boolean): QetVerdict | string => {
    const target = coil(coilTag);
    const a1 = target && potentialAt(project, target, "A1");
    if (!source || !a1) return `${coilTag}'s coil or the control supply ${CONTROL_TAG} L is not drawn`;
    if (!reaches(edges, source, a1, () => false))
      return `${coilTag}'s coil is not supplied from ${CONTROL_TAG} L`;
    return reaches(edges, source, a1, blocked) ? "fail" : "pass";
  };
  const contactOf = (masterTag: string, state: string, type?: string) => (edge: Edge) =>
    edge.element.definition?.linkType === "slave" &&
    edge.element.definition.kind.state === state &&
    (type === undefined || edge.element.definition.kind.type === type) &&
    masterOf(project, edge.element)?.label === masterTag;
  for (const tag of coilTags) {
    const target = coil(tag);
    const a2 = target && potentialAt(project, target, "A2");
    const ok = !!(
      target &&
      neutral &&
      a2 === neutral &&
      source &&
      reaches(edges, source, potentialAt(project, target, "A1") ?? "", () => false)
    );
    add(
      `coil-supply:${tag}`,
      `Coil circuit ${tag}`,
      ok ? "pass" : "fail",
      ok
        ? `${tag} A1 is fed from ${CONTROL_TAG} L, A2 goes to N.`
        : `${tag}'s coil is not between ${CONTROL_TAG} L and N.`,
    );
  }
  const relay = assembly.devices.find((d) => d.role === "overload-relay")?.tag;
  for (const interlock of assembly.interlocks) {
    const [first, second, third] = interlock.devices;
    if (interlock.kind === "electrical" && first && first === relay) {
      const results = coilTags.map((tag) => [tag, cut(tag, contactOf(first, "NC"))] as const);
      const bad = results.filter(([, verdict]) => verdict !== "pass");
      add(
        `interlock:electrical:${first}`,
        `${first} NC in every coil circuit`,
        bad.length ? "fail" : "pass",
        bad.length
          ? `Not opened by ${first} 95-96: ${bad.map(([tag, v]) => (v === "fail" ? tag : v)).join("; ")}.`
          : `Every path to ${list(coilTags)} passes ${first}'s NC contact.`,
      );
    } else if (interlock.kind === "electrical" && first && second) {
      const one = cut(second, contactOf(first, "NC"));
      const two = coil(first) ? cut(first, contactOf(second, "NC")) : "pass";
      const bad = [
        one === "pass" ? "" : one === "fail" ? `a path to ${second} avoids ${first}'s NC` : one,
        two === "pass" ? "" : two === "fail" ? `a path to ${first} avoids ${second}'s NC` : two,
      ].filter(Boolean);
      add(
        `interlock:electrical:${first}/${second}`,
        `Electrical interlock ${first}/${second}`,
        bad.length ? "fail" : "pass",
        bad.length ? `${bad.join("; ")}.` : `Every path to each coil passes the other's NC contact.`,
      );
    } else if (interlock.kind === "sequence" && assembly.method === "star-delta" && first && third) {
      const delayed = (state: string) => (edge: Edge) => contactOf(TIMER_TAG, state, "delayOn")(edge);
      const starOpen = cut(first, delayed("NC"));
      const deltaTimed = cut(third, delayed("NO"));
      const deltaAfterStar = cut(third, contactOf(first, "NC"));
      const bad = [
        starOpen === "pass" ? "" : `${first} is not opened by ${TIMER_TAG}'s delayed NC`,
        deltaTimed === "pass" ? "" : `${third} is not closed by ${TIMER_TAG}'s delayed NO`,
        deltaAfterStar === "pass" ? "" : `${third} does not wait for ${first}'s NC`,
      ].filter(Boolean);
      add(
        "interlock:sequence",
        `Star-delta sequence ${interlock.devices.join("/")}`,
        bad.length ? "fail" : "pass",
        bad.length
          ? `${bad.join("; ")}.`
          : `${first} drops at the timer's delayed NC; ${third} closes through the delayed NO and ${first}'s NC.`,
      );
    } else if (interlock.kind === "mechanical") {
      add(
        "mechanical-interlock",
        `Mechanical interlock ${interlock.devices.join("/")}`,
        mechanical?.verdict ?? "not-evaluated",
        `From the motor_drives result, not from the drawing: ${mechanical?.note ?? "no stored mechanical-interlock criterion"}`,
      );
    }
  }
  const xref = project.problems.filter((p) => XREF_CODES.includes(p.code));
  add(
    "contact-links",
    "Contacts linked to their coils",
    xref.length ? "fail" : "pass",
    xref.length
      ? list(
          xref.map((p) => p.message),
          5,
        )
      : "Every contact is linked to its coil and back.",
  );
  return checks;
}

export interface QetReconcile {
  matched: {
    ref: string;
    object: string;
    type: string;
    qetUuid: string;
    identity: "recorded" | "unrecorded" | "differs";
  }[];
  qetOnly: { ref: string; qetUuid: string; name: string }[];
  modelOnly: { ref: string; object: string }[];
  problems: string[];
  operations: ElectricalOperation[];
}
/** Matches device labels to model references; proposes the operations, never applies them. */
export function reconcile(project: QetProject, model: ElectricalModel | null, path: string): QetReconcile {
  const out: QetReconcile = { matched: [], qetOnly: [], modelOnly: [], problems: [], operations: [] };
  const byRef = new Map((model?.objects ?? []).filter((o) => o.ref).map((o) => [o.ref as string, o]));
  const labels = new Set<string>();
  for (const device of project.devices) {
    const ref = device.label;
    if (ref === null || labels.has(ref)) continue;
    labels.add(ref);
    if (ref.length > 64) {
      out.problems.push(`The label ${ref.slice(0, 20)}... is longer than a model reference (64).`);
      continue;
    }
    const qetUuid = device.head.uuid;
    const object = byRef.get(ref);
    if (!object) {
      out.qetOnly.push({ ref, qetUuid, name: device.head.definition?.name ?? ref });
      out.operations.push({
        op: "add-object",
        object: {
          type: "device",
          ref,
          name: (device.head.definition?.name ?? ref).slice(0, 200),
          attributes: { qetUuid, qetProject: path },
        },
      });
      continue;
    }
    const recorded = object.attributes?.qetUuid;
    const identity = recorded === undefined ? "unrecorded" : recorded === qetUuid ? "recorded" : "differs";
    out.matched.push({ ref, object: object.id, type: object.type, qetUuid, identity });
    if (identity === "differs")
      out.problems.push(
        `${ref}: the model records QET element ${String(recorded)}, the project has ${qetUuid}.`,
      );
    if (identity === "unrecorded" || object.attributes?.qetProject !== path)
      out.operations.push({ op: "update-object", id: object.id, attributes: { qetUuid, qetProject: path } });
  }
  for (const object of model?.objects ?? [])
    if (object.attributes?.qetProject === path && object.ref && !labels.has(object.ref))
      out.modelOnly.push({ ref: object.ref, object: object.id });
  return out;
}

/** Numbering, cross-reference, read and device-list checks of a whole project. */
export function projectChecks(
  project: QetProject,
  model: ElectricalModel | null,
  path: string,
): { checks: QetCheck[]; reconciled: QetReconcile } {
  const checks: QetCheck[] = [];
  const add = (id: string, title: string, verdict: QetVerdict, note: string) =>
    checks.push({ id, title, verdict, note });
  const read = project.problems.filter((p) => READ_CODES.includes(p.code));
  add(
    "project-read",
    "Project read completely",
    read.length ? "fail" : "pass",
    read.length
      ? list(
          read.map((p) => p.message),
          5,
        )
      : `${project.folios.length} folios, ${project.elements.length} elements, ${project.conductors.length} conductors resolved.`,
  );
  const unlabeled = project.devices
    .filter((d) => d.label === null && d.head.definition?.linkType !== "slave")
    .map((d) => d.head.position);
  const duplicates = project.problems.filter((p) => p.code === "label-duplicate");
  add(
    "labels",
    "Device labels",
    unlabeled.length || duplicates.length ? "fail" : "pass",
    [unlabeled.length ? `Unlabelled devices at ${list(unlabeled)}.` : "", ...duplicates.map((p) => p.message)]
      .filter(Boolean)
      .join(" ") || `${project.devices.length} devices, each with its own label.`,
  );
  const numbered = project.conductors.some((c) => c.num.trim() !== "");
  const multiple = project.potentials
    .filter((p) => p.numbers.length > 1)
    .map((p) => `${p.id} (${p.numbers.join(", ")})`);
  const owner = new Map<string, string>();
  const shared: string[] = [];
  for (const potential of project.potentials)
    for (const num of potential.numbers) {
      const first = owner.get(num);
      if (first && first !== potential.id) shared.push(`${num} on ${first} and ${potential.id}`);
      else owner.set(num, potential.id);
    }
  const unnumbered = project.potentials.filter((p) => p.numbers.length === 0).length;
  add(
    "conductor-numbering",
    "Conductor numbering",
    !numbered ? "unknown" : multiple.length || shared.length ? "fail" : "pass",
    !numbered
      ? "No conductor is numbered; number them in QElectroTech (one number per potential)."
      : multiple.length || shared.length
        ? `${multiple.length ? `Potentials with several numbers: ${list(multiple)}. ` : ""}${shared.length ? `Numbers on several potentials: ${list(shared)}.` : ""}`.trim()
        : `One number per potential, distinct across potentials${unnumbered ? ` (${unnumbered} potentials without a number)` : ""}.`,
  );
  const xref = project.problems.filter((p) => XREF_CODES.includes(p.code));
  add(
    "cross-references",
    "Cross-references",
    xref.length ? "fail" : "pass",
    xref.length
      ? list(
          xref.map((p) => p.message),
          5,
        )
      : "Every slave is linked to one master, links are reciprocal and labels agree.",
  );
  const reconciled = reconcile(project, model, path);
  const differs = reconciled.matched.filter((m) => m.identity === "differs").map((m) => m.ref);
  add(
    "device-list",
    "Device list against the model",
    differs.length || reconciled.modelOnly.length
      ? "fail"
      : reconciled.qetOnly.length || reconciled.matched.some((m) => m.identity === "unrecorded")
        ? "unknown"
        : "pass",
    differs.length || reconciled.modelOnly.length
      ? `${differs.length ? `Other QET element than recorded: ${list(differs)}. ` : ""}${reconciled.modelOnly.length ? `In the model for this project but not drawn: ${list(reconciled.modelOnly.map((m) => m.ref))}.` : ""}`.trim()
      : reconciled.qetOnly.length || reconciled.matched.some((m) => m.identity === "unrecorded")
        ? `Not yet mapped: ${list([...reconciled.qetOnly.map((q) => q.ref), ...reconciled.matched.filter((m) => m.identity === "unrecorded").map((m) => m.ref)])}; apply the reconcile operations with electrical_model_change.`
        : `${reconciled.matched.length} devices match the model with their QET identity.`,
  );
  return { checks, reconciled };
}
