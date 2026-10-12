# WP-24: local embedding measurements

Date:2026-10-12. Base:1da07ec9ef90e0c74b6e2519b52d96d02111f383.
Selection: BGE q8, with hybrid overall>=0.85, EN>=0.95 and RO>=0.75 on the frozen
demo set. See [ADR0015](../00_Planning/decisions/ADR-0015-embedding-model-selection.md).

## Corpus and method

Twenty-eight paired questions (14 EN,14 RO) were frozen before inference.
Labels specify an exact PDF page or Markdown heading over English documents.
No fixture question was changed after seeing scores. Existing PDF worker,
extractors and chunkDocument produce10 identical ordered chunks from the three
two-page PDFs, bring-up Markdown, pinout CSV, boot log and board text.
Logs/board text are benchmark distractors explicitly selected by the harness,
independent of the demo workbench docs.include setting. Six PDF pages and one
heading carry the labels. Duplicate facts remain; a wrong page/path is a miss.
Top5 means chunks, without page deduplication.

Keyword: isolated SQLite :memory: FTS5 unicode61 remove_diacritics2 and underscore
tokens; escaped OR query words ranked by bm25 top50 plus trigram matching
3+ character terms containing a digit/underscore; deterministic RRF60 union
when fragment matches exist. Semantic: normalized dot product top50.
Hybrid: RRF60 of keyword and semantic, one-based ranks, chunk-id ties.
Recall@5 = exact expected path/page or heading in top5 / labeled questions.
Questions are used verbatim; no translation, stop-word filter or query rewriting.
All per-question top5 lists and misses remain in the original JSON reports.
This isolated baseline supplies a reference for WP25/26, not a product migration.

Both models use Transformers4.3.1, onnxruntime-node1.30.0, q8,384 dimensions,
CPU with one intra-op/inter-op thread and sequential execution. BGE uses CLS/L2,
query instruction only; E5 uses attention-masked mean/L2 and query:/passage:
prefixes also for Romanian. Descriptors own prefixes. Actual runtime tokenizers
check full prefixed inputs and special tokens before inference: BGE max210,
E5 max219, both strictly below512. Pipeline truncation therefore drops no tokens.
Remote models/caches are disabled and inference fetch throws. Both candidates'
immutable assets are checked through prepareModel before inference; preparation
is an explicit download step, final native comparisons use offline verified assets.

Wall time uses performance.now, including tokenizer/ONNX/pooling/L2; CPU time
is process.cpuUsage user+system delta, a process-wide measurement rather than
an isolated per-thread counter. Fresh worker/model session per candidate records
import/load separately; first-document inference follows tokenizer preflight.
Cold means process/session cold, OS disk cache uncontrolled. After one untimed
warm-up, three serial batch1 passes over10 chunks give30 samples per model.
Median is upper-middle; p95 is nearest-rank. Queries are timed separately and
excluded from chunk aggregates. Runs are sequential without competing model
measurements; host scheduling noise remains.

## Native platforms

Windows x64 and Ubuntu x64 userspace on WSL2 share the physical Intel Core
i5-10210U @1.60GHz, eight logical cores, pinned Node24.21.0. Ubuntu runs Linux
native Node/ORT libraries on the WSL2 kernel. Exact OS/kernel, RAM and executable
paths are recorded in the reports. Electron is unnecessary for this harness.
Deferred clean/offline Windows/VC++ release obligations were not repeated.

## Model asset size

| Candidate | ONNX bytes | All manifest assets | Decimal MB |
|---|---:|---:|---:|
| BGE | 34,014,426 | 34,961,638 | 34.96 |
| multilingual E5 | 118,308,185 | 140,462,311 | 140.46 |

These are uncompressed deployable assets including tokenizer/model card, not the
application ZIP/AppImage. E5 includes a17,082,730-byte JSON tokenizer and
5,069,051-byte SentencePiece file. It is105,500,673 bytes larger (4.02x total
assets), exceeding the earlier rough120MB candidate estimate. BGE retains the
existing package closure; no final package build is needed for unchanged assets.

