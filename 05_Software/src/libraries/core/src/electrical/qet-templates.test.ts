// The three starter templates and the candidate checks (spec REQ-DATA-963cbdf6 "Templates and candidates",
// "Candidate validation"): each template passes every check on its read-back XML, and a removed conductor, a bridged
// interlock contact or a missing overload contact fails the named check. The assemblies have the shape motor_drives
// writes (motor-drives.ts); the tool test builds them through the real engine.
import { readFile, writeFile } from "node:fs/promises";
import type { ElectricalAssembly } from "@vera/shared";
import { describe, expect, it } from "vitest";
import { readQetProject } from "./qet.js";
import { assemblyChecks, projectChecks } from "./qet-check.js";
import { stableUuid, terminalUuid } from "./qet-symbols.js";
import { renderTemplate } from "./qet-templates.js";

const fixtures = new URL("../../../../../tests/fixtures/qelectrotech/", import.meta.url);
const device = (tag: string, role: string, orderCode: string | null = null) => ({
  tag,
  role,
  item: null,
  orderCode,
});
const power = (from: string, to: string) => ({ from, to, kind: "power" as const });
const relayInterlock = {
  kind: "electrical" as const,
  devices: ["F1", "KM1"],
  note: "F1 auxiliary NC opens the coil circuit.",
};
export const assemblies: Record<string, ElectricalAssembly> = {
  dol: {
    motor: "mot-p1",
    circuit: "cir-m1",
    method: "dol",
    conditional: false,
    devices: [
      device("Q1", "protection", "GV2ME10"),
      device("KM1", "line-contactor", "LC1D09P7"),
      device("F1", "overload-relay", "LRD21"),
    ],
    connections: [
      power("supply", "Q1"),
      power("Q1", "KM1"),
      power("KM1", "F1"),
      power("F1", "motor:U1,V1,W1"),
    ],
    interlocks: [relayInterlock],
  },
  reversing: {
    motor: "mot-p1",
    circuit: "cir-m1",
    method: "reversing",
    conditional: true,
    devices: [
      device("Q1", "protection", "GV2ME10"),
      device("KM1", "line-contactor", "LC1D09P7"),
      device("KM2", "reverse-contactor", "LC1D09P7"),
      device("KM1-KM2", "mechanical-interlock", "LAD9V2"),
      device("F1", "overload-relay", "LRD21"),
    ],
    connections: [
      power("supply", "Q1"),
      power("Q1", "KM1"),
      power("Q1", "KM2"),
      power("KM1", "F1"),
      power("KM2", "F1:5,3,1"),
      power("F1", "motor:U1,V1,W1"),
    ],
    interlocks: [
      {
        kind: "mechanical",
        devices: ["KM1", "KM2"],
        note: "LAD9V2 mechanical interlock between KM1 and KM2.",
      },
      {
        kind: "electrical",
        devices: ["KM1", "KM2"],
        note: "An auxiliary NC contact of each opens the other's coil circuit.",
      },
      relayInterlock,
    ],
  },
  "star-delta": {
    motor: "mot-p2",
    circuit: "cir-m2",
    method: "star-delta",
    conditional: false,
    devices: [
      device("Q1", "protection", "GV2ME14"),
      device("KM1", "line-contactor", "LC1D18P7"),
      device("KM2", "delta-contactor", "LC1D18P7"),
      device("KM3", "star-contactor", "LC1D09P7"),
      device("KM2-KM3", "mechanical-interlock", "LAD9V2"),
      device("F1", "overload-relay", "LRD21"),
    ],
    connections: [
      power("supply", "Q1"),
      power("Q1", "KM1"),
      power("KM1", "F1"),
      power("F1", "motor:U1,V1,W1"),
      power("KM1", "KM2"),
      power("KM2", "motor:W2,U2,V2"),
      power("KM3", "motor:U2,V2,W2"),
    ],
    interlocks: [
      {
        kind: "mechanical",
        devices: ["KM2", "KM3"],
        note: "LAD9V2 mechanical interlock between KM2 and KM3.",
      },
      {
        kind: "electrical",
        devices: ["KM2", "KM3"],
        note: "An auxiliary NC contact of each opens the other's coil circuit.",
      },
      { kind: "sequence", devices: ["KM3", "KM1", "KM2"], note: "KM3 opens before KM2 closes." },
      relayInterlock,
    ],
  },
};
/** Deterministic element UUIDs so the rendered candidate equals its fixture byte for byte. */
export const counter = (seed: string) => {
  let n = 0;
  return () => stableUuid(`${seed}-${n++}`);
};
export const render = (method: string, motorRef = "M1") =>
  renderTemplate({
    assembly: assemblies[method] as ElectricalAssembly,
    motorRef,
    title: `${motorRef} ${method}`,
    newUuid: counter(method),
  });
