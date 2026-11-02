import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { expect, it } from "vitest";
import { extractOffice } from "./office.js";
import { OFFICE_LIMITS, OfficeLimitError, officeFormat } from "./office-format.js";

const fixtures = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../tests/fixtures/documents/office",
);
const fixture = (name: string) => readFile(join(fixtures, name)).then((b) => new Uint8Array(b));

it("maps modern office extensions to formats and leaves legacy and RTF unmapped", () => {
  expect(["a.DOCX", "b.pptx", "c.xlsx", "d.odt", "e.odp", "f.ods"].map(officeFormat)).toEqual([
    "docx",
    "pptx",
    "xlsx",
    "odt",
    "odp",
    "ods",
  ]);
  for (const legacy of ["a.doc", "b.ppt", "c.xls", "d.rtf", "e.pdf", "docs/~$review.docx", "~$deck.pptx"])
    expect(officeFormat(legacy)).toBeUndefined();
  expect(OFFICE_LIMITS).toEqual({ entries: 10000, bytes: 500 * 1024 * 1024 });
});

// REQ-FUNC-58cba7fd
it("extracts Word and OpenDocument text as heading sections with a leading untitled section", async () => {
  for (const [name, format, lead, headings] of [
    ["review.docx", "docx", "Board review notes", [["Power"], ["Power", "Reset"]]],
    ["notes.odt", "odt", "Lab notes.", [["Clock"], ["Clock", "PLL"]]],
  ] as const) {
    const extraction = await extractOffice(format, await fixture(name));
    if (extraction.kind !== "document") throw Error(`${name} kind ${extraction.kind}`);
    expect(extraction.sections[0]).toMatchObject({ path: [], slug: "" });
    expect(extraction.sections[0]?.text).toContain(lead);
    expect(extraction.sections.slice(1).map((s) => s.path)).toEqual(headings);
    expect(extraction.sections.slice(1).map((s) => s.slug)).toEqual(
      headings.map((h) => h.at(-1)?.toLowerCase()),
    );
  }
  const docx = await extractOffice("docx", await fixture("review.docx"));
  if (docx.kind !== "document") throw Error("kind");
  expect(docx.sections[1]?.text).toContain("3.3 V rail");
  expect(docx.sections[1]?.text).toContain("3V3");
  expect(docx.sections[2]?.text).toContain("100 nF");
});

// REQ-FUNC-bc730650
it("extracts presentation slides in deck order with tables and without speaker notes", async () => {
  const pptx = await extractOffice("pptx", await fixture("bringup.pptx"));
  expect(pptx).toEqual({
    kind: "presentation",
    slides: ["Bring-up plan\nPower the 3.3 V rail first", "Measurements\nVDD\n3.29 V"],
  });
  const odp = await extractOffice("odp", await fixture("review.odp"));
  expect(odp).toEqual({ kind: "presentation", slides: ["First slide", "Second slide"] });
  expect(JSON.stringify([pptx, odp])).not.toContain("SPEAKER NOTE");
});

// REQ-FUNC-81dbc6fc
it("extracts spreadsheets as one section per sheet with tab-separated non-empty rows", async () => {
  const xlsx = await extractOffice("xlsx", await fixture("test-report.xlsx"));
  expect(xlsx).toEqual({
    kind: "spreadsheet",
    sections: [
      { path: ["Rail"], slug: "rail", text: "Rail\n\nSignal\tVolts\nVDD\t\t3.29", start: 1, end: 4 },
      { path: ["Timing"], slug: "timing", text: "Timing\n\nReset pulse\t200", start: 1, end: 3 },
    ],
  });
  const ods = await extractOffice("ods", await fixture("timing.ods"));
  expect(ods).toEqual({
    kind: "spreadsheet",
    sections: [
      { path: ["Clocks"], slug: "clocks", text: "Clocks\n\nClock\t24\nPLL\t\t\t170", start: 1, end: 4 },
    ],
  });
});

// REQ-SEC-58c879e8
it("refuses archives beyond the entry or uncompressed-size limits before extracting", async () => {
  const many = zipSync({ a: strToU8("1"), b: strToU8("2"), c: strToU8("3") });
  await expect(extractOffice("docx", many, { entries: 2, bytes: 1000 })).rejects.toBeInstanceOf(
    OfficeLimitError,
  );
  const big = zipSync({ "word/document.xml": strToU8("x".repeat(5000)) });
  await expect(extractOffice("docx", big, { entries: 10, bytes: 1000 })).rejects.toBeInstanceOf(
    OfficeLimitError,
  );
  // A stored entry is copied by its stored size, so a directory claiming 0 bytes must not pass.
  const hidden = zipSync({ "word/document.xml": strToU8("x".repeat(5000)) }, { level: 0 });
  const view = new DataView(hidden.buffer, hidden.byteOffset, hidden.byteLength);
  for (let i = 0; i + 4 <= hidden.length; i++) {
    if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 0, true);
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 0, true);
  }
  await expect(extractOffice("docx", hidden, { entries: 10, bytes: 1000 })).rejects.toBeInstanceOf(
    OfficeLimitError,
  );
});

