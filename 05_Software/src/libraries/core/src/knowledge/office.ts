import { posix } from "node:path";
import { DOMParser, type XmlElement, type XmlNode } from "@xmldom/xmldom/lib/dom-parser.js";
import { type Unzipped, unzipSync, zipSync } from "fflate";
import mammoth from "mammoth";
import { textLines } from "../tools/files.js";
import { type Extraction, extractHtml, type Section, slugger } from "./extraction.js";
import { OFFICE_LIMITS, type OfficeFormat, OfficeLimitError, type OfficeLimits } from "./office-format.js";

/**
 * Reads the archive's central directory first and refuses it over the limits; only then are the
 * XML parts inflated. Media and embedded binaries are never inflated. The directory walk stops at
 * the first entry beyond a limit, since a zip64 record may declare billions of entries.
 */
function openArchive(bytes: Uint8Array, limits: OfficeLimits): Unzipped {
  let entries = 0;
  let total = 0;
  unzipSync(bytes, {
    filter: (file) => {
      entries++;
      // fflate copies a stored entry by its stored size, whatever the directory declares.
      if (file.compression === 0 && file.size !== file.originalSize) throw new OfficeLimitError();
      total += Math.max(file.size, file.originalSize);
      if (entries > limits.entries || total > limits.bytes) throw new OfficeLimitError();
      return false;
    },
  });
  return unzipSync(bytes, { filter: (file) => /\.(xml|rels)$/i.test(file.name) || file.name === "mimetype" });
}
function part(archive: Unzipped, name: string): string {
  const data = archive[name];
  if (!data) throw Error(`Missing office part ${name}.`);
  return new TextDecoder("utf-8", { fatal: true }).decode(data);
}
function xml(text: string): XmlElement {
  const failed = (message: string) => {
    throw Error(`Invalid office XML: ${message}`);
  };
  const doc = new DOMParser({
    errorHandler: { warning: () => {}, error: failed, fatalError: failed },
  }).parseFromString(text, "text/xml");
  if (!doc.documentElement) throw Error("Invalid office XML.");
  return doc.documentElement;
}
const children = (node: XmlNode): XmlNode[] => {
  const result: XmlNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
};
const isElement = (node: XmlNode): node is XmlElement => node.nodeType === 1;
/** Descendants with this local name, in document order, ignoring namespace prefixes. */
function all(node: XmlNode, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (current: XmlNode) => {
    for (const child of children(current))
      if (isElement(child)) {
        if (child.localName === name) found.push(child);
        walk(child);
      }
  };
  walk(node);
  return found;
}
const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
/** An attribute by local name in any namespace, or only in the given namespace. */
const attribute = (element: XmlElement, name: string, namespace?: string) =>
  [...Array(element.attributes.length).keys()]
    .map((i) => element.attributes.item(i))
    .find(
      (a) =>
        a &&
        (a.localName === name || a.name === name) &&
        (namespace === undefined || a.namespaceURI === namespace),
    )?.value ?? null;
/** The r:id relationship reference of an OOXML element. */
const relationshipId = (element: XmlElement) => attribute(element, "id", RELATIONSHIPS) ?? "";
const textOf = (node: XmlNode) => node.textContent ?? "";
const SPACE_CAP = 100;
/**
 * ODF inline text: tabs, line breaks and repeated spaces are elements, comments and tracked
 * deletions are skipped.
 */
function odfText(node: XmlNode): string {
  let text = "";
  for (const child of children(node)) {
    if (!isElement(child)) {
      if (child.nodeType === 3 || child.nodeType === 4) text += textOf(child);
      continue;
    }
    if (child.localName === "tab") text += "\t";
    else if (child.localName === "line-break") text += "\n";
    else if (child.localName === "s")
      text += " ".repeat(Math.min(SPACE_CAP, Math.max(1, Number(attribute(child, "c") ?? 1) || 1)));
    else if (child.localName !== "annotation" && child.localName !== "tracked-changes")
      text += odfText(child);
  }
  return text;
}
/** DrawingML paragraph text: `a:t` runs, with `a:br` as a line break. */
const drawingText = (node: XmlNode): string =>
  children(node)
    .filter(isElement)
    .map((child) =>
      child.localName === "t" ? textOf(child) : child.localName === "br" ? "\n" : drawingText(child),
    )
    .join("");
/** ODF paragraphs that are direct children, so cell or frame comments are not read as content. */
const paragraphs = (node: XmlNode) =>
  children(node).filter((child): child is XmlElement => isElement(child) && child.localName === "p");