const verdicts = (
  xml: string,
  method: string,
  mechanical = { verdict: "pass" as const, note: "LAD9V2 listed." },
) =>
  Object.fromEntries(
    assemblyChecks(
      readQetProject(xml, `${method}.qet`),
      assemblies[method] as ElectricalAssembly,
      "M1",
      mechanical,
    ).map((c) => [c.id, c.verdict]),
  );
/** Removes the conductor between two element terminals (by element and terminal UUID). */
function withoutConductor(xml: string, terminalA: string, terminalB: string): string {
  const lines = xml.split("\n");
  const at = lines.findIndex(
    (line) => line.includes("<conductor ") && line.includes(terminalA) && line.includes(terminalB),
  );
  expect(at).toBeGreaterThan(0);
  lines.splice(at, 3);
  return lines.join("\n");
}
const uuidOf = (xml: string, symbolFile: string, label: string) => {
  const project = readQetProject(xml, "x.qet");
  const element = project.elements.find((e) => e.type.endsWith(symbolFile) && e.label === label);
  return element?.uuid as string;
};

describe("starter templates", () => {
  it.each(["dol", "reversing", "star-delta"])(
    "%s: the read-back candidate passes every check and equals its fixture",
    async (method) => {
      const xml = render(method);
      const project = readQetProject(xml, `${method}.qet`);
      expect(project.problems).toEqual([]);
      expect(project.folios.map((f) => f.title)).toEqual(["Power circuit", "Control circuit"]);
      const checks = verdicts(xml, method);
      for (const [id, verdict] of Object.entries(checks)) expect([id, verdict]).toEqual([id, "pass"]);
      expect(Object.keys(checks)).toEqual(
        expect.arrayContaining([
          "assembly-devices",
          "contact-links",
          "coil-supply:KM1",
          "interlock:electrical:F1",
        ]),
      );
      const file = new URL(`${method}.generated.qet`, fixtures);
      if (process.env.VERA_QET_FIXTURES_UPDATE === "1") await writeFile(file, xml, "utf8");
      expect(xml).toBe(await readFile(file, "utf8"));
    },
  );

  it("dol: devices carry the assembly's tags, the order codes and the motor's ref; contacts are linked to the coil", () => {
    const project = readQetProject(render("dol", "M7"), "dol.qet");
    expect(project.devices.map((d) => d.label)).toEqual([
      "F1",
      "KM1",
      "M7",
      "Q1",
      "S0",
      "S1",
      "X0",
      "X1",
      "X1",
    ]);
    const km1 = project.devices.find((d) => d.label === "KM1");
    expect(km1?.head.definition?.kind.type).toBe("coil");
    expect(km1?.head.info.manufacturer_reference).toBe("LC1D09P7");
    expect(km1?.members.map((m) => [m.definition?.kind.type, m.folio])).toEqual([
      ["coil", 1],
      ["power", 0],
      ["simple", 1],
    ]);
    expect(km1?.head.position).toBe("2-G2");
    expect(project.conductors.every((c) => c.num === "")).toBe(true);
  });

  it("refuses methods without a template and assemblies missing a device the template needs", () => {
    const vfd = { ...(assemblies.dol as ElectricalAssembly), method: "vfd" };
    expect(() => renderTemplate({ assembly: vfd, motorRef: "M1", title: "x" })).toThrow(
      /No QElectroTech template for the vfd method/,
    );
    const reversing = assemblies.reversing as ElectricalAssembly;
    const noReverse = {
      ...reversing,
      devices: reversing.devices.filter((d) => d.role !== "reverse-contactor"),
    };
    expect(() => renderTemplate({ assembly: noReverse, motorRef: "M1", title: "x" })).toThrow(
      /no reverse-contactor device/,
    );
  });

  it("a removed main conductor fails its power connection", () => {
    const xml = render("dol");
    const mutated = withoutConductor(xml, terminalUuid("contacts", "4"), terminalUuid("overload", "3"));
    expect(verdicts(mutated, "dol")["connection:KM1/F1"]).toBe("fail");
    expect(verdicts(mutated, "dol")["connection:Q1/KM1"]).toBe("pass");
  });

  it("reversing without the phase swap fails the KM2 connection", () => {
    const xml = render("reversing");
    const km2 = uuidOf(xml, "contacts3.elmt", "KM2");
    const swapped = xml.replace(
      new RegExp(
        `(element1="${km2.replace(/[{}]/g, "\\$&")}" terminal1="${terminalUuid("contacts", "2")}" element2="[^"]+" terminal2=")${terminalUuid("overload", "5").replace(/[{}]/g, "\\$&")}`,
      ),
      `$1${terminalUuid("overload", "1")}`,
    );
    expect(swapped).not.toBe(xml);
    expect(verdicts(swapped, "reversing")["connection:KM2/F1:5,3,1"]).toBe("fail");
  });

  it("an interlock contact bridged by an extra conductor fails the electrical interlock", () => {
    const xml = render("reversing");
    const project = readQetProject(xml, "r.qet");
    // KM2's 21-22 contact sits in KM1's rung: bridge it.
    const nc = project.elements.find((e) => e.type.endsWith("aux-nc-21-22.elmt") && e.label === "KM2");
    expect(nc).toBeDefined();
    const bridge = `            <conductor element1="${nc?.uuid}" terminal1="${terminalUuid("nc2122", "21")}" element2="${nc?.uuid}" terminal2="${terminalUuid("nc2122", "22")}" num="" type="multi" x="0" y="0">\n                <sequentialNumbers/>\n            </conductor>\n`;
    const at = xml.lastIndexOf("        </conductors>");
    const bridged = xml.slice(0, at) + bridge + xml.slice(at);
    const checks = verdicts(bridged, "reversing");
    expect(checks["interlock:electrical:KM1/KM2"]).toBe("fail");
    expect(checks["interlock:electrical:F1"]).toBe("pass");
  });

  it("an overload contact missing from a coil path fails the F1 interlock; the sequence needs the timer contacts", () => {
    const xml = render("star-delta");
    const project = readQetProject(xml, "sd.qet");
    const nc = project.elements.find((e) => e.type.endsWith("overload-nc-95-96.elmt"));
    const stop = project.elements.find((e) => e.label === "S0");
    const bypass = `            <conductor element1="${nc?.uuid}" terminal1="${terminalUuid("nc9596", "95")}" element2="${stop?.uuid}" terminal2="${terminalUuid("stop", "1")}" num="" type="multi" x="0" y="0">\n                <sequentialNumbers/>\n            </conductor>\n`;
    const at = xml.lastIndexOf("        </conductors>");
    const bypassed = xml.slice(0, at) + bypass + xml.slice(at);
    expect(verdicts(bypassed, "star-delta")["interlock:electrical:F1"]).toBe("fail");
    const timer = project.elements.find((e) => e.type.endsWith("timer-nc-55-56.elmt"));
    const shorted = `            <conductor element1="${timer?.uuid}" terminal1="${terminalUuid("timerNc", "55")}" element2="${timer?.uuid}" terminal2="${terminalUuid("timerNc", "56")}" num="" type="multi" x="0" y="0">\n                <sequentialNumbers/>\n            </conductor>\n`;
    const at2 = xml.lastIndexOf("        </conductors>");
    expect(verdicts(xml.slice(0, at2) + shorted + xml.slice(at2), "star-delta")["interlock:sequence"]).toBe(
      "fail",
    );
  });

  it("a star point on the wrong side fails; the mechanical interlock comes only from the stored criterion", () => {
    const xml = render("star-delta");
    const km3 = uuidOf(xml, "contacts3.elmt", "KM3");
    const moved = withoutConductor(
      xml,
      `element1="${km3}" terminal1="${terminalUuid("contacts", "1")}"`,
      terminalUuid("contacts", "3"),
    );
    expect(verdicts(moved, "star-delta")["star-point"]).toBe("fail");
    expect(
      verdicts(xml, "star-delta", { verdict: "unknown" as never, note: "No accessory listed." })[
        "mechanical-interlock"
      ],
    ).toBe("unknown");
    const none = assemblyChecks(
      readQetProject(xml, "sd.qet"),
      assemblies["star-delta"] as ElectricalAssembly,
      "M1",
      null,
    );
    expect(none.find((c) => c.id === "mechanical-interlock")?.verdict).toBe("not-evaluated");
  });
});

