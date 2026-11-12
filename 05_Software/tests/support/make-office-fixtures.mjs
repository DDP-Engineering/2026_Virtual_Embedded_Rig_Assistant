// Generates the small, deterministic office fixtures under tests/fixtures/documents/office/.
// Run from 05_Software: node tests/support/make-office-fixtures.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

const root = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/documents/office");
mkdirSync(root, { recursive: true });
const fixed = new Date("2026-01-01T00:00:00Z");
function write(name, parts, stored = []) {
  const files = {};
  for (const [path, text] of Object.entries(parts))
    files[path] = [strToU8(text), { mtime: fixed, level: stored.includes(path) ? 0 : 6 }];
  writeFileSync(join(root, name), zipSync(files, { mtime: fixed }));
}
const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const rels = (items) =>
  `${xml}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;
const officeDoc = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

// Word: a paragraph before the first heading, two headings and a table.
const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
write("review.docx", {
  "[Content_Types].xml": `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  "_rels/.rels": rels([["rId1", officeDoc, "word/document.xml"]]),
  "word/_rels/document.xml.rels": rels([
    ["rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml"],
  ]),
  "word/styles.xml": `${xml}<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
  "word/document.xml": `${xml}<w:document ${W} ${R}><w:body>${para("Board review notes for the STM32G474 bench.")}${para("Power", "Heading1")}${para("The board uses a 3.3 V rail from the LDO.")}<w:tbl><w:tr><w:tc>${para("Rail")}</w:tc><w:tc>${para("3V3")}</w:tc></w:tr></w:tbl>${para("Reset", "Heading2")}${para("NRST has a 100 nF capacitor to ground.")}</w:body></w:document>`,
});

// Word without heading styles: the whole document is the untitled leading section.
write("plain.docx", {
  "[Content_Types].xml": `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  "_rels/.rels": rels([["rId1", officeDoc, "word/document.xml"]]),
  "word/document.xml": `${xml}<w:document ${W} ${R}><w:body>${para("Bench log without headings.")}${para("The SWD clock runs at 4 MHz on the probe.")}</w:body></w:document>`,
});

// PowerPoint: two slides in sldIdLst order (reversed file names), a table, and a speaker note.
const slide = (body) => `${xml}<p:sld ${A} ${P} ${R}><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const shape = (...lines) =>
  `<p:sp><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${l}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
write("bringup.pptx", {
  "[Content_Types].xml": `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
  "_rels/.rels": rels([["rId1", officeDoc, "ppt/presentation.xml"]]),
  "ppt/presentation.xml": `${xml}<p:presentation ${P} ${R}><p:sldIdLst><p:sldId id="256" r:id="rId8"/><p:sldId id="257" r:id="rId9"/></p:sldIdLst></p:presentation>`,
  "ppt/_rels/presentation.xml.rels": rels([
    [
      "rId8",
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
      "slides/slide2.xml",
    ],
    [
      "rId9",
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
      "slides/slide1.xml",
    ],
  ]),
  "ppt/slides/slide2.xml": slide(shape("Bring-up plan", "Power the 3.3 V rail first")),
  "ppt/slides/slide1.xml": slide(
    `${shape("Measurements")}<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>VDD</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>3.29 V</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
  ),
  "ppt/notesSlides/notesSlide1.xml": slide(shape("SPEAKER NOTE must not be indexed")),
});

// Excel: shared, inline and numeric cells, a cached formula, an empty row and a gap column.
const SS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
write("test-report.xlsx", {
  "[Content_Types].xml": `${xml}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
  "_rels/.rels": rels([["rId1", officeDoc, "xl/workbook.xml"]]),
  "xl/workbook.xml": `${xml}<workbook ${SS} ${R}><sheets><sheet name="Rail" sheetId="1" r:id="rId1"/><sheet name="Timing" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": rels([
    [
      "rId1",
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
      "worksheets/sheet1.xml",
    ],
    [
      "rId2",
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
      "/xl/worksheets/sheet2.xml",
    ],
  ]),
  "xl/sharedStrings.xml": `${xml}<sst ${SS}><si><t>Signal</t></si><si><t>Volts</t></si><si><r><t>V</t></r><r><t>DD</t></r></si></sst>`,
  "xl/worksheets/sheet1.xml": `${xml}<worksheet ${SS}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"/><row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>3.29</v></c></row></sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": `${xml}<worksheet ${SS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Reset pulse</t></is></c><c r="B1"><f>B2*2</f><v>200</v></c></row></sheetData></worksheet>`,
});

// OpenDocument: mimetype first and stored, as the format requires.
const ODF =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"';
const odf = (name, mime, body) =>
  write(
    name,
    {
      mimetype: mime,
      "content.xml": `${xml}<office:document-content ${ODF}><office:body>${body}</office:body></office:document-content>`,
    },
    ["mimetype"],
  );
odf(
  "notes.odt",
  "application/vnd.oasis.opendocument.text",
  `<office:text><text:p>Lab notes.</text:p><text:h text:outline-level="1">Clock</text:h><text:p>HSE is 24 MHz.</text:p><text:h text:outline-level="2">PLL</text:h><text:p>PLL runs at 170 MHz.</text:p></office:text>`,
);
odf(
  "review.odp",
  "application/vnd.oasis.opendocument.presentation",
  `<office:presentation><draw:page draw:name="One"><draw:frame><draw:text-box><text:p>First slide</text:p></draw:text-box></draw:frame><presentation:notes><draw:frame><draw:text-box><text:p>SPEAKER NOTE must not be indexed</text:p></draw:text-box></draw:frame></presentation:notes></draw:page><draw:page draw:name="Two"><draw:frame><draw:text-box><text:p>Second slide</text:p></draw:text-box></draw:frame></draw:page></office:presentation>`,
);
odf(
  "timing.ods",
  "application/vnd.oasis.opendocument.spreadsheet",
  `<office:spreadsheet><table:table table:name="Clocks"><table:table-row><table:table-cell office:value-type="string"><text:p>Clock</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="24"><text:p>24</text:p></table:table-cell></table:table-row><table:table-row table:number-rows-repeated="3"><table:table-cell/></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>PLL</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"/><table:table-cell office:value-type="float" office:value="170"><text:p>170</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>`,
);
console.log(`office fixtures written to ${root}`);
