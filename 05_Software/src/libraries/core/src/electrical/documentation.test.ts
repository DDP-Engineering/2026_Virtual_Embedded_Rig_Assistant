// Pure documentation pieces (spec REQ-DATA-aa83ed5c): the strict tag file, the strict result section and request,
// and the export writers (CSV, XLSX, PDF) on a small hand-built result.
import { documentationColumns, documentationLists, type ElectricalResult } from "@vera/shared";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import * as api from "../index.js";

describe("tag file (REQ-DATA-9ca17c7a)", () => {
  it("reads name and address with line numbers, quoted fields and a byte-order mark", () => {
    const file = api.parseTagFile(
      '﻿name,address,dataType,comment\r\nM1_Running,%I0.0,BOOL,"KM1, aux 13-14"\r\n\r\n"Say ""hi""",%Q0.0,BOOL,\r\n',
      "plc/tags.csv",
    );
    expect(file.entries).toEqual([
      { name: "M1_Running", address: "%I0.0", dataType: "BOOL", comment: "KM1, aux 13-14", line: 2 },
      { name: 'Say "hi"', address: "%Q0.0", dataType: "BOOL", comment: null, line: 4 },
    ]);
    expect(api.parseTagFile("address,name\n%I0.0,A\n", "t.csv").entries[0]).toMatchObject({
      name: "A",
      line: 2,
    });
  });

  it.each([
    ["name,address,plc\nA,%I0.0,x\n", /line 1: unknown column plc/],
    ["name,comment\nA,x\n", /line 1: the header needs name and address/],
    ["name,address,name\n", /line 1: column name twice/],
    ["name,address\nA,\n", /line 2: empty address/],
    ["name,address\n,%I0.0\n", /line 2: empty name/],
    ["name,address\nA,%I0.0,extra\n", /line 2: 3 fields, the header has 2/],
    ['name,address\n"A,%I0.0\n', /line 2: unterminated quoted field/],
    ["", /line 1: the header needs name and address/],
    ['name,address\n"A"x,%I0.0\n', /line 2: text after a closing quote/],
    ['name,address\nA"B,%I0.0\n', /line 2: a quote inside an unquoted field/],
  ])("refuses %j", (text, message) => {
    expect(() => api.parseTagFile(text, "plc/tags.csv")).toThrow(
      new RegExp(`^Invalid tag file plc/tags\\.csv: ${message.source}`),
    );
  });

  it("refuses more than 5000 rows and normalizes addresses", () => {
    const rows = Array.from({ length: 5001 }, (_, i) => `T${i},%M${i}`).join("\n");
    expect(() => api.parseTagFile(`name,address\n${rows}\n`, "t.csv")).toThrow(/more than 5000 rows/);
    expect(api.normalizeAddress(" %i0.0 ")).toBe("I0.0");
    expect(api.normalizeAddress("%IW 64")).toBe("IW64");
  });
});

const sha = "a".repeat(64);
/** A small valid documentation result: two lists filled, the others empty. */
function sample(extra: Partial<Record<string, string[][]>> = {}): ElectricalResult {
  const rows = (name: string, cells: string[][]) =>
    cells.map((row, i) => ({ key: `${name}-${i}`, cells: row, source: `model:m.json@sha256:${sha}#x` }));
  const fill: Record<string, string[][]> = {
    connections: [
      ["101", "X0:L1", "Q1:1", "P1", "1", "", "", "", "s.qet"],
      ["=SUM(A1)", "Q1:2", "KM1:1", "P2", "1", "", "", "", "s.qet"],
    ],
    labels: [['Ä, ș; "q"', "device", "plate", ""]],
    ...extra,
  };
  const lists = documentationLists.map((list) => ({
    list,
    title: api.documentationTitles[list],
    columns: [...documentationColumns[list]],
    rows: rows(list, fill[list] ?? []),
    sha256: sha,
  }));
  return {
    kind: "vera-electrical-result",
    format: 1,
    runId: "20261116-120000-abcd",
    producer: {
      plugin: "electrical-documentation",
      operation: "documentation",
      engine: { name: "vera-documentation", version: "1.0.0" },
    },
    method: { id: "documentation-lists", title: "Documentation lists" },
    status: "completed",
    preliminary: false,
    startedAt: "2026-11-16T12:00:00Z",
    finishedAt: "2026-11-16T12:00:01Z",
    model: { path: "electrical-automation-model.json", sha256: sha },
    catalog: null,
    inputs: [{ id: "prj-x", snapshot: {} }],
    assumptions: [],
    sources: [`qet:s.qet@sha256:${sha}`],
    conditions: {},
    intermediate: [],
    criteria: [],
    limits: [],
    messages: [],
    documentation: {
      project: { id: "prj-x", name: "Project X" },
      revision: { value: null, document: null, date: null, author: null },
      panel: { run: "20261116-110000-pppp", path: "electrical-automation-panels/p.json", sha256: sha },
      lists,
    },
  } as ElectricalResult;
}

