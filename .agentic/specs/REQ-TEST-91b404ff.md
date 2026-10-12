# Local retrieval comparison

The schema-1 YAML fixture has 20-30 unique question ids, language en/ro, query,
and expected workbench-relative path plus exactly one page or heading slug.
Use actual demo docs (three PDFs and bring-up Markdown), plus selected CSV/log
documents as distractors. Author and hash-lock questions before model runs.
Extract with the existing PDF worker/extractors and chunkDocument once; both
models consume identical ordered text/locators. Validate every expected locator
exists before inference. Never tune questions after seeing scores.

Each candidate has immutable revision/asset bytes/SHA/license and a descriptor:
384 dimensions, q8 CPU, pooling, query/passage prefixes, normalization and
maximum tokens. Check full prefixed input token count before inference; fail
rather than truncate. Network is allowed only during explicit preparation.
Worker disables remote loading/caches and uses verified local assets.

The isolated keyword baseline uses SQLite :memory: FTS5 unicode61 with underscore
tokens and remove_diacritics2, OR of escaped query words, bm25 top50, plus trigram
substring search for 3+ character terms containing a digit or underscore.
Fuse these keyword lists deterministically; semantic is normalized-vector dot
product top50; hybrid is reciprocal rank fusion with constant60 and 1-based
ranks. Stable chunk id breaks ties; top5 remains chunks, not deduplicated pages.
One question succeeds iff its exact path and page/heading occurs in top5.
Recall@5 is hit questions divided by questions (single labeled locator);
report integer hits/denominator and fraction overall and by language, retain
rankings and misses. Tests distinguish wrong page/path and top6 from top5.

Measure raw manifest package bytes and ONNX bytes (uncompressed model assets,
not final application ZIP). One fresh worker per model records import and load
wall time, first document wall/CPU time, then three serial batch-size1 passes
over all chunks after one untimed warm-up. Report per-chunk wall mean/median/p95
and process.cpuUsage CPU mean; store all samples. Queries are timed separately.
Record hardware, OS/kernel, CPU/logical cores/RAM, pinned Node/Transformers/ORT,
dtype/backend/thread settings, corpus/fixture/manifest hashes and vector digests.
Cold means process/session cold with OS disk cache uncontrolled. No claim of
portable performance or statistical/general-corpus quality from this tiny demo.

Selection and threshold follow observed native Windows/Ubuntu results. If the
winner changes packaged assets/tokenizer, align descriptor and special-token
inclusive prefix-aware chunk budgets before downstream consumption; retain
confinement, immutable schema and runtime import boundaries.
