import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parentPort } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OfficeFormat } from "./office-format.js";

const assets = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
// Far above a large manual (thousands of pages); the text stays within the 128 MiB extraction cache.
const MAX_PAGES = 50_000;
const MAX_CHARS = 32 * 1024 * 1024;

/** pdf.js' Node parser executes solely in this host-owned dedicated thread. */
async function extract(bytes: Uint8Array): Promise<void> {
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
        if (previousY !== undefined && Math.abs(y - previousY) > Math.max(previousHeight * 1.7, 18))
          text += "\n\n";
        else if (previousY !== undefined && y !== previousY && !text.endsWith("\n")) text += "\n";
        else if (text && !text.endsWith("\n") && !text.endsWith(" ")) text += " ";
        text += item.str;
        if (item.hasEOL) text += "\n";
        previousY = y;
        previousHeight = item.height;
      }
      pages.push(text.trim());
      chars += text.length;
      page.cleanup();
    }
    parentPort?.postMessage({ kind: "pdf", pages });
  } catch {
    parentPort?.postMessage({ error: "PROCESSING" });
  } finally {
    await loading.destroy();
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
parentPort?.once("message", (message: Uint8Array | { format: OfficeFormat; bytes: Uint8Array }) => {
  if (message instanceof Uint8Array) void extract(message);
  else void office(message.format, message.bytes);
});
