# Document extraction and chunks

## Routing

Select for supported text/PDF/office extraction, OCR classification, physical
line, heading or page/slide chunk locators, office archive limits, the extraction
cache and demo PDFs. Start at core knowledge/processor.ts; pure extraction/chunk
tests are extraction.test.ts and office.test.ts, real worker/cache/ingest tests
processor.test.ts. Queue/discovery/ownership and extension-to-kind mapping route
to [knowledge ingest](knowledge-ingest.md); SQLite to
[workbench storage](workbench-storage.md). Model/retrieval comparison routes to
[retrieval evaluation](retrieval-evaluation.md). ADR0015 selects the existing BGE
tokenizer, with an empty passage prefix; query instructions live in the model
descriptor.

## Purpose and boundaries

Core processors verify a source, extract it (or read the cache) and return
chunks, status, an optional page/slide count and optional local vectors to the
owned ingest queue, which commits metadata, chunks, full extraction and vectors in
one transaction before events. Desktop and CLI supply independently bundled
document workers that parse PDFs and office files off the main thread. Demo
generation supplies fictional board documents for document and retrieval tests.

## Public interface

- `createDocumentProcessor(pdf, embeddings?, office?)` accepts DocumentInput with
  current root/path/kind/hash, AbortSignal and ownership callback; returns typed
  status, `pages` (PDF pages or presentation slides) and chunks. It verifies the
  ordinary input, size, identity and hash before using the version1 extraction
  cache. Without an `office` extractor (tests, tools) office files are parsed
  in-process through a dynamic import of office.ts.
- `createPdfExtractor(entry, deadlineMs=120000)` and
  `createOfficeExtractor(entry, deadlineMs=120000)` run one disposable Node thread
  per call on the same worker entry; abort, deadline, invalid response, crash and
  early exit settle after termination. A `Uint8Array` message is a PDF (pdf.js
  getTextContent per page with installed font/CMap/WASM assets); `{format, bytes}`
  is an office file, answered with an extraction or `{error: "SIZE_LIMIT" |
  "PROCESSING"}`.
- `extractOffice(format, bytes, limits?)` (office.ts) and `officeFormat(path)`,
  `isOfficeOwnerFile(path)`, `OFFICE_LIMITS`, `OfficeLimitError` (office-format.ts):
  - docx: mammoth HTML from an XML-only re-zip, then extractHtml; odt: content.xml
    `text:h` outline levels as headings. Both yield kind `document`, with text
    before the first heading in a leading untitled section.
  - pptx: slide order from presentation.xml relationships, `a:p` paragraphs per
    slide including tables; odp: `draw:page` order. Speaker notes are never read.
    Kind `presentation` with `slides`.
  - xlsx: workbook sheet order, shared/inline strings, values and cached formula
    results; ods: table rows with bounded repeats. Kind `spreadsheet`, one section
    per sheet titled by its name, non-empty rows with tab-separated cells.
- extractMarkdown uses CommonMark headings, ancestor paths, collision-safe slugs
  and original physical lines. extractHtml uses a parsed tree with decoded
  entities, block breaks and h1–h6 headings. extractText retains physical lines.
- chunkDocument packs page, slide and heading paragraphs, splitting oversized text
  safely; text windows contain 60 lines/advance 50 and CSV repeats the original
  header. locator_json stores page (PDF page or slide number), heading path/slug
  (Markdown line range), or line range.
- `npm run make:demo-pdfs` renders three Markdown sources to demo-board/docs, and
  `node scripts/make-office-fixtures.mjs` writes the deterministic office fixtures.

## Invariants

- PDF chunks stay within one page, presentation chunks within one slide, heading
  chunks within one section. Average trimmed PDF text below 20 characters/page
  yields needs_ocr/zero chunks.
- Each chunk is at most 1400 UTF16 characters and below 512 tokens including
  special tokens, measured with the packaged BGE tokenizer snapshot. Full heading
  prefixes and verbatim CSV headers count toward both budgets; overflowing
  prefixes fail processing. Any tokenizer/passage-prefix change requires
  rechunking before embedding intake.
- Office archives are refused before any entry is inflated, at the first central
  directory entry beyond 10000 entries or 500 MB uncompressed (a zip64 record may
  declare billions); that refusal is status failed/SIZE_LIMIT. Only XML,
  relationship and mimetype parts are inflated. Corrupt, incomplete or encrypted
  files, XLSX or ODS cells beyond column XFD (16384) and workbooks producing more than 32 Mi
  characters of sheet text throw and become failed/PROCESSING. Office workers run
  with a 2048 MB old-generation heap ceiling (OFFICE_WORKER_LIMITS). Office sources
  share the PDF byte cap and are never decoded as text.
