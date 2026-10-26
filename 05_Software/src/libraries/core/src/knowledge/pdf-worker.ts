import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parentPort } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const assets = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

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
    for (let n = 1; n <= pdf.numPages; n++) {
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
      page.cleanup();
    }
    parentPort?.postMessage({ kind: "pdf", pages });
  } catch {
    parentPort?.postMessage({ error: "PROCESSING" });
  } finally {
    await loading.destroy();
  }
}
parentPort?.once("message", (bytes: Uint8Array) => {
  void extract(bytes);
});