describe("project checks", () => {
  /** Gives every conductor the number of its potential (`N<id>`), then lets a test change single conductors. */
  const numbered = (xml: string, change: (index: number, num: string) => string = (_, num) => num) => {
    const project = readQetProject(xml, "n.qet");
    const nums = project.conductors.map((c, index) => {
      const end = c.ends[0] as { element: string; terminal: number };
      return change(index, `N${project.potentialOf.get(`${end.element}#${end.terminal}`)}`);
    });
    let at = 0;
    return xml.replace(/ num=""/g, () => ` num="${nums[at++]}"`);
  };
  const verdict = (xml: string, id: string, model: unknown = null) =>
    projectChecks(readQetProject(xml, "n.qet"), model as never, "schematics/n.qet").checks.find(
      (c) => c.id === id,
    );

  it("conductor numbering: unknown without numbers, pass with one per potential, fail on two per potential or a shared one", () => {
    const xml = render("dol");
    expect(verdict(xml, "conductor-numbering")?.verdict).toBe("unknown");
    expect(verdict(numbered(xml), "conductor-numbering")).toMatchObject({
      verdict: "pass",
      note: expect.stringMatching(/^One number per potential/),
    });
    const project = readQetProject(xml, "n.qet");
    // Potential P with two conductors: give its second conductor another number.
    const key = (c: (typeof project.conductors)[number]) => {
      const end = c.ends[0] as { element: string; terminal: number };
      return project.potentialOf.get(`${end.element}#${end.terminal}`);
    };
    const second = project.conductors.findIndex(
      (c, i) => project.conductors.findIndex((d) => key(d) === key(c)) < i,
    );
    expect(second).toBeGreaterThan(0);
    const split = verdict(
      numbered(xml, (i, num) => (i === second ? "N999" : num)),
      "conductor-numbering",
    );
    expect(split).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/Potentials with several numbers/),
    });
    const shared = verdict(
      numbered(xml, () => "N1"),
      "conductor-numbering",
    );
    expect(shared).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/Numbers on several potentials/),
    });
  });

  it("device list: fails on a model object of this project that is not drawn and on another recorded QET identity", () => {
    const xml = render("dol");
    const project = readQetProject(xml, "n.qet");
    const km1 = project.devices.find((d) => d.label === "KM1")?.head.uuid as string;
    const model = (objects: unknown[]) => ({ project: { id: "prj-x" }, objects });
    const drawnOnly = verdict(
      xml,
      "device-list",
      model([{ id: "dev-km9", type: "device", ref: "KM9", attributes: { qetProject: "schematics/n.qet" } }]),
    );
    expect(drawnOnly).toMatchObject({ verdict: "fail", note: expect.stringMatching(/not drawn: KM9/) });
    const other = verdict(
      xml,
      "device-list",
      model([
        {
          id: "dev-km1",
          type: "device",
          ref: "KM1",
          attributes: { qetUuid: "{00000000-0000-4000-8000-000000000001}", qetProject: "schematics/n.qet" },
        },
      ]),
    );
    expect(other).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/Other QET element than recorded: KM1/),
    });
    expect(km1).toMatch(/^\{/);
  });
});