/** Relationship targets of an OOXML part, resolved to archive paths. */
function relationships(archive: Unzipped, owner: string): Map<string, { type: string; target: string }> {
  const dir = posix.dirname(owner);
  const rels = `${dir === "." ? "" : `${dir}/`}_rels/${posix.basename(owner)}.rels`;
  const result = new Map<string, { type: string; target: string }>();
  if (!archive[rels]) return result;
  for (const rel of all(xml(part(archive, rels)), "Relationship")) {
    const id = attribute(rel, "Id"),
      target = attribute(rel, "Target");
    if (!id || !target || attribute(rel, "TargetMode") === "External") continue;
    result.set(id, {
      type: attribute(rel, "Type") ?? "",
      target: target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(dir, target)),
    });
  }
  return result;
}
function mainPart(archive: Unzipped, fallback: string): string {
  for (const rel of relationships(archive, "").values())
    if (rel.type.endsWith("/officeDocument")) return rel.target;
  return fallback;
}
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function word(archive: Unzipped): Promise<Extraction> {
  const main = mainPart(archive, "word/document.xml");
  if (!archive[main]) throw Error(`Missing office part ${main}.`);
  // Mammoth reads its own copy; a stored repack of only the XML parts keeps media uninflated.
  const { value } = await mammoth.convertToHtml(
    { buffer: Buffer.from(zipSync(archive, { level: 0 })) },
    { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
  );
  return { ...extractHtml(value), kind: "document" } as Extraction;
}
function openDocumentText(archive: Unzipped): Extraction {
  const body = all(xml(part(archive, "content.xml")), "text")[0];
  if (!body) throw Error("Missing office:text body.");
  let html = "";
  const walk = (node: XmlNode) => {
    for (const child of children(node)) {
      if (!isElement(child)) continue;
      if (child.localName === "h") {
        const level = Math.min(6, Math.max(1, Number(attribute(child, "outline-level") ?? 1) || 1));
        html += `<h${level}>${escapeHtml(odfText(child))}</h${level}>`;
      } else if (child.localName === "p") html += `<p>${escapeHtml(odfText(child))}</p>`;
      else if (child.localName !== "tracked-changes" && child.localName !== "annotation") walk(child);
    }
  };
  walk(body);
  return { ...extractHtml(html), kind: "document" } as Extraction;
}

function presentation(archive: Unzipped): Extraction {
  const main = mainPart(archive, "ppt/presentation.xml");
  const rels = relationships(archive, main);
  const slides = all(xml(part(archive, main)), "sldId").map((slide) => {
    const target = rels.get(relationshipId(slide))?.target;
    if (!target) throw Error("Slide relationship missing.");
    return all(xml(part(archive, target)), "p")
      .filter((p) => p.namespaceURI === "http://schemas.openxmlformats.org/drawingml/2006/main")
      .map((p) => drawingText(p).trim())
      .filter(Boolean)
      .join("\n");
  });
  if (!slides.length) throw Error("Presentation has no slides.");
  return { kind: "presentation", slides };
}
function openDocumentPresentation(archive: Unzipped): Extraction {
  const slides = all(xml(part(archive, "content.xml")), "page").map((page) => {
    const lines: string[] = [];
    const walk = (node: XmlNode) => {
      for (const child of children(node)) {
        if (!isElement(child) || child.localName === "notes" || child.localName === "annotation") continue;
        if (child.localName === "p" || child.localName === "h") {
          const line = odfText(child).trim();
          if (line) lines.push(line);
        } else walk(child);
      }
    };
    walk(page);
    return lines.join("\n");
  });
  if (!slides.length) throw Error("Presentation has no slides.");
  return { kind: "presentation", slides };
}

/** Repeated ODF rows and cells can multiply a small archive; bound the text a workbook may produce. */
const SHEET_TEXT_BUDGET = 32 * 1024 * 1024;
function sheetSections(sheets: { name: string; rows: string[][] }[]): Extraction {
  const slug = slugger();
  let budget = SHEET_TEXT_BUDGET;
  const sections: Section[] = sheets.map(({ name, rows }) => {
    const lines = rows
      .map((cells) => {
        let end = cells.length;
        while (end && !cells[end - 1]) end--;
        const line = cells.slice(0, end).join("\t");
        budget -= line.length + 1;
        if (budget < 0) throw Error("Spreadsheet text exceeds the extraction budget.");
        return line;
      })
      .filter((line) => line.trim());
    const text = lines.length ? `${name}\n\n${lines.join("\n")}` : name;
    return { path: [name], slug: slug(name), text, start: 1, end: textLines(text).length };
  });
  return { kind: "spreadsheet", sections };
}
/** XLSX columns end at XFD (16384); a reference beyond it is not a valid cell. */
const MAX_COLUMNS = 16384;
const column = (ref: string | null) => {
  const letters = /^[A-Z]+/i.exec(ref ?? "")?.[0]?.toUpperCase() ?? "";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
    if (index > MAX_COLUMNS) throw Error("Cell column outside the sheet.");
  }
  return index - 1;
};
function workbook(archive: Unzipped): Extraction {
  const main = mainPart(archive, "xl/workbook.xml");
  const rels = relationships(archive, main);
  const sharedTarget =
    [...rels.values()].find((r) => r.type.endsWith("/sharedStrings"))?.target ?? "xl/sharedStrings.xml";
  const shared = archive[sharedTarget]
    ? all(xml(part(archive, sharedTarget)), "si").map((si) => all(si, "t").map(textOf).join(""))
    : [];
  const sheets = all(xml(part(archive, main)), "sheet").map((sheet) => {
    const target = rels.get(relationshipId(sheet))?.target;
    if (!target) throw Error("Sheet relationship missing.");
    const rows = all(xml(part(archive, target)), "row").map((row) => {
      const cells: string[] = [];
      let next = 0;
      for (const cell of all(row, "c")) {
        const ref = attribute(cell, "r");
        const at = ref && /^[A-Z]/i.test(ref) ? column(ref) : next;
        if (at >= MAX_COLUMNS) throw Error("Cell column outside the sheet.");
        const type = attribute(cell, "t");
        const value = all(cell, "v")[0];
        const text =
          type === "s"
            ? (shared[Number(value ? textOf(value) : -1)] ?? "")
            : type === "inlineStr"
              ? all(cell, "t").map(textOf).join("")
              : type === "b"
                ? value && textOf(value) === "1"
                  ? "TRUE"
                  : "FALSE"
                : value
                  ? textOf(value)
                  : "";
        next = at + 1;
        // Empty cells add no text, so a row is padded only up to its last cell with a value.
        if (!text) continue;
        while (cells.length < at) cells.push("");
        cells[at] = text;
      }
      return cells;
    });
    return { name: attribute(sheet, "name") ?? "Sheet", rows };
  });
  return sheetSections(sheets);
}
/** ODF repeats empty rows and columns to the sheet edge; only repeats before real content expand. */
const REPEAT_CAP = 1000;
/** A positive whole repeat count up to REPEAT_CAP; a malformed count repeats once. */
const repeats = (value: string | null) => {
  const count = Number(value ?? 1);
  return Number.isInteger(count) && count > 0 ? Math.min(REPEAT_CAP, count) : 1;
};
function openDocumentSheets(archive: Unzipped): Extraction {
  const sheets = all(xml(part(archive, "content.xml")), "table").map((table) => {
    const rows: string[][] = [];
    for (const row of all(table, "table-row")) {
      const cells: string[] = [];
      let pending = 0;
      for (const cell of children(row).filter(isElement)) {
        if (cell.localName !== "table-cell" && cell.localName !== "covered-table-cell") continue;
        const repeat = repeats(attribute(cell, "number-columns-repeated"));
        const kind = attribute(cell, "value-type");
        const value =
          kind === "float" || kind === "percentage" || kind === "currency"
            ? (attribute(cell, "value") ?? "")
            : kind === "date"
              ? (attribute(cell, "date-value") ?? "")
              : kind === "boolean"
                ? (attribute(cell, "boolean-value") ?? "")
                : paragraphs(cell).map(odfText).join("\n");
        if (!value) {
          pending += repeat;
          continue;
        }
        if (cells.length + pending + repeat > MAX_COLUMNS) throw Error("Cell column outside the sheet.");
        for (; pending > 0; pending--) cells.push("");
        for (let n = 0; n < repeat; n++) cells.push(value);
      }
      if (!cells.length) continue;
      const repeat = repeats(attribute(row, "number-rows-repeated"));
      for (let n = 0; n < repeat; n++) rows.push(cells);
    }
    return { name: attribute(table, "name") ?? "Sheet", rows };
  });
  if (!sheets.length) throw Error("Spreadsheet has no sheets.");
  return sheetSections(sheets);
}

/** Text structure of a modern office document: headings, slides or sheets. */
export async function extractOffice(
  format: OfficeFormat,
  bytes: Uint8Array,
  limits: OfficeLimits = OFFICE_LIMITS,
): Promise<Extraction> {
  const archive = openArchive(bytes, limits);
  switch (format) {
    case "docx":
      return word(archive);
    case "odt":
      return openDocumentText(archive);
    case "pptx":
      return presentation(archive);
    case "odp":
      return openDocumentPresentation(archive);
    case "xlsx":
      return workbook(archive);
    case "ods":
      return openDocumentSheets(archive);
  }
}
