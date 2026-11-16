// Exports of a stored documentation run (spec REQ-DATA-aa83ed5c "Exports"): one list as CSV, every list as an XLSX
// workbook (Office Open XML zipped with fflate) or as a PDF 1.4 document written here with the standard Courier fonts,
// so no dependency is added. Every file starts with the controlled header: project, document, revision (or not stated),
// run, generated, model sha256 (and sources in CSV/XLSX). Pure: the tool writes the bytes through the write flow.
import {
  type DocumentationList,
  type DocumentationListName,
  type DocumentationResult,
  documentationLists,
  type ElectricalResult,
} from "@vera/shared";
import { strToU8, zipSync } from "fflate";
import { csvField } from "./panel.js";

const section = (result: ElectricalResult) => result.documentation as DocumentationResult;
const listOf = (result: ElectricalResult, name: DocumentationListName) =>
  section(result).lists.find((entry) => entry.list === name) as DocumentationList;

/** The controlled header lines of an export, as label and value. */
function header(result: ElectricalResult, document: string, sources: boolean): [string, string][] {
  const doc = section(result);
  return [
    ["Project", `${doc.project.name} (${doc.project.id})`],
    ["Document", document],
    ["Revision", doc.revision.value ?? "not stated"],
    ["Run", result.runId],
    ["Generated", result.finishedAt ?? result.startedAt],
    ["Model sha256", result.model.sha256],
    ...(sources ? ([["Sources", result.sources.join(" | ")]] as [string, string][]) : []),
  ];
}

/** One list as CSV: header lines, an empty line, the column row with key and source, the rows (CRLF). */
export function documentationCsv(result: ElectricalResult, name: DocumentationListName): string {
  const entry = listOf(result, name);
  const lines = [
    ...header(result, entry.title, true).map(([label, value]) => `${csvField(label)},${csvField(value)}`),
    "",
    [...entry.columns, "key", "source"].map(csvField).join(","),
    ...entry.rows.map((row) => [...row.cells, row.key, row.source].map(csvField).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

// ---- XLSX ---------------------------------------------------------------------------------------------------------------

const SHEET_NAMES: Readonly<Record<DocumentationListName, string>> = {
  materials: "Materials",
  connections: "Connections",
  cables: "Cables",
  terminals: "Terminals",
  labels: "Labels",
  io: "I-O",
  contents: "Contents",
};
const xmlText = (text: string) =>
  text
    .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const column = (index: number) => {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
function cellXml(ref: string, value: string | null, style = 0): string {
  if (value === null || value === "") return style ? `<c r="${ref}" s="${style}"/>` : "";
  const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t${space}>${xmlText(value)}</t></is></c>`;
}
const HEADER_ROWS = 7;
const COLUMN_ROW = HEADER_ROWS + 2;

function sheetXml(result: ElectricalResult, entry: DocumentationList): string {
  const columns = [...entry.columns, "key", "source"];
  const widths = columns.map((name, i) =>
    Math.min(
      60,
      Math.max(
        i === 0 ? 14 : 6,
        name.length + 2,
        ...entry.rows.map((row) => ([...row.cells, row.key, row.source][i] ?? "").length + 1),
      ),
    ),
  );
  const lastColumn = column(columns.length - 1);
  // Each header value spans the table's width (merged B..last), so it neither wraps in one data column nor spills
  // past the printed page; only a value longer than the span wraps, with its row height set (merged rows are not
  // fitted automatically).
  const span = widths.slice(1).reduce((sum, width) => sum + width, 0);
  const rows: string[] = [];
  const merges: string[] = [];
  header(result, entry.title, true).forEach(([label, value], i) => {
    const r = i + 1;
    const lines = Math.max(1, Math.ceil(value.length / Math.max(1, span)));
    rows.push(
      `<row r="${r}"${lines > 1 ? ` ht="${13 * lines}" customHeight="1"` : ""}>${cellXml(`A${r}`, label, 1)}${cellXml(`B${r}`, value, 2)}</row>`,
    );
    if (columns.length > 2) merges.push(`<mergeCell ref="B${r}:${lastColumn}${r}"/>`);
  });
  rows.push(
    `<row r="${COLUMN_ROW}">${columns.map((name, i) => cellXml(`${column(i)}${COLUMN_ROW}`, name, 1)).join("")}</row>`,
  );
  entry.rows.forEach((row, r) => {
    const n = COLUMN_ROW + 1 + r;
    rows.push(
      `<row r="${n}">${[...row.cells, row.key, row.source].map((value, i) => cellXml(`${column(i)}${n}`, value, i === columns.length - 1 ? 2 : 0)).join("")}</row>`,
    );
  });
  const last = `${lastColumn}${COLUMN_ROW + Math.max(1, entry.rows.length)}`;
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${COLUMN_ROW}" topLeftCell="A${COLUMN_ROW + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`,
    `<cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`,
    `<sheetData>${rows.join("")}</sheetData>`,
    `<autoFilter ref="A${COLUMN_ROW}:${last}"/>`,
    merges.length ? `<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>` : "",
    // Printed: A4 landscape, every column on one page width.
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>',
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
    "</worksheet>",
  ].join("");
}

/** Every list as an XLSX workbook, one sheet per list in list order. */
export function documentationXlsx(result: ElectricalResult): Uint8Array {
  const lists = documentationLists.map((name) => listOf(result, name));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        ...lists.map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        ),
        "</Types>",
      ].join(""),
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
        `<sheets>${lists.map((entry, i) => `<sheet name="${SHEET_NAMES[entry.list]}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>`,
        `<definedNames>${lists.map((entry, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${SHEET_NAMES[entry.list]}'!$A$${COLUMN_ROW}:$${column(entry.columns.length + 1)}$${COLUMN_ROW + Math.max(1, entry.rows.length)}</definedName>`).join("")}</definedNames>`,
        "</workbook>",
      ].join(""),
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        ...lists.map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        ),
        `<Relationship Id="rId${lists.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
        "</Relationships>",
      ].join(""),
    ),
    "xl/styles.xml": strToU8(
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>',
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>',
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>',
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
        "</styleSheet>",
      ].join(""),
    ),
  };
  lists.forEach((entry, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(result, entry));
  });
  // A fixed local time keeps the bytes reproducible: fflate writes the ZIP time from local date fields.
  return zipSync(files, { level: 6, mtime: new Date(2026, 0, 1) });
}

