import { read } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { parentPort } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OfficeFormat } from "./office-format.js";
import type { OpenPdfFile } from "./worker-host.js";

const assets = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
// Far above a large manual (thousands of pages); the text stays within the 128 MiB extraction cache.
const MAX_PAGES = 50_000;
const MAX_CHARS = 32 * 1024 * 1024;

/** pdf.js' Node parser executes solely in this host-owned dedicated thread. */
async function extract(bytes: Uint8Array, countOnly = false): Promise<void> {
  const loading = getDocument({
    data: bytes,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableFontFace: true,
    standardFontDataUrl: `${join(assets, "standard_fonts").replaceAll("\\", "/")}/`,
    cMapUrl: `${join(assets, "cmaps").replaceAll("\\", "/")}/`,
    wasmUrl: `${join(assets, "wasm").replaceAll("\\", "/")}/`,
  });
  try {
    const pdf = await loading.promise;
    const pages: string[] = [];
    let pagesRead = 0;
    // Past a cap the pages read so far are indexed; the later ones are absent, not an error.
    const count = Math.min(pdf.numPages, MAX_PAGES);
    for (let n = 1, chars = 0; n <= count && chars < MAX_CHARS; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let text = "",
        previousY: number | undefined,
        previousHeight = 0;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = item.transform[5] as number;
        // A subscript, superscript or font change moves the baseline by a fraction of the line (V_DD, I²C)
        // and stays on its line; only a move of more than half a line height starts a new one. pdf.js
        // emits the spaces between words itself, so none is added between items of one line.
        const moved = previousY === undefined ? 0 : Math.abs(y - previousY);
        if (moved > Math.max(previousHeight * 1.7, 18)) text += "\n\n";
        else if (moved > Math.max(previousHeight, item.height, 1) * 0.5 && !text.endsWith("\n")) text += "\n";
        text += item.str;
        if (item.hasEOL) text += "\n";
        previousY = y;
        previousHeight = item.height;
      }
      pagesRead++;
      if (!countOnly) pages.push(text.trim());
      chars += text.length;
      page.cleanup();
    }
    parentPort?.postMessage(countOnly ? pagesRead : { kind: "pdf", pages });
  } catch {
    parentPort?.postMessage({ error: "PROCESSING" });
  } finally {
    await loading.destroy();
  }
}

async function countFile(file: OpenPdfFile): Promise<void> {
  const readAt = promisify(read);
  try {
    const bytes = new Uint8Array(file.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await readAt(file.fd, bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw Error("Incomplete PDF file.");
      offset += bytesRead;
    }
    await extract(bytes, true);
  } catch {
    parentPort?.postMessage({ error: "PROCESSING" });
  }
}
/**
 * Office containers share this host-owned thread: one request per disposable worker. The parsers
 * load only for office requests, so PDF jobs keep a small worker with no relative imports.
 */
async function office(format: OfficeFormat, bytes: Uint8Array): Promise<void> {
  const { OfficeLimitError } = await import("./office-format.js");
  try {
    const { extractOffice } = await import("./office.js");
    parentPort?.postMessage(await extractOffice(format, bytes));
  } catch (error) {
    parentPort?.postMessage({ error: error instanceof OfficeLimitError ? "SIZE_LIMIT" : "PROCESSING" });
  }
}
parentPort?.once(
  "message",
  (message: Uint8Array | { format: OfficeFormat; bytes: Uint8Array } | { file: OpenPdfFile }) => {
    if (message instanceof Uint8Array) void extract(message);
    else if ("file" in message) void countFile(message.file);
    else void office(message.format, message.bytes);
  },
);
