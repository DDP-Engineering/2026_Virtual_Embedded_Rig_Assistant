# ADR-0015: Bundled BGE q8 and demo hybrid recall gate

Date: 2026-10-12
Status: Accepted; implemented (recall gate does not use product chunking; see Implementation status)
Implements: ADR-0006 model selection

## Context

The actual native Windows/Ubuntu comparison uses28 fixed questions (14 EN,14 RO)
over10 identical chunks from the English fictional board documents. Original
per-question rankings, asset/source hashes, CPU timing samples and methodology
are in [WP-24 measurements](../../06_SoftwareDocu/wp24-embedding-measurements.md).
Model assets are prepared explicitly and inference always uses local CPU
with remote model loading disabled.

## Decision

Bundle Xenova/bge-small-en-v1.5 at revision
ea104dacec62c0de699686887e3f920caeb4f3e3, q8, MIT,384 dimensions. The selected
[manifest](../../05_Software/src/models/model-manifest.json) supplies CLS pooling,
L2 normalization,512-token maximum, query instruction
"Represent this sentence for searching relevant passages: " and empty passage
prefix. Prefixes belong to the descriptor. Intake checks full prefixed tokens
including special tokens before embedding; passages use the existing BGE
tokenizer/chunker budget strictly below512 and1400 characters.

WP-26's eval:retrieval gate on the frozen demo-board.yaml is:

- hybrid overall recall@5 >=0.85 (at least24/28);
- EN hybrid recall@5 >=0.95 (at least14/14);
- RO hybrid recall@5 >=0.75 (at least11/14).

A question succeeds only when the exact expected path and page/heading occurs
in the first five ranked chunks. Use the same corpus, raw questions, top50
lists, one-based RRF60 and tie rules as the isolated comparison reference.
Keyword and semantic metrics remain reported separately.

## Evidence and alternatives

On both platforms BGE hybrid is25/28 overall,14/14 EN and11/14 RO; E5 is26/28,
14/14 and12/14. BGE semantic is24/28 (RO10/14), E5 semantic25/28 (RO12/14).
Keyword is17/28 (EN14/14,RO3/14). E5 recovers watchdog-ro; both models' hybrid
miss supply-ro and sensor-check-ro. Labels remain unchanged after measuring.

BGE deployable model assets total34,961,638 bytes; multilingual E5 totals
140,462,311 bytes. E5 adds105,500,673 bytes (4.02x model assets) for one extra
hybrid hit. BGE warm mean wall time is64.19ms/chunk on Windows and46.97ms on
Ubuntu; E5 is79.62ms and52.72ms respectively. These serial CPU/batch1 observations
favor BGE under the existing self-contained package constraints. Both achieve
perfect EN hybrid on this set; architecture05 asks the agent for English search
terms over English documents, while direct RO query quality is measured explicitly.

Multilingual E5 remains a viable alternative for a broader multilingual corpus.
Its real Xenova export revision761b726dd34fb83930e26aab4e9ac3899aa1fa78,
MIT upstream source, mean/L2/query:/passage: convention and exact assets are in
the [candidate manifest](../../05_Software/tests/fixtures/retrieval/e5-model-manifest.json).
It was evaluated locally rather than inferred from public benchmark scores.

## Consequences and limits

The selected package assets and BGE tokenizer are retained; descriptor metadata
is explicit, no tokenizer replacement or rechunking is needed. Changing a future
model/passage prefix requires aligning token budgets before intake and re-embedding
the product index. WP25/26 own product migrations/index/search/tools/CLI.
The isolated evaluator creates only temporary in-memory indexes.

The overall floor permits four misses, one more than the observed three.
Language floors prevent aggregate success concealing RO regression: the current
RO result has no spare miss. These are post-measurement demo regression floors,
not a general retrieval SLA. Ten chunks and top5 make the benchmark generous;
paired questions and repeated board facts are not independent statistical
samples. Preserve all misses, and re-baseline explicitly when expanding the
corpus or labels. Timing measures this host, with OS cache uncontrolled.

No new application package build is needed for unchanged BGE assets. Existing
WP05 package feasibility remains valid; deferred clean/offline Windows and VC++
independence remain release obligations. This spike supplies native Node/ORT
Windows and Ubuntu proof and does not claim to resolve those release checks.

## Implementation status (2026-11-01)

- The bundled model matches: `src/models/model-manifest.json` names `Xenova/bge-small-en-v1.5` at
  `ea104dac…`, q8, MIT, 384 dimensions, CLS pooling, normalisation, 512 tokens, the BGE query prefix
  and an empty passage prefix. The files are in `src/models/Xenova/bge-small-en-v1.5/`.
- The worker applies the prefix (`src/libraries/core/src/knowledge/embedding-worker.ts:38`); the
  manifest schema requires q8 (`knowledge/embedding.ts:6-26`); chunks are at most 1400 characters
  (`knowledge/chunk.ts:5`); RRF uses k=60 (`knowledge/search.ts:168`).
- `eval:retrieval` checks 0.85 / 0.95 / 0.75 hybrid recall@5 over
  `tests/fixtures/retrieval/demo-board.yaml` (`scripts/retrieval/product-eval.mjs:75-78`). The E5
  candidate manifest is kept (`tests/fixtures/retrieval/e5-model-manifest.json`).
- Deviation: the gate does not measure the product's real chunking or document selection. It builds
  its corpus outside ingest with `chunkDocument` defaults: overlap 0, while workbenches default to 200
  (`scripts/retrieval/corpus.mjs:29`, `knowledge/chunk.ts:96-97`, `shared/src/workbench.ts`). It
  includes `logs/boot-0412.log` and `board.txt`, which the default `docs/**` selection never indexes
  (`corpus.mjs:15-16`). It also writes chunks directly (`product-eval.mjs:45`).
- Link removed: `06_SoftwareDocu/wp24-embedding-measurements.md` and `evidence/wp24/` were deleted in
  commit 891a699 (2026-10-14); they remain in Git history (`891a699^`).
- Open: clean/offline Windows and VC++ proof (see ADR-0013).
