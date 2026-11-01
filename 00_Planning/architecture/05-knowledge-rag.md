# 05 — Knowledge: ingest, index, search, citations

> Describes the implementation as of 2026-11-01 (branch `master`, commit 33e72b8 plus working tree).
> Code under `05_Software/src` is the source of truth; items marked "Not implemented as of
> 2026-11-01" are still open.

PURPOSE: specify how workbench documents become searchable — extraction, chunking, the keyword and
vector index, hybrid search, the `search_docs` and `read_doc` tools, citation references, viewer
anchors and the retrieval evaluation.
DONE-WHEN (for M3): the retrieval evaluation in §8 passes, and every `search_docs` result opens at the
cited place in the document viewer.

## 1. Pipeline

```
chokidar on the literal docs.include prefixes + .vera/workbench.yaml + .vera/.veraignore
  any relevant event → debounce 1 s → reconcile the whole selection (one serial queue):
  select    include − exclude − .veraignore − .vera/.git/node_modules; document kinds only;
            ordinary files, no links                               → index.volume {files, bytes}
  deselected rows → deleted with chunks, FTS rows, embeddings      → index.document {document: null}
  per path: size over the kind's limit → unsupported SIZE_LIMIT
            streamed SHA-256 (+ binary sniff for text kinds)
            same hash and kind, not failed, every chunk embedded with the current model → skip
            binary text file → unsupported BINARY
            pending → extract (cache .vera/cache/extract/<sha256>.json) → chunk → embed (batches of 32)
            source unchanged since hashing → one transaction: document row, chunks (FTS by trigger),
            embeddings, full extraction                            → index.document
  after each file                                                  → index.progress {pending, done, failed}
```

- Runs only for a writable workbench, from `workbench.open`; a read-only workbench searches its
  existing index.
- Selection, hashing, extraction, chunking and embeddings run in the **VERA Indexer** Electron utility
  process; main keeps every SQLite write. A crash fails the calls in flight as retryable and restarts
  the process; three crashes within 60 s stop it (`indexer.status` event) until `indexer.restart`.
- `docs.reindex` deletes every document row and reconciles again; the extraction cache is reused. A
  change of the workbench `embeddings` settings (model, chunk size, overlap) does the same on the next
  pass (`meta.indexing_config`).
- A file that changes while it is processed is retried on the next pass; nothing partial is stored.
- Statuses `pending | indexed | failed | unsupported | needs_ocr`; reasons `SIZE_LIMIT |
  TYPE_UNSUPPORTED | BINARY | IO | PROCESSING | NEEDS_OCR`.
- Size limits: PDF and Office 100 MiB, Markdown, HTML and text 20 MiB; larger files become
  `unsupported` / `SIZE_LIMIT`. Above 2 000 selected files or 2 GiB of source the Docs panel and
  the workbench form's Documents section warn; indexing continues.

## 2. Extraction

| Kind | Extensions | Method | Locator |
|---|---|---|---|
| `pdf` | `.pdf` | pdfjs-dist `getTextContent` per page in a disposable worker thread (120 s deadline); line and paragraph breaks from text positions | page |
| `markdown` | `.md`, `.markdown` | strict UTF-8; CommonMark heading tree (mdast) → sections | heading path + slug, lines |
| `html` | `.html`, `.htm` | parse5, nothing fetched; visible block text, `script`/`style`/`template`/`head` dropped; `h1`–`h6` → sections | heading path + slug |
| `text` | `.txt`, `.csv`, `.tsv` | strict UTF-8 lines | lines |
| `document` | `.docx`, `.odt` | DOCX through mammoth to HTML, ODT XML to HTML, then the HTML sectioning; images not read | heading path + slug |
| `presentation` | `.pptx`, `.odp` | slide text in deck order; speaker notes not read | page (= slide) |
| `spreadsheet` | `.xlsx`, `.ods` | one section per sheet: sheet name, then non-empty rows as tab-separated cells | heading (sheet) |
| other | code, logs, JSON/YAML/XML, `.doc`/`.xls`/`.ppt`, RTF and the rest | not selected and not recorded; still readable by `read` and `grep` | — |

- A PDF that averages fewer than 20 non-blank characters per page is `needs_ocr` and gets no chunks; it
  still opens in the viewer. OCR is outside 1.0.
- A text-kind file that is not valid UTF-8 fails with `PROCESSING`.
- Office files are zip archives: more than 10 000 entries or 500 MiB uncompressed fails with
  `SIZE_LIMIT` before anything is inflated; only XML parts are inflated; a sheet's text is capped at
  32 Mi characters; the Office parser runs in the PDF worker entry with a 2 GiB heap limit. Owner
  files `~$*` are skipped.