- Sheets never pad empty cells beyond a row's last value; ODS repeat counts are
  positive integers capped at 1000, and a malformed count repeats once.
- ODF tabs, line breaks and repeated spaces and DrawingML `a:br` become text;
  annotations, tracked deletions and speaker notes are never extracted. `~$`
  owner (lock) files are not office documents.
- The office parsers (mammoth, fflate, xmldom) load only in the worker's office
  path or the in-process fallback, so the main process and PDF jobs never load them.
- Sources and cache ancestors refuse links/junctions; cache files also refuse
  hardlinks. Reads are bounded; cache JSON is version/kind/hash/schema validated.
  Malformed/incompatible entries regenerate from verified bytes.
- Cache lives at .vera/cache/extract/<sha256>.json, keyed by kind. Exclusive
  temporary writes publish atomically under abort/ownership checks (in the desktop
  [indexer process](indexer-process.md) the check is cancellation, best effort); owned
  temporary files are cleaned on failure. Content-addressed extraction survives
  reindex; SQLite derived state follows source invalidation.
- `workbench.embeddings` chunkSize (200–1400) and overlap (0–600, smaller than
  size) reach the processor from ingest; effective overlap is capped at half the
  actual fragment, and changed parameters rebuild chunks without source edits.
- Core imports its own dependencies and shared; Electron remains host-only.
  The SQLite schema belongs to [workbench storage](workbench-storage.md).

## Change map

| Change | Start | Focused verification |
|---|---|---|
| headings/HTML/UTF8 | extraction.ts | extraction.test.ts |
| office formats/limits | office.ts, office-format.ts | office.test.ts, ingest.test.ts |
| chunk budgets/locators/windows | chunk.ts | extraction.test.ts, chunk-settings.test.ts |
| cache/hash/failures/lifecycle | processor.ts | processor.test.ts, ingest.test.ts |
| PDF/office worker host | pdf-worker.ts, worker-host.ts | processor.test.ts, document-hosts.test.ts |
| host wiring/build | host document-processor/pdf-worker entries; desktop indexer-process entry | native ingest.spec.ts, office-documents.spec.ts, indexer.spec.ts |
| demo documents | scripts/make-demo-pdfs.mjs, demo sources | demo-documents.test.ts, processor demo extraction |

## Key behaviors

- REQ-FUNC-e78b18ad — supported extraction and precise chunks/OCR.
- REQ-DATA-3898aa21 — confined extraction cache and current-source atomic publication.
- REQ-TEST-3ded3b59 — reproducible fictional board PDF documents.
- REQ-FUNC-58cba7fd — Word and OpenDocument text extracted by heading.
- REQ-FUNC-bc730650 — presentations extracted slide by slide without notes.
- REQ-FUNC-81dbc6fc — spreadsheets extracted sheet by sheet.
- REQ-SEC-58c879e8 — office archives beyond the limits refused before inflating.
- REQ-REL-7a48f161 — one unreadable office file fails without stopping ingest.

## Files

- core/src/knowledge/{extraction,chunk,token-budget,processor}.ts — extraction, chunks, cache.
- core/src/knowledge/{pdf-worker,worker-host}.ts — document worker and thread hosts.
- core/src/knowledge/office.ts, office-format.ts, xmldom.d.ts — office parsing, light helpers, parser typings.
- core/src/knowledge/{extraction,office,processor,ingest,chunk-settings}.test.ts — fixtures and lifecycle.
- src/apps/{cli/src,desktop/src/main}/{document-processor,pdf-worker}.ts — host composition; the
  desktop composes them inside main/indexer-process.ts (TASK-f09609fd).
- tests/integration/document-hosts.test.ts, tests/tooling/demo-documents.test.ts; tests/e2e/{ingest,office-documents}.spec.ts — compiled/native proof.
- scripts/make-demo-pdfs.mjs, scripts/make-office-fixtures.mjs; tests/fixtures/{documents,documents/office,workbenches/demo-board} — fixtures and demo assets.

Tokenizer JSON/configuration are a semantic snapshot of the packaged
Xenova/bge-small-en-v1.5 assets at revision
`ea104dacec62c0de699686887e3f920caeb4f3e3`, MIT license, with original hashes in
src/models/model-manifest.json. No ONNX/model runtime is used by chunking.
