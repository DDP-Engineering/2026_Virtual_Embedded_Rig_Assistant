// Strict reading of QElectroTech projects (spec REQ-DATA-963cbdf6 "Strict XML", "Project mapping", "Devices and
// cross-references"): document type declarations and every other construct outside the subset are refused, the
// candidate fixtures map to folios, elements, conductors, potentials and devices, legacy terminal ids resolve like
// UUIDs, folio reports join potentials and broken references are problems, never silent drops.
import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readQetProject } from "./qet.js";
import { decodeXmlBytes, parseStrictXml } from "./xml-strict.js";

const fixtures = new URL("../../../../../tests/fixtures/qelectrotech/", import.meta.url);
const refused = (xml: string) => () => parseStrictXml(xml, "p.qet");

describe("strict XML", () => {
  it.each([
    [
      '<?xml version="1.0"?>\n<!DOCTYPE project [<!ENTITY x SYSTEM "file:///etc/passwd">]>\n<project>&x;</project>',
      2,
      /document type declarations are not allowed/,
    ],
    ['<!DOCTYPE project SYSTEM "http://example.invalid/qet.dtd"><project/>', 1, /document type declarations/],
    ['<!DOCTYPE p [<!ENTITY % e SYSTEM "file:///x"> %e;]><project/>', 1, /document type declarations/],
    ["<project>&nbsp;</project>", 1, /the entity &nbsp; is not allowed/],
    ['<project title="&x;"/>', 1, /the entity &x; is not allowed/],
    ["<project>\n<?php echo 1 ?>\n</project>", 2, /processing instructions are not allowed/],
    ['<project a="1" a="2"/>', 1, /the attribute a is repeated/],
    ["<project>\n<diagram>\n</project>", 3, /<\/project> closes <diagram>/],
    ["<project/><project/>", 1, /a second root element/],
    ["<project/>text", 1, /text after the root element/],
    ['<project a="<"/>', 1, /'<' in the value of a/],
    ["<project>&#0;</project>", 1, /not an XML character/],
    ["<project>\u0001</project>", 1, /character U\+0001 is not allowed/],
    ['<?xml version="1.0" encoding="ISO-8859-1"?><project/>', 1, /encoding ISO-8859-1 is not read/],
    ["<project><![CDATA[x</project>", 1, /unclosed CDATA/],
    ["<project><!ELEMENT x ANY></project>", 1, /declarations are not allowed/],
    ["<project>&constructor;</project>", 1, /the entity &constructor; is not allowed/],
    ['<project title="&__proto__;"/>', 1, /the entity &__proto__; is not allowed/],
  ])("refuses %j at line %i", (xml, line, reason) => {
    expect(refused(xml)).toThrow(reason);
    expect(refused(xml)).toThrow(new RegExp(`^Invalid QElectroTech project p\\.qet: line ${line}: `));
  });

  it("refuses depth, UTF-16, invalid UTF-8 and oversize bytes before parsing", () => {
    expect(refused(`${"<a>".repeat(70)}${"</a>".repeat(70)}`)).toThrow(/more than 64 nested elements/);
    expect(() => decodeXmlBytes(Uint8Array.from([0xff, 0xfe, 0x3c, 0x00]), "p.qet")).toThrow(
      /only UTF-8 is read/,
    );
    expect(() => decodeXmlBytes(Uint8Array.from([0x3c, 0xc3, 0x28]), "p.qet")).toThrow(/not valid UTF-8/);
    expect(() => decodeXmlBytes(new Uint8Array(16 * 1024 * 1024 + 1), "p.qet")).toThrow(/larger than 16 MiB/);
  });

  it("caps the element count and reads large files in linear time", () => {
    expect(refused(`<a>${"<b/>\n".repeat(500_000)}</a>`)).toThrow(
      /^Invalid QElectroTech project p\.qet: line \d+: more than 500000 elements/,
    );
    const started = performance.now();
    const root = parseStrictXml(`<a>${"<b/>\n".repeat(400_000)}</a>`, "p.qet");
    expect(root.children).toHaveLength(400_000);
    expect(root.children.at(-1)?.line).toBe(400_000);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("reads comments, CDATA, predefined entities and character references with source spans", () => {
    const xml =
      '﻿<?xml version="1.0" encoding="UTF-8"?>\n<!-- c -->\n<project title="a &amp; b">\n <x>1 &lt; 2 &#x263A;<![CDATA[<raw>]]></x>\n</project>\n';
    const root = parseStrictXml(xml, "p.qet");
    expect(root.attributes[0]?.value).toBe("a & b");
    const child = root.children[0];
    expect(child?.text).toBe("1 < 2 ☺<raw>");
    expect(xml.slice(child?.contentStart, child?.contentEnd)).toBe("1 &lt; 2 &#x263A;<![CDATA[<raw>]]>");
    expect(xml.slice(root.attributes[0]?.valueStart, root.attributes[0]?.valueEnd)).toBe("a &amp; b");
  });
});

describe("QElectroTech project mapping", () => {
  it("reads every fixture without problems", async () => {
    const names = (await readdir(fixtures)).filter((name) => name.endsWith(".qet"));
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) {
      const project = readQetProject(await readFile(new URL(name, fixtures), "utf8"), name);
      expect([name, project.problems]).toEqual([name, []]);
    }
  });

  it("maps the DOL candidate's folios, definitions, conductors, potentials and devices", async () => {
    const source = await readFile(new URL("dol.generated.qet", fixtures), "utf8");
    const project = readQetProject(source, "dol.qet");
    expect(project.version).toBe("0.90");
    expect(project.properties["vera-template"]).toBe("dol 1");
    expect(project.folios).toEqual([
      { index: 0, order: 1, title: "Power circuit", folio: "%id/%total", elements: 5, conductors: 12 },
      { index: 1, order: 2, title: "Control circuit", folio: "%id/%total", elements: 7, conductors: 7 },
    ]);
    expect(project.elements).toHaveLength((source.match(/<element uuid=/g) ?? []).length);
    expect(project.conductors).toHaveLength((source.match(/<conductor /g) ?? []).length);
    expect(project.conductors.every((c) => c.ends[0] && c.ends[1])).toBe(true);
    expect(project.definitions.get("embed://import/vera/coil.elmt")).toMatchObject({
      linkType: "master",
      kind: { type: "coil" },
    });
    expect(
      project.definitions.get("embed://import/vera/contacts3.elmt")?.terminals.map((t) => t.name),
    ).toEqual(["1", "2", "3", "4", "5", "6"]);
    // Power: 4 connections x 3 phases on 12 potentials; control: L, F1-S0, S0-S1/13, S1/14-A1, A2-N.
    expect(project.potentials).toHaveLength(17);
  });

  it("resolves legacy numeric terminal ids like UUIDs, joins folio reports and lists broken references", () => {
    const def = (name: string, link: string, terminals: string) =>
      `<element name="${name}"><definition type="element" link_type="${link}"><names><name lang="en">${name}</name></names><description>${terminals}</description></definition></element>`;
    const t = (uuid: string, name: string, y: number, o: string) =>
      `<terminal uuid="${uuid}" name="${name}" x="0" y="${y}" orientation="${o}"/>`;
    const A = "{00000000-0000-4000-8000-00000000000a}";
    const B = "{00000000-0000-4000-8000-00000000000b}";
    const element = (uuid: string, type: string, label: string, ids: string, links = "") =>
      `<element uuid="${uuid}" type="embed://import/t/${type}" x="0" y="0"><terminals>${ids}</terminals><elementInformations><elementInformation name="label">${label}</elementInformation></elementInformations>${links}</element>`;
    const xml = `<project version="0.80">
<diagram order="1"><elements>
${element("{00000000-0000-4000-8000-000000000001}", "r.elmt", "R1", '<terminal id="7" x="0" y="-10" orientation="0"/><terminal id="8" x="0" y="10" orientation="2"/>')}
${element("{00000000-0000-4000-8000-000000000002}", "next.elmt", "", "", `<links_uuids><link_uuid uuid="{00000000-0000-4000-8000-000000000003}"/></links_uuids>`)}
<element uuid="{00000000-0000-4000-8000-000000000009}" type="common://10_electric/x.elmt" x="0" y="0"/>
</elements><conductors>
<conductor terminal1="8" element2="{00000000-0000-4000-8000-000000000002}" terminal2="${A}"/>
<conductor terminal1="99" terminal2="7"/>
</conductors></diagram>
<diagram order="2"><elements>
${element("{00000000-0000-4000-8000-000000000003}", "prev.elmt", "", "", `<links_uuids><link_uuid uuid="{00000000-0000-4000-8000-000000000002}"/></links_uuids>`)}
${element("{00000000-0000-4000-8000-000000000004}", "r.elmt", "R2", "")}
</elements><conductors>
<conductor element1="{00000000-0000-4000-8000-000000000003}" terminal1="${B}" element2="{00000000-0000-4000-8000-000000000004}" terminal2="{00000000-0000-4000-8000-0000000000c1}"/>
</conductors></diagram>
<collection><category name="import"><category name="t">
${def("r.elmt", "simple", t("{00000000-0000-4000-8000-0000000000c1}", "1", -10, "n") + t("{00000000-0000-4000-8000-0000000000c2}", "2", 10, "s"))}
${def("next.elmt", "next_report", t(A, "", 0, "n"))}
${def("prev.elmt", "previous_report", t(B, "", 0, "n"))}
</category></category></collection></project>`;
    const project = readQetProject(xml, "legacy.qet");
    const [first] = project.conductors;
    expect(first?.ends[0]).toEqual({ element: "{00000000-0000-4000-8000-000000000001}", terminal: 1 });
    const r1 = project.potentialOf.get("{00000000-0000-4000-8000-000000000001}#1");
    expect(r1).toBeDefined();
    expect(project.potentialOf.get("{00000000-0000-4000-8000-000000000004}#0")).toBe(r1);
    expect(project.problems.map((p) => p.code).sort()).toEqual(["conductor-end", "definition-missing"]);
    expect(project.conductors).toHaveLength(3);
    expect(project.devices.map((d) => d.label)).toEqual(["R1", "R2", null]);
    // The previous report drops its link: the pair no longer joins and both sides are reported.
    const broken = xml.replace(
      `<links_uuids><link_uuid uuid="{00000000-0000-4000-8000-000000000002}"/></links_uuids>`,
      "",
    );
    const codes = readQetProject(broken, "legacy.qet").problems.map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(["report-unlinked", "link-not-reciprocal"]));
  });

  it("reports a link between incompatible link types", async () => {
    const source = await readFile(new URL("dol.generated.qet", fixtures), "utf8");
    const project = readQetProject(source, "dol.qet");
    const button = project.elements.find((e) => e.label === "S1") as (typeof project.elements)[number];
    const coil = project.elements.find((e) =>
      e.type.endsWith("coil.elmt"),
    ) as (typeof project.elements)[number];
    const tag = source.slice(button.node.start, button.node.end);
    const linked = source.replace(
      tag,
      tag.replace(
        "<dynamic_texts>",
        `<links_uuids><link_uuid uuid="${coil.uuid}"/></links_uuids>
<dynamic_texts>`,
      ),
    );
    expect(readQetProject(linked, "dol.qet").problems.map((p) => p.code)).toEqual(["link-type"]);
  });

  it("reports cross-reference problems: unlinked slave, one-sided link, slave label, duplicate label", async () => {
    const source = await readFile(new URL("reversing.generated.qet", fixtures), "utf8");
    const base = readQetProject(source, "r.qet");
    const coil = base.elements.find((e) => e.type.endsWith("coil.elmt") && e.label === "KM2");
    const nc = base.elements.find((e) => e.type.endsWith("aux-nc-21-22.elmt") && e.label === "KM2");
    // Drop the slave's link back to its coil, relabel another slave, duplicate a coil label.
    const contact = source.slice(nc?.node.start, nc?.node.end);
    const unlinked = contact.replace(/<links_uuids>[\s\S]*?<\/links_uuids>\n\s*/, "");
    const mutated = source.replace(contact, unlinked);
    expect(readQetProject(mutated, "r.qet").problems.map((p) => p.code)).toEqual(["link-not-reciprocal"]);
    const orphan = mutated.replace(`<link_uuid uuid="${nc?.uuid}"/>`, "");
    expect(readQetProject(orphan, "r.qet").problems.map((p) => p.code)).toEqual(["slave-unlinked"]);
    const km1 = base.elements.find((e) => e.type.endsWith("aux-no-13-14.elmt") && e.label === "KM1");
    const relabelled = source.replace(
      source.slice(km1?.node.start, km1?.node.end),
      source.slice(km1?.node.start, km1?.node.end).replace(">KM1<", ">KM9<"),
    );
    expect(readQetProject(relabelled, "r.qet").problems.map((p) => p.code)).toEqual(["slave-label"]);
    const coilXml = source.slice(coil?.node.start, coil?.node.end);
    const duplicate = source.replace(coilXml, coilXml.replace(">KM2<", ">KM1<"));
    expect(readQetProject(duplicate, "r.qet").problems.map((p) => p.code)).toContain("label-duplicate");
  });

  it("refuses a root other than project", () => {
    expect(() => readQetProject("<definition/>", "x.qet")).toThrow(
      /the root element is <definition>, not <project>/,
    );
  });
});
