import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chunkDocument } from "../../packages/core/src/knowledge/chunk.ts";
import { extractMarkdown, extractText } from "../../packages/core/src/knowledge/extraction.ts";
import { createPdfExtractor } from "../../packages/core/src/knowledge/worker-host.ts";

export async function loadCorpus(workbench, worker) {
  const paths = [
    "docs/vera-demo-01-datasheet.pdf",
    "docs/vera-demo-01-reference-manual.pdf",
    "docs/vera-demo-01-application-note.pdf",
    "docs/notes/bringup.md",
    "docs/pinout.csv",
    "logs/boot-0412.log",
    "board.txt",
  ];
  const pdf = createPdfExtractor(worker);
  const chunks = [],
    sources = [];
  for (const path of paths) {
    const bytes = await readFile(join(workbench, path));
    sources.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    const extraction = path.endsWith(".pdf")
      ? await pdf(new Uint8Array(bytes), new AbortController().signal)
      : path.endsWith(".md")
        ? extractMarkdown(bytes.toString("utf8"))
        : extractText(bytes.toString("utf8"));
    for (const chunk of chunkDocument(extraction, path.endsWith(".csv")))
      chunks.push({ id: chunks.length + 1, path, ...chunk });
  }
  return { sources, chunks };
}
