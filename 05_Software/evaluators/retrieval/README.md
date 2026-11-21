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
`--output <new file>` saves the complete report, creates missing parent folders and refuses an
existing file.

## Files

| File | Role | Inputs and results |
|---|---|---|
| [run.mjs](run.mjs) | Entry point. Bundles `product-eval.mjs` with the TypeScript sources and the PDF and embedding workers, runs it and prints the metrics. | `--scratch`, `--output`. Records the SHA-256 of the question file. |
| [product-eval.mjs](product-eval.mjs) | Runs the real search on the corpus and applies the thresholds. | The demo workbench and the question file. |
| [corpus.mjs](corpus.mjs) | Builds the fixed evaluation corpus with the same extractors and chunking rules as the product. | `loadCorpus(workbench, pdfWorker)` reads the three demo PDFs, the bring-up notes, the pinout, the boot log and `board.txt`; it returns the chunks and the size and SHA-256 of each source. |
| [evaluation.mjs](evaluation.mjs) | Validates the questions and their targets; computes keyword and semantic rankings, RRF fusion and metrics per language. | Uses SQLite FTS for the keyword reference; it does not start an evaluation by itself and does not download models. Its tests are in `tests/integration/retrieval.test.ts`. |
| [cases/demo-board.yaml](cases/demo-board.yaml) | The 28 questions (English and Romanian pairs) with their expected document and page, frozen before model inference. | Read by the harness and by `tests/integration/retrieval.test.ts`. |

The corpus is the demo workbench in `tests/fixtures/workbenches/demo-board/`, shared with the
functional tests.
