# M3 — Knowledge

PURPOSE: workbench documents become searchable and citable — PDFs included — and skills extend the agent.
DONE-WHEN: demo PDFs, Markdown and logs index in the background; hybrid `search_docs` meets the recall
threshold of WP-24; citations open the viewer at the cited page; skills load from workbench and user folders.

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
