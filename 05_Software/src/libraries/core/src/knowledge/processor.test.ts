import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { existsSync, readdirSync } from "node:fs";
import { link, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { workbenchSchema } from "@vera/shared";
import { build } from "esbuild";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { openDb } from "../storage/db.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { type DocumentInput, Ingester } from "./ingest.js";
import { createDocumentProcessor } from "./processor.js";
import { createOfficeExtractor, createPdfExtractor } from "./worker-host.js";

const software = fileURLToPath(new URL("../../../../../", import.meta.url));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.reverse().splice(0)) await close();
});
async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "vera-extraction-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "docs"));
  await mkdir(join(root, ".vera"));
  return root;
}
async function input(root: string, path: string, bytes: string | Uint8Array): Promise<DocumentInput> {
  await writeFile(join(root, path), bytes);
  return {
    root,
    path,
    kind: path.endsWith(".pdf")
      ? "pdf"
      : path.endsWith(".md")
        ? "markdown"
        : path.endsWith(".html")
          ? "html"
          : "text",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    signal: new AbortController().signal,
    assertWritable: () => {},
  };
}
async function compiledPdf(root: string) {
  const modules = join(root, "node_modules");
  await mkdir(modules);
  await symlink(
    join(software, "node_modules/pdfjs-dist"),
    join(modules, "pdfjs-dist"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const entry = join(root, "pdf-worker.mjs");
  const pdfjs = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.mjs");
  await build({
    entryPoints: [join(software, "src/libraries/core/src/knowledge/pdf-worker.ts")],
    outfile: entry,
    platform: "node",
    format: "esm",
    bundle: true,
    plugins: [
      {
        name: "local-pdfjs",
        setup(build) {
          build.onResolve({ filter: /^pdfjs-dist\// }, () => ({
            path: pathToFileURL(pdfjs).href,
            external: true,
          }));
        },
      },
    ],
    target: "node24",
    // Bundled CommonJS office parsers require Node built-ins from this ESM worker.
    banner: {
      js: 'import { createRequire as bannerRequire } from "node:module"; const require = bannerRequire(import.meta.url);',
    },
  });
  return createPdfExtractor(pathToFileURL(entry));
}
const noPdf = async (): Promise<never> => {
  throw Error("Unexpected PDF extraction.");
};

it("cleans its exclusive temporary cache file when ownership is lost before rename", async () => {
  const root = await fixtureRoot(),
    doc = await input(root, "docs/board.md", "# Board\ncontent");
  const directory = join(root, ".vera/cache/extract");
  await expect(
    createDocumentProcessor(noPdf)({
      ...doc,
      assertWritable: () => {
        if (existsSync(directory) && readdirSync(directory).some((name) => name.endsWith(".tmp")))
          throw Error("owner lost");
      },
    }),
  ).rejects.toThrow(/owner/);
  expect(await readdir(directory)).toEqual([]);
});

it("persists extraction and locators through real ingest, change, deletion and reopen", async () => {
  const root = await fixtureRoot();
  await input(root, "docs/board.md", "# Board\n## Power\n3.3 V supply");
  const handle = await openDb(join(root, ".vera/vera.db"), {
    workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    appVersion: "0.0.0",
  });
  cleanup.push(async () => handle.close());
  const options = {
    root,
    db: handle.db,
    config: () =>
      workbenchSchema.parse({
        format: 1,
        id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
        name: "fixture",
        docs: { include: ["docs/**"], exclude: [] },
      }),
    assertWritable: () => {},
    now: () => new Date(),
    emit: () => {},
    process: createDocumentProcessor(noPdf),
  };
  let ingest = new Ingester(options);
  cleanup.push(async () => ingest.close());
  await ingest.reindex();
  const rows = new DocumentsRepository(handle.db),
    first = rows.get("docs/board.md");
  expect(first).toMatchObject({ status: "indexed", error: null });
  const chunks = () =>
    handle.db.prepare("SELECT ordinal,text,locator_json FROM chunks ORDER BY ordinal").all() as {
      text: string;
      locator_json: string;
    }[];
  expect(chunks().at(-1)).toMatchObject({
    text: expect.stringContaining("3.3 V supply"),
    locator_json: JSON.stringify({
      type: "heading",
      path: ["Board", "Power"],
      slug: "power",
      start: 2,
      end: 3,
    }),
  });
  const previous = chunks();
  await ingest.close();
  ingest = new Ingester(options);
  await ingest.waitIdle();
  expect(chunks()).toEqual(previous);
  await writeFile(join(root, "docs/board.md"), "# Board\n## Clock\n16 MHz oscillator");
  await ingest.reindex();
  expect(rows.get("docs/board.md")?.sha256).not.toBe(first?.sha256);
  expect(
    chunks()
      .map((c) => c.text)
      .join("\n"),
  ).not.toContain("3.3 V");
  expect(chunks().at(-1)?.text).toContain("16 MHz");
  await rm(join(root, "docs/board.md"));
  await ingest.reindex();
  expect(chunks()).toEqual([]);
  expect(rows.get("docs/board.md")).toBeUndefined();
});

it("close aborts a blocked real PDF worker and drains without chunks or cache publication", async () => {
  const root = await fixtureRoot();
  await input(root, "docs/board.pdf", "PDF waiting fixture");
  const entry = join(root, "blocked.mjs"),
    ready = join(root, "ready");
  await writeFile(
    entry,
    `import {parentPort} from 'node:worker_threads'; import {writeFileSync} from 'node:fs'; parentPort.once('message', () => {writeFileSync(${JSON.stringify(ready)}, 'ready');setInterval(()=>{},1000);});`,
  );
  const handle = await openDb(join(root, ".vera/vera.db"), {
    workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    appVersion: "0.0.0",
  });
  cleanup.push(async () => handle.close());
  const ingest = new Ingester({
    root,
    db: handle.db,
    config: () =>
      workbenchSchema.parse({
        format: 1,
        id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
        name: "fixture",
        docs: { include: ["docs/**"], exclude: [] },
      }),
    assertWritable: () => {},
    now: () => new Date(),
    emit: () => {},
    process: createDocumentProcessor(createPdfExtractor(pathToFileURL(entry))),
  });
  cleanup.push(() => ingest.close());
  const completion = ingest.reindex();
  await expect.poll(() => existsSync(ready)).toBe(true);
  await ingest.close();
  await completion;
  expect(handle.db.prepare("SELECT * FROM chunks").all()).toEqual([]);
  expect(existsSync(join(root, ".vera/cache"))).toBe(false);
});
it("processes every text kind, caches extraction and recovers corrupt/version/kind entries", async () => {
  const root = await fixtureRoot(),
    processDocument = createDocumentProcessor(noPdf);
  for (const name of ["board.md", "board.html", "board.txt", "board.csv"]) {
    const data = name.endsWith(".html") ? "<h1>Board</h1><p>I2C1_CR1</p>" : "# Board\nI2C1_CR1";
    const doc = await input(root, `docs/${name}`, data);
    expect(await processDocument(doc)).toMatchObject({
      status: "indexed",
      chunks: [expect.objectContaining({ text: expect.stringContaining("I2C1_CR1") })],
    });
    const cache = join(root, ".vera/cache/extract", `${doc.sha256}.json`);
    const original = await readFile(cache, "utf8");
    const stat = await import("node:fs/promises").then((fs) => fs.stat(cache));
    expect(await processDocument(doc)).toMatchObject({ status: "indexed" });
    expect((await import("node:fs/promises").then((fs) => fs.stat(cache))).mtimeMs).toBe(stat.mtimeMs);
    for (const corrupt of [
      "{",
      original.replace('"version":1', '"version":99'),
      original.replace('"sha256":"', '"sha256":"00'),
    ]) {
      await writeFile(cache, corrupt);
      expect(await processDocument(doc)).toMatchObject({ status: "indexed" });
      expect(await readFile(cache, "utf8")).toBe(original);
    }
  }
  expect(
    (await readdir(join(root, ".vera/cache/extract"))).every((name) => /^[a-f0-9]{64}\.json$/.test(name)),
  ).toBe(true);
});
it("extracts real multi-page PDFs in a thread; scanned image-only PDF becomes needs_ocr; cache skips worker", async () => {
  const root = await fixtureRoot(),
    realPdf = await compiledPdf(root);
  let calls = 0;
  const processor = createDocumentProcessor(async (bytes, signal) => {
    calls++;
    return realPdf(bytes, signal);
  });
  const bytes = await readFile(join(software, "tests/fixtures/documents/pages.pdf"));
  const doc = await input(root, "docs/board.pdf", bytes);
  const result = await processor(doc);
  expect(result).toMatchObject({ status: "indexed", pages: 2 });
  expect(
    result.chunks
      ?.filter((c) => c.locator.type === "page" && c.locator.page === 1)
      .map((c) => c.text)
      .join(""),
  ).toContain("I2C1_CR1");
  expect(
    result.chunks
      ?.filter((c) => c.locator.type === "page" && c.locator.page === 2)
      .map((c) => c.text)
      .join(""),
  ).toContain("WDG_KR");
  expect(result.chunks?.every((c) => c.locator.type === "page" && c.text.length <= 1400)).toBe(true);
  expect(await processor(doc)).toEqual(result);
  expect(calls).toBe(1);
  const scanned = await input(
    root,
    "docs/scanned.pdf",
    await readFile(join(software, "tests/fixtures/documents/scanned.pdf")),
  );
  expect(await processor(scanned)).toEqual({
    status: "needs_ocr",
    reason: "NEEDS_OCR",
    pages: 1,
    chunks: [],
  });
  await expect(realPdf(new Uint8Array([1, 2, 3]), doc.signal)).rejects.toThrow(/processing/);
  expect(getEventListeners(doc.signal, "abort")).toHaveLength(0);
});
it("extracts the generated demo PDFs with citable board/register facts", async () => {
  const root = await fixtureRoot(),
    pdf = await compiledPdf(root);
  for (const [name, fact] of [
    ["datasheet", "PB6"],
    ["reference-manual", "I2C1_CR1"],
    ["application-note", "0xA1"],
  ]) {
    const doc = await pdf(
      new Uint8Array(
        await readFile(join(software, `tests/fixtures/workbenches/demo-board/docs/vera-demo-01-${name}.pdf`)),
      ),
      new AbortController().signal,
    );
    expect(doc.pages).toHaveLength(2);
    expect(doc.pages.join("\n")).toContain("VERA-DEMO-01");
    expect(doc.pages.join("\n")).toContain(fact);
  }
});
it.each(["abort", "deadline", "exit", "error", "invalid"])(
  "terminates and settles real worker %s, removing listeners",
  async (failure) => {
    const root = await fixtureRoot(),
      entry = join(root, "bad-worker.mjs");
    const code =
      failure === "exit"
        ? "process.exit(0)"
        : failure === "error"
          ? "throw Error('fixture')"
          : failure === "invalid"
            ? "parentPort.postMessage({kind:'pdf',pages:[]})"
            : "setInterval(() => {}, 1000)";
    await writeFile(
      entry,
      `import {parentPort} from 'node:worker_threads'; parentPort.once('message', () => { ${code} });`,
    );
    const controller = new AbortController();
    const task = createPdfExtractor(pathToFileURL(entry), failure === "deadline" ? 100 : 5000)(
      new Uint8Array([1]),
      controller.signal,
    );
    if (failure === "abort") controller.abort();
    await expect(task).rejects.toThrow();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await expect(
      createPdfExtractor(pathToFileURL(join(root, "missing.mjs")))(
        new Uint8Array([1]),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  },
);
it("rejects source hash mismatch, invalid UTF8 and invalid cache keys without cache publication", async () => {
  const root = await fixtureRoot(),
    processor = createDocumentProcessor(noPdf);
  const doc = await input(root, "docs/board.md", "source");
  await writeFile(join(root, doc.path), "changed");
  await expect(processor(doc)).rejects.toThrow(/changed/);
  await expect(processor({ ...doc, sha256: "../escape" })).rejects.toThrow(/key/);
  const binary = await input(root, "docs/bad.txt", new Uint8Array([0xff]));
  await expect(processor(binary)).rejects.toThrow();
  expect(existsSync(join(root, ".vera/cache"))).toBe(false);
});
it.each(["abort", "owner", "source"])(
  "refuses publication after PDF processing loses %s",
  async (failure) => {
    const root = await fixtureRoot(),
      doc = await input(root, "docs/board.pdf", "opaque fixture");
    const controller = new AbortController();
    let owned = true;
    const processor = createDocumentProcessor(async () => {
      if (failure === "abort") controller.abort();
      else if (failure === "owner") owned = false;
      else await writeFile(join(root, doc.path), "new content");
      return { kind: "pdf", pages: ["source page long enough to avoid OCR"] };
    });
    const handle = await openDb(join(root, ".vera/vera.db"), {
      workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      appVersion: "0.0.0",
    });
    cleanup.push(async () => handle.close());
    const assertWritable = () => {
      if (!owned) throw Error("owner lost");
    };
    const ingest = new Ingester({
      root,
      db: handle.db,
      config: () =>
        workbenchSchema.parse({
          format: 1,
          id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
          name: "fixture",
          docs: { include: ["docs/**"], exclude: [] },
        }),
      assertWritable,
      now: () => new Date(),
      emit: () => {},
      process: async (input) => processor({ ...input, signal: controller.signal, assertWritable }),
    });
    cleanup.push(() => ingest.close());
    if (failure === "owner") await expect(ingest.reindex()).rejects.toThrow(/owner/);
    else await ingest.reindex();
    expect(handle.db.prepare("SELECT * FROM chunks").all()).toEqual([]);
    if (failure !== "source") expect(existsSync(join(root, ".vera/cache"))).toBe(false);
  },
);
it("rejects redirected cache directories and hardlinked cache files without touching outside data", async () => {
  const root = await fixtureRoot(),
    doc = await input(root, "docs/board.md", "# Board\ncontent"),
    processor = createDocumentProcessor(noPdf);
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "marker"), "preserve");
  await symlink(outside, join(root, ".vera/cache"), process.platform === "win32" ? "junction" : "dir");
  await expect(processor(doc)).rejects.toThrow(/redirected/);
  expect(await readdir(outside)).toEqual(["marker"]);
  await rm(join(root, ".vera/cache"));
  await processor(doc);
  const cache = join(root, ".vera/cache/extract", `${doc.sha256}.json`),
    saved = await readFile(cache);
  await link(cache, join(outside, "alias"));
  await expect(processor(doc)).rejects.toThrow(/unsafe/);
  expect(await readFile(cache)).toEqual(saved);
});

/** End records only: a zip64 directory at offset 0 that declares 2^32-1 entries. */
function zip64EntryBomb() {
  const bytes = new Uint8Array(56 + 20 + 22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06064b50, true);
  view.setUint32(32, 0xffffffff, true);
  view.setUint32(56, 0x07064b50, true);
  view.setUint32(76, 0x06054b50, true);
  view.setUint16(76 + 8, 0xffff, true);
  view.setUint32(76 + 16, 0xffffffff, true);
  return bytes;
}
// REQ-SEC-58c879e8 REQ-REL-7a48f161 REQ-FUNC-bc730650
it("parses office files in the compiled document worker and maps its limit and parse failures", async () => {
  const root = await fixtureRoot();
  await compiledPdf(root);
  const processor = createDocumentProcessor(
    noPdf,
    undefined,
    createOfficeExtractor(pathToFileURL(join(root, "pdf-worker.mjs")), 5000),
  );
  const office = (name: string) => readFile(join(software, "tests/fixtures/documents/office", name));
  const deck = await processor({
    ...(await input(root, "docs/bringup.pptx", await office("bringup.pptx"))),
    kind: "presentation",
  });
  expect(deck).toMatchObject({ status: "indexed", pages: 2 });
  expect(
    deck.chunks?.some((c) => c.locator.type === "page" && c.locator.page === 2 && c.text.includes("3.29 V")),
  ).toBe(true);
  // The guard stops at the entry limit instead of walking every declared entry until the deadline.
  expect(
    await processor({ ...(await input(root, "docs/bomb.xlsx", zip64EntryBomb())), kind: "spreadsheet" }),
  ).toEqual({ status: "failed", reason: "SIZE_LIMIT" });
  const docx = await office("review.docx");
  await expect(
    processor({
      ...(await input(root, "docs/half.docx", docx.subarray(0, docx.length / 2))),
      kind: "document",
    }),
  ).rejects.toThrow("Office processing failed.");
}, 30000);

// REQ-REL-7a48f161 REQ-FUNC-81dbc6fc
it("extracts malformed repeats and sparse wide rows in a small worker heap without padding blowups", async () => {
  const root = await fixtureRoot();
  await compiledPdf(root);
  // A 256 MB heap fails fast if a sheet pads cells without bound, instead of hanging the test host.
  const processor = createDocumentProcessor(
    noPdf,
    undefined,
    createOfficeExtractor(pathToFileURL(join(root, "pdf-worker.mjs")), 5000, { maxOldGenerationSizeMb: 256 }),
  );
  const ns =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"';
  const ods = zipSync({
    mimetype: [strToU8("application/vnd.oasis.opendocument.spreadsheet"), { level: 0 }],
    "content.xml": strToU8(
      `<office:document-content ${ns}><office:body><office:spreadsheet><table:table table:name="Odd"><table:table-row table:number-rows-repeated="-2"><table:table-cell table:number-columns-repeated="0.5"/><table:table-cell table:number-columns-repeated="-1"/><table:table-cell office:value-type="string"><text:p>kept</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>`,
    ),
  });
  const odd = await processor({ ...(await input(root, "docs/odd.ods", ods)), kind: "spreadsheet" });
  expect(odd).toMatchObject({ status: "indexed" });
  expect(odd.chunks?.map((c) => c.text).join("\n")).toContain("\t\tkept");
  const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const rels = (target: string, type: string) =>
    strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`,
    );
  const empty = Array.from({ length: 20000 }, (_, n) => `<row r="${n + 2}"><c r="XFD${n + 2}"/></row>`).join(
    "",
  );
  const xlsx = zipSync({
    "_rels/.rels": rels("xl/workbook.xml", "officeDocument"),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ${R}><sheets><sheet name="Sparse" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": rels("worksheets/sheet1.xml", "worksheet"),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>only value</t></is></c></row>${empty}</sheetData></worksheet>`,
    ),
  });
  const sparse = await processor({ ...(await input(root, "docs/sparse.xlsx", xlsx)), kind: "spreadsheet" });
  expect(sparse).toMatchObject({ status: "indexed" });
  expect(sparse.chunks?.map((c) => c.text).join("\n")).toContain("only value");
}, 30000);
