import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const names = ["datasheet", "reference-manual", "application-note"];
/** PDFKit's document ID is derived from the fixed info/date, so regeneration is reproducible. */
export function renderMarkdownPdf(markdown, output, title) {
  return new Promise((resolvePromise, reject) => {
    const document = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: title,
        Author: "VERA fictional board fixtures",
        CreationDate: new Date("2026-01-01T00:00:00Z"),
        ModDate: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const stream = createWriteStream(output);
    stream.on("finish", () => resolvePromise(output));
    stream.on("error", reject);
    document.on("error", reject);
    document.pipe(stream);
    for (const paragraph of markdown.trim().split(/\n\s*\n/)) {
      if (paragraph === "<!-- page -->") {
        document.addPage();
        continue;
      }
      const heading = /^(#{1,6})\s+(.+)$/.exec(paragraph);
      document
        .font(heading ? "Helvetica-Bold" : "Helvetica")
        .fontSize(heading ? 20 - heading[1].length * 2 : 11)
        .text(heading ? heading[2] : paragraph.replaceAll("`", ""), { lineGap: 3 });
      document.moveDown(0.7);
    }
    document.end();
  });
}
export async function makeDemoPdfs(destination = join(root, "fixtures/workbenches/demo-board/docs")) {
  await mkdir(destination, { recursive: true });
  const paths = [];
  for (const name of names) {
    const markdown = await readFile(
      join(root, "fixtures/workbenches/demo-board/sources", `${name}.md`),
      "utf8",
    );
    paths.push(
      await renderMarkdownPdf(
        markdown,
        join(destination, `vera-demo-01-${name}.pdf`),
        `VERA-DEMO-01 ${name}`,
      ),
    );
  }
  return paths;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const path of await makeDemoPdfs()) process.stdout.write(`${path}\n`);
}