## Timing, milliseconds

| Platform | Model | import | load | first chunk wall | warm wall mean | median | p95 | CPU mean |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Windows | bge-small-en-v1.5 | 129.25 | 981.05 | 72.28 | 64.19 | 64.05 | 105.89 | 65.10 |
| Windows | multilingual-e5-small | 209.84 | 1371.30 | 97.18 | 79.62 | 86.99 | 133.17 | 96.33 |
| Ubuntu | bge-small-en-v1.5 | 257.33 | 325.39 | 75.28 | 46.97 | 49.41 | 81.05 | 51.75 |
| Ubuntu | multilingual-e5-small | 82.07 | 959.74 | 92.13 | 52.72 | 62.03 | 88.86 | 60.78 |

## Recall@5

Windows and Ubuntu produce identical hit counts and missed questions.

| Model | Mode | Overall | EN | RO over EN documents |
|---|---|---:|---:|---:|
| BGE | keyword | 17/28 (60.71%) | 14/14 (100%) | 3/14 (21.43%) |
| BGE | semantic | 24/28 (85.71%) | 14/14 (100%) | 10/14 (71.43%) |
| BGE | hybrid | 25/28 (89.29%) | 14/14 (100%) | 11/14 (78.57%) |
| E5 | keyword | 17/28 (60.71%) | 14/14 (100%) | 3/14 (21.43%) |
| E5 | semantic | 25/28 (89.29%) | 13/14 (92.86%) | 12/14 (85.71%) |
| E5 | hybrid | 26/28 (92.86%) | 14/14 (100%) | 12/14 (85.71%) |

BGE hybrid misses supply-ro, watchdog-ro and sensor-check-ro. E5 recovers
watchdog-ro and misses the other two. E5 semantic also misses sensor-check-en,
which keyword restores. Duplicate board facts expose sensitivity to the single
labeled page: relevant alternate pages can rank above the labeled page.
Labels were retained and counted honestly.

E5 improves hybrid by one question (3.57 overall percentage points,7.14 RO
points), with4x model assets and slower warm inference in both runs. Choose BGE
under package constraints: perfect EN hybrid, measured useful direct RO retrieval
and retained package/tokenizer. Architecture05 asks the agent for English search
terms over English documents. This small sample does not show E5 generally
inferior; broader multilingual deployments should re-evaluate the tradeoff.

The downstream hybrid floors are overall0.85 (24/28), EN0.95 (14/14), RO0.75
(11/14). Overall permits one extra miss from observed25/28; RO has no spare miss.
These are post-measurement regression floors on this fixed demo, not a general
retrieval SLA. Ten chunks/top5 is generous, paired questions and repeated facts
are not independent statistical samples. WP26 must use these labels/corpus/rank
conventions and fail if any floor is violated. A changed benchmark needs an
explicit baseline decision.

## Original evidence and provenance

- [Windows report](evidence/wp24/windows-comparison.json), [execution](evidence/wp24/windows-execution.json).
- [Ubuntu report](evidence/wp24/ubuntu-comparison.json), [execution](evidence/wp24/linux-execution.json).
- [Pre-inference fixture freeze](evidence/wp24/fixture-freeze.json), [evidence checksums](evidence/wp24/sha256.json).
- [BGE immutable candidate](../05_Software/fixtures/retrieval/bge-model-manifest.json).
- [E5 immutable candidate](../05_Software/fixtures/retrieval/e5-model-manifest.json).

[BAAI BGE card](https://huggingface.co/BAAI/bge-small-en-v1.5) supplies query
instruction and CLS/L2 convention. [E5 upstream card](https://huggingface.co/intfloat/multilingual-e5-small/blob/614241f622f53c4eeff9890bdc4f31cfecc418b3/README.md)
supplies MIT license, mean pooling, prefixes and normalization. Xenova ONNX
export revision and upstream source revision are distinct and recorded in
the descriptor. Downloaded bytes supply all asset SHA/size values.
