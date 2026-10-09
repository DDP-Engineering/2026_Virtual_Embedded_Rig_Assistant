# 05 — Knowledge: ingest, index, search, citations

PURPOSE: specify how workbench documents become searchable — extraction, chunking, the keyword and
vector index, hybrid search, the `search_docs` and `read_doc` tools, citation references, viewer
anchors and the retrieval evaluation.
DONE-WHEN (for M3): the retrieval evaluation in §8 passes, and every `search_docs` result opens at the
cited place in the document viewer.

## 1. Pipeline

```
chokidar on docs.include → debounce 1 s → for each changed path:
  stat + SHA-256 → unchanged hash: skip
  extract (worker) → text + locators → .vera/cache/extract/<sha256>.json
  chunk → chunks rows → FTS rows
  embed (worker, batches of 32) → embeddings rows
  status indexed | failed | unsupported | needs_ocr → WorkbenchEvent index.document
deleted path → delete its document, chunks, FTS rows and embeddings
```

- Starts in the background after `workbench.open`; progress arrives as `index.progress {pending, done, failed}`.
- One ingest queue per workbench; `docs.reindex` clears the index and rebuilds it.
- Size limits: PDF 100 MB, text 20 MB; larger files become `unsupported` with the reason.

## 2. Extraction

| Kind | Extensions | Method | Locator |
|---|---|---|---|
| `pdf` | `.pdf` | pdfjs-dist `getTextContent` per page, in a worker | page |
| `markdown` | `.md`, `.markdown` | UTF-8 text; heading tree parsed | heading path, lines |
| `text` | `.txt`, `.log`, `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`, `.xml`, `.ini`, `.cfg`, `.c`, `.h`, `.py` and similar | UTF-8 decode | lines |
| `html` | `.html`, `.htm` | tags stripped, headings kept | heading path |
| other | — | not indexed (`unsupported`); still readable by `read` when it is text | — |

A PDF that averages fewer than 20 characters of text per page is `needs_ocr`. OCR is outside 1.0.

## 3. Chunking

| Kind | Rule |
|---|---|
| `pdf` | one page per chunk; longer pages split on paragraph breaks; chunks never cross pages |
| `markdown`, `html` | one heading section per chunk; long sections split on paragraphs; the heading path prefixes the chunk text |
| `text` | windows of 60 lines with 10 lines of overlap; CSV windows repeat the header row |

Target about 1 400 characters (about 350 tokens) per chunk, below the embedding model's 512-token limit.

## 4. Embeddings

- `@huggingface/transformers` on the onnxruntime-node backend, in a worker; `env.allowRemoteModels =
  false`; models load from `<resources>/models/` (L5).
- The spike WP-24 chooses between `bge-small-en-v1.5` and `multilingual-e5-small` (both 384
  dimensions) and files the result as an ADR. Model-specific prefixes (`query: `, `passage: `) live in
  the model descriptor, not in calling code.
- Vectors are L2-normalised float32 BLOBs stored with their `model_id`; a different model id triggers
  re-embedding.

## 5. Index (SQLite)

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'");
CREATE VIRTUAL TABLE chunks_tri USING fts5(text, content='chunks', content_rowid='id',
  tokenize = 'trigram');              -- fragments of part numbers and register names; WP-05 verifies
CREATE TABLE embeddings(chunk_id INTEGER PRIMARY KEY, model_id TEXT NOT NULL, dim INTEGER NOT NULL,
  vector BLOB NOT NULL);
```

- Electronics documents are full of identifiers (`STM32G431`, `I2C1_CR1`, `0x40005400`, `PA5`). The
  word index finds whole tokens; the trigram index finds fragments of them.
- Vector search is brute force over an in-memory `Float32Array` in a worker. 50 000 chunks × 384
  dimensions take about 77 MB and answer in tens of milliseconds. Revisit (sqlite-vec, or int8
  vectors) above 200 000 chunks.

## 6. Search and the document tools

```
search(query, k = 8, mode = hybrid, pathGlob?)
  keyword:  chunks_fts MATCH ranked by bm25, top 50
            + chunks_tri for query terms of 3+ characters that contain a digit or '_'
  semantic: cosine similarity against all vectors, top 50
  hybrid:   reciprocal rank fusion, score = Σ 1 / (60 + rank)
  → top k: { ref, path, locator, snippet (≤ 300 characters around the best match), score }
```

- `search_docs` returns that list. When nothing is indexed yet it says so and suggests `grep`.
- `read_doc` returns extracted text for a page range (PDF), a heading section (Markdown, HTML) or a
  line range (text), at most 12 000 characters, with the `ref` of exactly what it returned.
- The agent writes its own queries (03 §3 asks for English search terms over English documents), so
  an English-only embedding model can still serve a Romanian conversation.
- Starting code: BenchPilot's `tools/knowledge.ts` (FTS5 search and document reading).

## 7. References

| Target | Format | Example |
|---|---|---|
| PDF page | `<path>#p=<n>` | `docs/stm32g4-ds.pdf#p=45` |
| PDF page range | `<path>#p=<n>-<m>` | `docs/stm32g4-rm.pdf#p=1203-1204` |
| Markdown or HTML section | `<path>#h=<slug>` | `docs/bringup.md#h=power-sequence` |
| Line range | `<path>#L<a>-L<b>` | `logs/boot-0412.log#L118-L131` |
| Session artifact | `artifact:<name>` | `artifact:i2c-summary.md` |

- The model cites as `[[docs/stm32g4-ds.pdf#p=45]]`. Parser and formatter: `packages/shared/src/refs.ts`,
  starting from BenchPilot's `packages/shared/src/evidence.ts`.
- A ref is valid when the file exists in the workbench (or the artifact in the session) and the
  locator is within range (page count, heading slug, line count).

## 8. Retrieval evaluation

- `fixtures/retrieval/demo-board.yaml` holds 20–30 questions, each with the expected `path` and page
  or heading, over the demo workbench's documents.
- `npm run eval:retrieval` reports recall@5 for `hybrid`, `keyword` and `semantic`, and fails when
  hybrid recall@5 drops below the threshold recorded in WP-24's ADR.
- The demo documents are written or generated for VERA, around the fictional board VERA-DEMO-01.

## 9. Viewer anchors

A ref opens in the document viewer: a PDF at its page with the snippet highlighted, Markdown at the
heading, text at the line range (06 §5).

NOTES:
- Deferred: OCR, tables as structured data, DOCX, images inside PDFs, provider-side embeddings.
- Work packages cite this file as `05 §n`.