- The extraction is cached as `{version: 1, sha256, extraction}` (≤ 128 MiB, written atomically,
  ignored when malformed) and also stored in full in `document_extractions`, which `read_doc` and the
  viewer use.

## 3. Chunking

| Kind | Rule | Locator |
|---|---|---|
| `pdf`, `presentation` | split per page or slide; chunks never cross pages | page |
| `markdown`, `html`, `document`, `spreadsheet` | split per section; the heading path (`A > B`) prefixes every chunk | heading (Markdown also start/end lines) |
| `text` | the whole file split by the budget; `.csv` chunks repeat the header row (`.tsv` does not) | lines |

- Budget per chunk: at most `embeddings.chunkSize` characters (default 1 400, range 200–1 400),
  prefix included, and fewer than 512 tokens counted with the bundled BGE tokenizer. Splits prefer a
  blank line, then a space, and never break a surrogate pair.
- Overlap: `embeddings.overlap` characters (default 200, range 0–600, below `chunkSize`), at most half
  of the previous chunk.
- Without workbench settings (tests, the evaluation in §8) the overlap is 0 and text is cut into
  60-line windows that overlap by 10 lines.

## 4. Embeddings

- Model `Xenova/bge-small-en-v1.5`, revision `ea104dac…`, q8 ONNX (`model_quantized.onnx`, 34 MB), 384
  dimensions, CLS pooling, normalised, 512 tokens. Query prefix `Represent this sentence for searching
  relevant passages: `; passage prefix empty. WP-24 chose it over `multilingual-e5-small`
  (ADR-0015). The workbench `embeddings.model` accepts only this id.
- `@huggingface/transformers` 4.3.1 on onnxruntime-node 1.30.0, CPU, one thread, in a worker thread
  inside the indexer process; one persistent worker per workbench, requests serial with a 120 s
  deadline. `allowRemoteModels = false`, `local_files_only`, `fetch` replaced by a throwing stub,
  every model file checked against `model-manifest.json` (size and SHA-256) before loading, ORT
  telemetry off.
- Models load from `<resources>/models/` with `<resources>/model-manifest.json` when packaged, from
  `src/models/` in development (L5).
- An input of 512 tokens or more, prefix included, is rejected rather than truncated.
- Vectors are L2-normalised float32 BLOBs stored with a model id
  `<modelId>@<revision>:<sha256 of dtype, descriptor and files>`; a document whose chunks lack vectors
  for the current id is processed again.

## 5. Index (SQLite)

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'");
CREATE VIRTUAL TABLE chunks_tri USING fts5(text, content='chunks', content_rowid='id',
  tokenize = 'trigram');              -- fragments of part numbers and register names
CREATE TABLE embeddings(chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL, dim INTEGER NOT NULL CHECK(dim=384),
  vector BLOB NOT NULL CHECK(length(vector)=dim*4));
CREATE TABLE document_extractions(doc_id INTEGER PRIMARY KEY REFERENCES documents(id)
  ON DELETE CASCADE, extraction_json TEXT NOT NULL);
```

- Triggers on `chunks` keep both FTS tables current. Triggers on `chunks` and `embeddings` bump
  `meta.embedding_epoch`, which keys the vector cache and makes a search that overlaps an index change
  fail with "Retry".
- Electronics documents are full of identifiers (`STM32G431`, `I2C1_CR1`, `0x40005400`, `PA5`). The
  word index finds whole tokens; the trigram index finds fragments of them.
- Vector search is brute force in the workbench's embedding worker: main reads the current model's
  vectors once per epoch, model and `pathGlob`, and the worker keeps them as `Float32Array`s.
  50 000 chunks × 384 dimensions are about 77 MB.

## 6. Search and the document tools

```
search(query ≤ 1 000 chars, k = retrieval.results (8), mode = retrieval.mode (hybrid), pathGlob?)
  candidates: chunks of indexed documents whose path matches pathGlob (root-relative)
  keyword:  distinct letter/digit/_ terms of the query, quoted and OR-ed
            chunks_fts MATCH ranked by bm25, top 50
            + chunks_tri for terms of 3+ characters that contain a digit or '_', top 50,
              fused with the word list by RRF; score = −bm25
  semantic: query (with its prefix) · every vector = cosine, top 50
  hybrid:   reciprocal rank fusion of keyword and semantic, score = Σ 1 / (60 + rank), top 50
  → first k whose file still exists: { ref, path, locator, snippet, score }
    snippet = 300 characters from 80 before the first query term found in the chunk