describe("documentation section (REQ-DATA-aa83ed5c)", () => {
  it("accepts a valid section and refuses unknown keys, other columns and short rows", () => {
    expect("result" in api.checkResult(sample(), "20261116-120000-abcd")).toBe(true);
    const unknown = sample();
    (unknown.documentation as unknown as Record<string, unknown>).extra = 1;
    expect(api.checkResult(unknown, unknown.runId)).toMatchObject({ problem: { path: "documentation" } });
    const renamed = sample();
    const cables = renamed.documentation?.lists[2];
    if (cables) cables.columns[0] = "name";
    expect(api.checkResult(renamed, renamed.runId)).toMatchObject({
      problem: { path: expect.stringMatching(/^documentation\.lists/) },
    });
    const short = sample({ cables: [["W1"]] });
    expect(api.checkResult(short, short.runId)).toMatchObject({
      problem: { path: expect.stringMatching(/^documentation\.lists/) },
    });
  });

  it("refuses an unknown request key and nine schematics", () => {
    const request = api.electricalDocumentationCheckParams;
    expect(request.safeParse({ panelRun: "r1" }).success).toBe(true);
    expect(request.safeParse({ panelRun: "r1", extra: 1 }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ path: `s${i}.qet` }));
    expect(request.safeParse({ panelRun: "r1", schematics: nine }).success).toBe(false);
  });
});

describe("export writers (REQ-FUNC-c0be3443)", () => {
  it("CSV: controlled header, quoting and neutralized formulas", () => {
    const csv = api.documentationCsv(sample(), "connections");
    expect(csv.split("\r\n").slice(0, 7)).toEqual([
      "Project,Project X (prj-x)",
      "Document,Connection list",
      "Revision,not stated",
      "Run,20261116-120000-abcd",
      "Generated,2026-11-16T12:00:01Z",
      `Model sha256,${sha}`,
      `Sources,qet:s.qet@sha256:${sha}`,
    ]);
    expect(csv).toContain("\r\n'=SUM(A1),Q1:2,KM1:1,");
    expect(api.documentationCsv(sample(), "labels")).toContain('"Ä, ș; ""q""",device,plate,');
  });

  it("XLSX: one sheet per list with escaped inline strings, frozen header row and filter", () => {
    const zip = unzipSync(api.documentationXlsx(sample()));
    expect(Object.keys(zip).sort()).toEqual(
      [
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        ...documentationLists.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`),
      ].sort(),
    );
    const sheet = strFromU8(zip["xl/worksheets/sheet5.xml"] as Uint8Array);
    expect(sheet).toContain("<t>Ä, ș; &quot;q&quot;</t>");
    expect(sheet).toContain('<pane ySplit="9" topLeftCell="A10" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A9:F10"/>');
    const content = strFromU8(zip["[Content_Types].xml"] as Uint8Array);
    expect(content).toContain("spreadsheetml.sheet.main+xml");
  });

  it("PDF: a valid cross-reference table, a contents page and repeated headers on every page", () => {
    const many = Array.from({ length: 70 }, (_, i) => [
      String(100 + i),
      `X${i}:1`,
      `Q${i}:1`,
      "P",
      "1",
      "",
      "",
      "",
      "s.qet",
    ]);
    const bytes = api.documentationPdf(sample({ connections: many }));
    const pdf = Buffer.from(bytes).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    for (const [i, offset] of offsets.entries())
      expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true);
    const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(4);
    expect(pdf.split("(wire").length - 1).toBeGreaterThanOrEqual(2);
    expect(pdf.split("Run 20261116-120000-abcd").length - 1).toBe(pages);
    expect(pdf).toContain(`(Page ${pages} / ${pages})`);
    // WinAnsi: Ä is kept as its byte, ș (not in WinAnsi) becomes ?
    expect(pdf).toContain('(\xC4, ?; "q")');
  });
});
