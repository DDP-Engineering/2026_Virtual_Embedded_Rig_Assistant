# M3 — Knowledge

PURPOSE: workbench documents become searchable and citable — PDFs included — and skills extend the agent.
STATE: 2026-11-01 — implemented; WP-22…WP-29 and the M3 epic are closed in Gitea. This file is now a
historical record of the plan: the WP text below is unchanged, and
[Implementation notes](#implementation-notes-2026-11-01) record what the code does. In "Start from"
lines, read `09_Others/benchpilot-reference/src/apps/…` as `…/apps/…` and the reference's
`src/libraries/shared/` as `packages/shared/`.
DONE-WHEN: demo PDFs, Markdown and logs index in the background; hybrid `search_docs` meets the recall
threshold of WP-24; citations open the viewer at the cited page; skills load from workbench and user folders.
As built, logs are not indexed: only PDF, Markdown, HTML, `.txt`, `.csv`, `.tsv` and Office files
are documents (`05_Software/src/libraries/core/src/knowledge/kinds.ts:8-22`); `.log` files stay
reachable through `read` and `grep`.

## WP-22 Ingest pipeline

**Goal:** documents enter the index in the background and stay in step with the folder.
**Depends on:** WP-07. **Specs:** 05 §1; 02 §2 (`docs.include`, `docs.exclude`), §6.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/testbench/load.ts` (document loading and FTS indexing).

Scope:
- chokidar on `docs.include` minus `docs.exclude` and ignore rules; 1 s debounce; SHA-256 per file;
  one queue per workbench; `docs.reindex`.
- Statuses `pending | indexed | failed | unsupported | needs_ocr`; `index.progress` and
  `index.document` events; size limits of 05 §1.
- Deleting a file removes its document, chunks, index rows and embeddings.

Done when:
- [ ] Integration: adding, changing and deleting files updates the `documents` table and emits events.
- [ ] Integration: an unchanged file is skipped by hash; an over-size file becomes `unsupported` with its reason.

## WP-23 Extraction, chunking, demo documents

**Goal:** text and locators out of every supported type, cut into chunks that cite precisely.
**Depends on:** WP-22. **Specs:** 05 §2, §3.

Scope:
- Extractors per 05 §2: pdf.js `getTextContent` per page in a worker; Markdown with its heading tree;
  text types by lines; HTML with tags stripped; the extract cache in `.vera/cache/extract/`.
- Chunkers per 05 §3 with locators (page, heading path, line range); `needs_ocr` detection.
- `scripts/make-demo-pdfs.mjs`: Markdown sources of the fictional board VERA-DEMO-01 rendered into the
  demo workbench's PDFs (datasheet, reference manual excerpt, application note).

Done when:
- [ ] Unit: each extractor and chunker on fixtures; PDF chunks never cross pages; text windows overlap
  by 10 lines; CSV windows repeat the header.
- [ ] Unit: a scanned-style PDF fixture becomes `needs_ocr`.

## WP-24 Spike: embedding model

**Goal:** choose the bundled embedding model on evidence.
**Depends on:** WP-05, WP-23. **Specs:** 05 §4, §8; ADR-0006.

Scope:
- `tests/fixtures/retrieval/demo-board.yaml`: 20–30 questions with the expected path and page or heading.
- Compare `bge-small-en-v1.5` and `multilingual-e5-small`: package size, CPU time per chunk, recall@5
  in `keyword`, `semantic` and `hybrid` modes, and on Romanian questions over English documents.

Done when:
- [ ] The measurements are written down, and a new ADR names the model and the recall threshold.

## WP-25 Keyword index

**Goal:** word and fragment search over chunks.
**Depends on:** WP-23. **Specs:** 05 §5, §6 (keyword).
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/db/schema.sql` (`docs_fts`), `tools/knowledge.ts` (bm25 search).

Scope:
- A migration adding `chunks_fts` (`unicode61`, `tokenchars '_'`) and `chunks_tri` (`trigram`).
- Keyword search: bm25 top 50, plus trigram matches for terms of 3 or more characters that contain a
  digit or `_`.

Done when:
- [ ] Unit: `I2C1_CR1` is found by `I2C1_CR1` (word) and by `C1_CR` (trigram); bm25 ranks the
  defining page first on fixtures.

## WP-26 Embeddings, hybrid search, document tools

**Goal:** semantic and hybrid search, and the two document tools the agent uses.
**Depends on:** WP-24, WP-25. **Specs:** 05 §4–§6, §8; 03 §4 (`search_docs`, `read_doc`).
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/tools/knowledge.ts`.

Scope:
- Embedding worker (batches of 32), the `embeddings` table, re-embedding on a model change.
- An in-memory vector cache per workbench in a worker; brute-force cosine top 50.
- Hybrid search with reciprocal rank fusion (`1 / (60 + rank)`); snippets of at most 300 characters.
- `search_docs` and `read_doc` per 03 §4 and 05 §6.
- CLI `vera index` and `vera search`; script `eval:retrieval`.

Done when:
- [ ] `eval:retrieval` meets the threshold of WP-24's ADR in hybrid mode.
- [ ] Integration: a replay script that searches, reads a page and answers cites `<pdf>#p=<n>` validly.

## WP-27 Citations for every reference kind

**Goal:** every reference format of 05 §7 is parsed, validated and shown.
**Depends on:** WP-26. **Specs:** 05 §7; 03 §9.
**Start from:** `09_Others/benchpilot-reference/src/libraries/shared/src/evidence.ts`, `src/apps/server/src/evidence/resolve.ts`,
`agent/citations.ts`, `src/apps/web/src/components/evidence/EvidenceChip.tsx`.

Scope:
- `refs.ts` for pages, page ranges, headings, line ranges and artifacts; range checks against page
  count, heading slugs and line count.
- Chips per kind in the transcript.

Done when:
- [ ] Unit: parse–format round trip for every kind; out-of-range locators are invalid.
- [ ] e2e: valid and invalid chips render differently.

## WP-28 Document viewer and Docs panel

**Goal:** a citation opens the document at the cited place; the Docs tab shows the index.
**Depends on:** WP-27. **Specs:** 06 §2, §3, §5; 05 §9.
**Start from:** `09_Others/benchpilot-reference/src/apps/web/src/components/evidence/EvidenceViewer.tsx`, `EvidenceDrawer.tsx`,
`components/testbench/DocumentsTab.tsx`.

Scope:
- PDF viewer with pdf.js: page jump, zoom, text search, highlight of the cited snippet.
- Markdown at the heading anchor; text with line numbers and the cited range highlighted.
- The Docs tab: status per document, search box, Open, Reindex; index progress.

Done when:
- [ ] e2e: clicking a PDF citation opens the viewer at that page with the snippet highlighted.
- [ ] e2e: line and heading citations open at their anchors.

## WP-29 Skills

**Goal:** workbench and user skills reach the agent through the prompt index and `load_skill`.
**Depends on:** WP-12. **Specs:** 02 §5; 03 §3, §4 (`load_skill`); 06 §2.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/skills/load.ts`, `content.ts`,
`src/apps/web/src/components/testbench/SkillsTab.tsx`; its seven `skills/*/SKILL.md` as format examples.

Scope:
- Discovery in `<workbench>/skills/` and `<userData>/skills/`; the workbench wins on a clash;
  `skills.disabled`.
- Validation per 02 §5; invalid skills listed with their error and kept out of the prompt.
- The skills index in the system prompt; `load_skill { name, file? }`.
- Skills settings: list, enable or disable, open, create from a template, edit.

Done when:
- [ ] Unit: discovery, clash resolution, validation errors, disabled skills.
- [ ] Integration: a replay script loads a skill and its extra file.
- [ ] e2e: a skill created in the UI appears in the prompt index of the next turn.

## Implementation notes (2026-11-01)

Checked against the working tree on `master` (33e72b8 plus uncommitted changes) by reading code and
tests; nothing was run. Paths are relative to `05_Software/`: `core/` = `src/libraries/core/src/`,
`kn/` = `core/knowledge/`, `shared/` = `src/libraries/shared/src/`, `main/` and `renderer/` =
`src/apps/desktop/src/main/`, `…/renderer/`.

- WP-22: implemented with deviation: on desktop, selection, hashing, extraction, chunking and
  embedding run in a separate Electron utility process, "VERA Indexer", while main keeps the SQLite
  writes (`main/index.ts:90-98`, `main/indexer-process.ts`); files that are not documents get no row
  instead of `unsupported` (`kn/selection.ts:43,117-118`). chokidar, 1 s debounce, SHA-256, one queue
  per workbench and `docs.reindex` as planned (`kn/ingest.ts`); the integration items are vitest files
  (`kn/ingest.test.ts:139,155,229`) plus `tests/e2e/ingest.spec.ts`.
- WP-23: implemented with deviation: only `.txt`, `.csv` and `.tsv` are text documents, so logs, code,
  JSON and YAML are not indexed (`kn/kinds.ts:8-12`); production chunking takes the workbench
  `embeddings` settings — 1 400-character windows with 200-character overlap
  (`shared/workbench.ts:39-43`, `kn/chunk.ts:123-124`) — and the 60-line/10-line rule applies only
  without settings. pdf.js in a worker, the heading tree, HTML, the extract cache, `needs_ocr` and
  `scripts/make-demo-pdfs.mjs` as planned (`kn/pdf-worker.ts`, `kn/processor.ts:40-55`).
- WP-24: implemented as planned: 28 questions, 14 English and 14 Romanian
  (`tests/fixtures/retrieval/demo-board.yaml`), `scripts/compare-embeddings.mjs`; ADR-0015 picks
  `Xenova/bge-small-en-v1.5` q8 with hybrid recall@5 ≥ 0.85 overall, ≥ 0.95 EN, ≥ 0.75 RO. Its
  measurement file was deleted in commit 891a699.
- WP-25: implemented with deviation: no migration — `chunks_fts` and `chunks_tri` are part of the single
  schema (version 1; `core/storage/schema.ts`, see WP-07). Tokenizers and bm25 plus trigram search as
  planned (`kn/keyword.ts:27-61`, `kn/keyword.test.ts:42`).
- WP-26: implemented with deviation: batches of 32, the vector cache, RRF with k = 60, 300-character
  snippets, `search_docs`/`read_doc` and CLI `vera index`/`vera search` as planned
  (`kn/embedding-worker.ts:47-49`, `kn/search.ts:161-186`, `core/tools/documents.ts`); but
  `eval:retrieval` chunks its own corpus without the workbench settings and includes
  `logs/boot-0412.log` and `board.txt`, which the product does not index
  (`scripts/retrieval/corpus.mjs:9-31`), so the recall gate does not measure the shipped chunking
  (ADR-0015 says so); no passing result is committed.
- WP-27: implemented as planned: five kinds — page, page range, heading, lines, artifact
  (`shared/refs.ts:49-54`); range checks sit in core (`kn/search.ts:420-466`,
  `core/agent/citations.ts:46-55`), chips per kind in `renderer/components/session/markdown.tsx:41-85`.
  A citation is valid only when a tool result of the session issued it (`core/agent/citations.ts:43`).
- WP-28: implemented as planned (`renderer/components/documents/pdf-viewer.tsx`,
  `viewer-context.tsx:330-392`, `docs-tab.tsx`, `tests/e2e/citations.spec.ts:135-191`).
- WP-29: implemented with deviation: workbench skills are read from `.vera/skills/`, not
  `<workbench>/skills/` (`core/skills/catalog.ts:56`), following the amended 02 §5. User skills, clash
  rule, `skills.disabled`, `load_skill` and the Skills settings as planned (`core/tools/load-skill.ts`,
  `renderer/components/skills.tsx`, `tests/e2e/skills.spec.ts:13`).

Not in the plan, implemented in this area:
- Office documents: DOCX/ODT, PPTX/ODP (slides cited as pages) and XLSX/ODS are indexed and cited
  (`kn/office.ts`, `kn/kinds.ts:18-21`, `tests/e2e/office-documents.spec.ts`).
- The separate VERA Indexer process, with status and restart in the Docs tab
  (`main/indexer-host.ts`, `tests/e2e/indexer.spec.ts`).
- Chunks kept under the BGE 512-token limit with the bundled tokenizer (`kn/token-budget.ts`);
  per-workbench document roots, chunk and retrieval settings; an `index.volume` warning for large
  document sets (`kn/ingest.ts:312-324`, `renderer/components/documents/volume-warning.tsx`).
- Open a document in its default application (`renderer/components/documents/open-externally.tsx`);
  `read_doc` reads long sections in parts; documents open as tabs of the chat area (a recent-sources list in the Source panel until TASK-79f6ffd3).
- PDFs fetched by `web_download` open in the viewer from `.vera/downloads/` but are not indexed
  (`tests/e2e/pdf-download.spec.ts`).