// ---- PDF ----------------------------------------------------------------------------------------------------------------

const PAGE = { width: 842, height: 595, margin: 36 } as const; // A4 landscape, points
const SIZE = 8;
const CHAR = 0.6 * SIZE; // Courier advance width
const LINE = 10;
const COLUMNS = Math.floor((PAGE.width - 2 * PAGE.margin) / CHAR);
const TOP = PAGE.height - PAGE.margin - 52;
const ROWS = Math.floor((TOP - PAGE.margin - 20) / LINE);
const WIN_ANSI: Readonly<Record<string, number>> = {
  "€": 0x80,
  "‚": 0x82,
  "„": 0x84,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "™": 0x99,
};
/** A PDF string literal in WinAnsi; characters outside it become `?`. */
function pdfString(text: string): string {
  let out = "(";
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    const byte =
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? code : (WIN_ANSI[char] ?? 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}
const cut = (text: string, width: number) =>
  [...text].length <= width ? text : `${[...text].slice(0, Math.max(0, width - 1)).join("")}~`;

/** Column widths in characters: natural widths, the widest shrunk until the row fits the page. */
function widths(columns: readonly string[], rows: (string | null)[][]): number[] {
  const natural = columns.map((name, i) =>
    Math.min(COLUMNS, Math.max(name.length, ...rows.map((row) => [...(row[i] ?? "")].length))),
  );
  const room = COLUMNS - (columns.length - 1) * 2;
  while (natural.reduce((sum, width) => sum + width, 0) > room) {
    const widest = natural.indexOf(Math.max(...natural));
    natural[widest] = (natural[widest] as number) - 1;
  }
  return natural;
}

interface PdfPage {
  title: string;
  lines: { text: string; bold?: boolean; x?: number }[][];
}

function tablePages(title: string, columns: readonly string[], rows: (string | null)[][]): PdfPage[] {
  const width = widths(columns, rows);
  const line = (cells: readonly (string | null)[], bold = false) => {
    let x = 0;
    return cells.map((cell, i) => {
      const at = x;
      x += (width[i] as number) + 2;
      return { text: cut(cell ?? "", width[i] as number), bold, x: at };
    });
  };
  const pages: PdfPage[] = [];
  const per = ROWS - 1;
  for (let start = 0; start === 0 || start < rows.length; start += per)
    pages.push({
      title,
      lines: [
        line(columns, true),
        ...(rows.length ? rows.slice(start, start + per).map((row) => line(row)) : [[{ text: "(no rows)" }]]),
      ],
    });
  return pages;
}

/** Every list as a PDF document: a contents page, then one section per list with repeated column headers. */
export function documentationPdf(result: ElectricalResult): Uint8Array {
  const doc = section(result);
  const sections = doc.lists
    .filter((entry) => entry.list !== "contents")
    .map((entry) => ({
      entry,
      pages: tablePages(
        entry.title,
        entry.columns,
        entry.rows.map((row) => row.cells),
      ),
    }));
  let first = 2;
  const contentsRows = sections.map(({ entry, pages }) => {
    const row = [entry.title, String(entry.rows.length), String(first), entry.sha256.slice(0, 16)];
    first += pages.length;
    return row;
  });
  const contents = tablePages("Contents", ["document", "rows", "page", "sha256 (first 16)"], contentsRows);
  const sourceLines = result.sources.map((source) => [{ text: cut(source, COLUMNS) }]);
  const firstPage = contents[0] as PdfPage;
  firstPage.lines.push(
    [{ text: "" }],
    [{ text: "Sources", bold: true }],
    ...sourceLines.slice(0, ROWS - firstPage.lines.length - 3),
  );
  const pages = [...contents, ...sections.flatMap((entry) => entry.pages)];
  const head = header(result, "", false);
  const meta = head.filter(([label]) => label !== "Document" && label !== "Model sha256");
  const metaLine = meta.map(([label, value]) => `${label} ${value}`).join("   ");
  const shaLine = `Model sha256 ${result.model.sha256}`;

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("");
  const tree = add("");
  const regular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  const bold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  pages.forEach((page, index) => {
    const ops: string[] = [];
    const text = (x: number, y: number, size: number, isBold: boolean, value: string) =>
      ops.push(
        `BT /${isBold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td ${pdfString(value)} Tj ET`,
      );
    const left = PAGE.margin;
    text(left, PAGE.height - PAGE.margin - 12, 12, true, page.title);
    text(left, PAGE.height - PAGE.margin - 26, SIZE, false, cut(metaLine, COLUMNS));
    text(left, PAGE.height - PAGE.margin - 37, SIZE, false, shaLine);
    ops.push(
      `0.5 w ${left} ${TOP + 6} m ${PAGE.width - left} ${TOP + 6} l S`,
      `0.5 w ${left} ${PAGE.margin + 4} m ${PAGE.width - left} ${PAGE.margin + 4} l S`,
    );
    page.lines.forEach((cells, row) => {
      const y = TOP - row * LINE;
      for (const cell of cells)
        if (cell.text) text(left + (cell.x ?? 0) * CHAR, y, SIZE, cell.bold === true, cell.text);
      if (row === 0 && cells[0]?.bold && cells.length > 1)
        ops.push(`0.3 w ${left} ${y - 3} m ${PAGE.width - left} ${y - 3} l S`);
    });
    text(left, PAGE.margin - 8, SIZE, false, "VERA electrical-documentation");
    const footer = `Page ${index + 1} / ${pages.length}`;
    text(PAGE.width - left - footer.length * CHAR, PAGE.margin - 8, SIZE, false, footer);
    const stream = `${ops.join("\n")}\n`;
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] =
    `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = add(
    `<< /Title ${pdfString(`${doc.project.name} - documentation, revision ${doc.revision.value ?? "not stated"}`)} /Producer (VERA electrical-documentation) >>`,
  );
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
