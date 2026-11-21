# Retrieval evaluation

Exercises the product's real search service, with isolated databases and workers, on the demo
workbench and the 28 fixed questions, in the `keyword`, `semantic` and `hybrid` modes. It needs the
local model already prepared (`npm run prepare:model`) and does not download it. Layout and shared
rules: [evaluators README](../README.md).

## Thresholds

Hybrid recall@5 of at least `0.85` overall, `0.95` for English and `0.75` for Romanian. A run below
them exits with code 1.

## Commands

```powershell
python ../02_Tools/environment/npmw.py npm run eval:retrieval
python ../02_Tools/environment/npmw.py npm run eval:retrieval -- --output evaluation-outputs/retrieval/<run-id>/run.json
```

`--scratch <parent>` chooses the parent of the temporary folder (default
`node_modules/.cache/evaluators/retrieval/`); the run's folder is deleted in `finally`.
`--output <new file>` saves the complete result with the harness hash and commit, writes
`report.html` beside it, creates missing parent folders and refuses an existing file.
`eval:retrieval report --input <run.json> [--reference <run.json>]` renders a saved run again; two
runs compare when they use the same questions and harness, so two embedding models can be compared.

## Embedding models

`--model <id>` runs the evaluation with one of the shipped embedding models, `Xenova/bge-small-en-v1.5`
(the default) or `Xenova/multilingual-e5-small`. Two runs on the same questions and harness compare
in `report --reference`. On 2026-11-21 both passed the hybrid thresholds; hybrid recall@5 was 89.3 %
overall and 78.6 % for Romanian with bge, 96.4 % and 92.9 % with E5 (semantic only: 71.4 % against
92.9 % for Romanian), while E5 indexes about 1.5 times slower with about 2.8 times the memory.

## Hard-layout corpus

`eval:retrieval layout [--model <id>]` generates a second, fictional workbench whose PDFs have the
layouts of real datasheets ([hard-corpus.mjs](hard-corpus.mjs)): a register table, two text columns, a
rotated pinout table, footnotes, a table split across two pages and a page without a text layer. It
indexes and searches it through the CLI (`vera index`, `vera search`, the product path) behind the
egress guard and checks, from [cases/hard-layout.yaml](cases/hard-layout.yaml):

| Check | Threshold |
|---|---|
| Expected text extracted on its page | ≥ 85 % |
| Table rows kept within one chunk | reported |
| Scanned pages reported as `needs_ocr` (and no other) | 100 % |
| Hybrid recall@5 over 12 English and Romanian questions | ≥ 75 % |

The generator fixes the PDF metadata, so every run gets the same bytes. Third-party datasheets are not
used: they cannot be committed. Its end-to-end test is `tests/integration/eval-retrieval-layout.test.ts`.

## Files

| File | Role | Inputs and results |
|---|---|---|
| [run.mjs](run.mjs) | Entry point. Bundles `product-eval.mjs` with the TypeScript sources and the PDF and embedding workers, runs it and prints the metrics. | `--scratch`, `--output`. Records the SHA-256 of the question file. |
| [product-eval.mjs](product-eval.mjs) | Runs the real search on the corpus and applies the thresholds. | The demo workbench and the question file. |
| [corpus.mjs](corpus.mjs) | Builds the fixed evaluation corpus with the same extractors and chunking rules as the product. | `loadCorpus(workbench, pdfWorker)` reads the three demo PDFs, the bring-up notes, the pinout, the boot log and `board.txt`; it returns the chunks and the size and SHA-256 of each source. |
| [layout.mjs](layout.mjs), [hard-corpus.mjs](hard-corpus.mjs) | The hard-layout command and its generated corpus. | `--model`, `--output`. |
| [report-model.mjs](report-model.mjs) | The HTML report model: thresholds, recall@5 per mode and language, top 5 per question. | A saved run. |
| [evaluation.mjs](evaluation.mjs) | Validates the questions and their targets; computes keyword and semantic rankings, RRF fusion and metrics per language. | Uses SQLite FTS for the keyword reference; it does not start an evaluation by itself and does not download models. Its tests are in `tests/integration/retrieval.test.ts`. |
| [cases/demo-board.yaml](cases/demo-board.yaml) | The 28 questions (English and Romanian pairs) with their expected document and page, frozen before model inference. | Read by the harness and by `tests/integration/retrieval.test.ts`. |

The corpus is the demo workbench in `tests/fixtures/workbenches/demo-board/`, shared with the
functional tests.