// REQ-REL-7a48f161
it("rejects corrupt, incomplete and encrypted office files as processing failures", async () => {
  const valid = await fixture("review.docx");
  const failures = [
    valid.subarray(0, valid.length / 2),
    zipSync({ "[Content_Types].xml": strToU8("<Types/>") }),
    new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
  ];
  for (const bytes of failures) {
    const result = extractOffice("docx", bytes);
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toBeInstanceOf(OfficeLimitError);
  }
});

const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const rels = (target: string, type: string) =>
  strToU8(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`,
  );
const xlsx = (sheetData: string) =>
  zipSync({
    "_rels/.rels": rels("xl/workbook.xml", "officeDocument"),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ${R}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": rels("worksheets/sheet1.xml", "worksheet"),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
    ),
  });
const ODF =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
const odf = (kind: string, body: string) =>
  zipSync({
    mimetype: [strToU8(`application/vnd.oasis.opendocument.${kind}`), { level: 0 }],
    "content.xml": strToU8(
      `<office:document-content ${ODF}><office:body>${body}</office:body></office:document-content>`,
    ),
  });

// REQ-SEC-58c879e8
it("refuses a declared oversized archive before inflating its corrupt data", async () => {
  const name = "word/document.xml";
  const archive = zipSync({ [name]: strToU8("x".repeat(5000)) });
  // The deflate stream follows the 30-byte local header and the name; 0xff bytes are an invalid block.
  archive.fill(0xff, 30 + name.length, 30 + name.length + 8);
  await expect(extractOffice("docx", archive, { entries: 10, bytes: 1000 })).rejects.toBeInstanceOf(
    OfficeLimitError,
  );
  await expect(extractOffice("docx", archive)).rejects.not.toBeInstanceOf(OfficeLimitError);
});

// REQ-REL-7a48f161
it("rejects cells beyond the last sheet column and sheet text beyond the extraction budget", async () => {
  await expect(
    extractOffice("xlsx", xlsx('<row r="1"><c r="XFD1"><v>1</v></c></row>')),
  ).resolves.toMatchObject({
    kind: "spreadsheet",
  });
  await expect(extractOffice("xlsx", xlsx('<row r="1"><c r="XFE1"><v>1</v></c></row>'))).rejects.toThrow(
    /column/,
  );
  const wide = `<table:table-cell table:number-columns-repeated="1000" office:value-type="string"><text:p>${"v".repeat(40)}</text:p></table:table-cell>`;
  const ods = odf(
    "spreadsheet",
    `<office:spreadsheet><table:table table:name="Big"><table:table-row table:number-rows-repeated="1000">${wide}</table:table-row></table:table></office:spreadsheet>`,
  );
  const result = extractOffice("ods", ods);
  await expect(result).rejects.toThrow(/budget/);
  await expect(result).rejects.not.toBeInstanceOf(OfficeLimitError);
});

// REQ-FUNC-58cba7fd REQ-FUNC-bc730650 REQ-FUNC-81dbc6fc
it("keeps inline tabs, line breaks and spaces and skips annotations and tracked deletions", async () => {
  const odt = await extractOffice(
    "odt",
    odf(
      "text",
      '<office:text><text:tracked-changes><text:changed-region text:id="c1"><text:deletion><text:p>DELETED</text:p></text:deletion></text:changed-region></text:tracked-changes><text:p>Name<text:tab/>Value<text:line-break/>Next<text:s text:c="2"/>end<office:annotation><text:p>COMMENT</text:p></office:annotation></text:p></office:text>',
    ),
  );
  if (odt.kind !== "document") throw Error(`odt kind ${odt.kind}`);
  expect(odt.sections[0]?.text).toMatch(/Name\s+Value\s+Next\s+end/);
  expect(JSON.stringify(odt)).not.toMatch(/DELETED|COMMENT/);
  expect(
    await extractOffice(
      "odp",
      odf(
        "presentation",
        "<office:presentation><draw:page><draw:frame><draw:text-box><text:p>A<text:tab/>B<text:line-break/>C</text:p></draw:text-box></draw:frame></draw:page></office:presentation>",
      ),
    ),
  ).toEqual({ kind: "presentation", slides: ["A\tB\nC"] });
  expect(
    await extractOffice(
      "ods",
      odf(
        "spreadsheet",
        '<office:spreadsheet><table:table table:name="T"><table:table-row><table:table-cell office:value-type="string"><office:annotation><text:p>NOTE</text:p></office:annotation><text:p>Visible<text:s/>cell</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>',
      ),
    ),
  ).toEqual({
    kind: "spreadsheet",
    sections: [{ path: ["T"], slug: "t", text: "T\n\nVisible cell", start: 1, end: 3 }],
  });
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const pptx = zipSync({
    "_rels/.rels": rels("ppt/presentation.xml", "officeDocument"),
    "ppt/presentation.xml": strToU8(
      `<p:presentation ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": rels("slides/slide1.xml", "slide"),
    "ppt/slides/slide1.xml": strToU8(
      `<p:sld ${A} ${P}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Line one</a:t></a:r><a:br/><a:r><a:t>Line two</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    ),
  });
  expect(await extractOffice("pptx", pptx)).toEqual({ kind: "presentation", slides: ["Line one\nLine two"] });
});