```

- `search_docs` returns `{results, message?}`. With nothing indexed the message suggests `grep`; a
  `pathGlob` that matches no indexed document gets a message explaining root-relative globs. Semantic
  and hybrid without current-model vectors fail with advice to reindex or use keyword/`grep`.
- `k` (1–20) and `mode` default to the workbench `retrieval` settings (8, `hybrid`).
- The Docs panel search (`docs.search`) is keyword mode with k = 20 and drops hits whose locator no
  longer fits the current source.
- `read_doc` takes `path` and one locator family: `page`/`pageEnd` (PDF pages, presentation slides),
  `heading` slug and `part` (Markdown, HTML, document, spreadsheet; `""` is the text before the first
  heading; default the first section), or `lineStart`/`lineEnd` (text; default to the end). Mixing
  families is an error that names the right one.
- `read_doc` reads the stored extraction of an `indexed` document after checking the source's SHA-256.
  It returns `{path, text, truncated, ref}` within 12 000 characters (and 28 000 characters of JSON):
  whole pages, slides or lines up to the budget, `truncated` when the range was cut, and a `ref` for
  exactly what it returned. A long section comes in `parts` (`part`, `parts`), cut at line ends; every
  part cites the whole section.
- The agent writes its own queries. The system prompt asks for `search_docs` first and for English
  terms over English documents (03 §3), so the English-only model can still serve a Romanian
  conversation.

## 7. References

| Target | Format | Example |
|---|---|---|
| PDF page, presentation slide | `<path>#p=<n>` | `docs/stm32g4-ds.pdf#p=45` |
| Page or slide range | `<path>#p=<n>-<m>` | `docs/stm32g4-rm.pdf#p=1203-1204` |
| Section (Markdown, HTML, document heading, spreadsheet sheet) | `<path>#h=<slug>` | `docs/bringup.md#h=power-sequence` |
| Text before the first heading (not Markdown) | `<path>#h=` | `docs/spec.docx#h=` |
| Line range (text documents, Markdown preamble, `read`/`grep` results) | `<path>#L<a>-L<b>` | `logs/boot-0412.log#L118-L131` |
| Session artifact | `artifact:<name>` | `artifact:i2c-summary.md` |

- The model cites as `[[docs/stm32g4-ds.pdf#p=45]]`. Parser, formatter and chip label
  (`stm32g4-ds.pdf p45`): `src/libraries/shared/src/refs.ts`.
- Slugs: lower case, letters, digits, `_`, `-`; spaces become `-`; an empty title becomes `section`;
  repeats get `-1`, `-2`.
- A citation is valid when that exact ref came in a `ref` field of a successful tool result earlier in
  the session, and: the artifact exists in the session; or the line range is within the file's current
  line count; or the document is `indexed`, its source hash unchanged, the locator family fits its kind,
  and the page or slide is within range or the slug exists. Invalid citations show as warning chips
  (06 §3).

## 8. Retrieval evaluation

- `tests/fixtures/retrieval/demo-board.yaml` holds 28 questions, 14 English and 14 Romanian in pairs,
  each with the expected `path` and `page` (26) or `heading` (2), over
  `tests/fixtures/workbenches/demo-board/`.
- `npm run eval:retrieval` builds the corpus (three demo PDFs, `docs/notes/bringup.md`,
  `docs/pinout.csv`, `logs/boot-0412.log`, `board.txt`) with the product's extractors and chunker,
  searches it through the product search service with k = 20, and reports recall@5 for `keyword`,
  `semantic` and `hybrid`, overall and per language. It exits non-zero unless hybrid recall@5 is at
  least 0.85 overall, 0.95 English and 0.75 Romanian (ADR-0015). It never downloads the model.
- The corpus uses the chunker without workbench settings (§3), and includes a log and `board.txt` that
  product ingest does not index by default, so it measures retrieval, not the default ingest
  configuration.
- The demo documents are written or generated for VERA, around the fictional board VERA-DEMO-01.

## 9. Viewer anchors

A ref opens in the document viewer (06 §5) after the source hash is checked against the index:

- PDF: rendered by pdf.js at the cited page, the snippet highlighted on the cited pages, with page
  navigation, zoom, in-document search and the extracted page text.
- Markdown sections rendered as Markdown, HTML, document and spreadsheet sections as plain text,
  scrolled to the heading; presentations as a slide list scrolled to the slide.
- Text: a 250-line window with the cited lines marked. Line refs also open text files that are not
  indexed.
- Supported document types can also be opened in the operating system's default application.

NOTES:
- Deferred: OCR, tables as structured data, images inside PDFs and Office files, legacy binary Office
  (`.doc`, `.xls`, `.ppt`) and RTF, provider-side embeddings.
- Not implemented as of 2026-11-01: pruning of `.vera/cache/extract/`; sqlite-vec or int8 vectors
  (revisit above about 200 000 chunks).
- Indexed types are deliberately narrow: code, logs and data files are read with `read` and `grep`,
  not indexed (TASK-e5310cdb, RULING-005).
- Work packages cite this file as `05 §n`.
