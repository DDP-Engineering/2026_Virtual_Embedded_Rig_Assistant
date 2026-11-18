# Shared modules for the retrieval evaluation

Internal modules of the [retrieval evaluation](../eval-retrieval-harness/eval-retrieval.mjs).
They are not standalone commands. How to run the evaluation, its scratch folder and its outputs are
described in the [evaluators README](../README.md).

| File | Role | Inputs and results |
|---|---|---|
| [corpus.mjs](corpus.mjs) | Builds the fixed evaluation corpus with the same extractors and chunking rules as the product. | `loadCorpus(workbench, pdfWorker)` reads the three demo PDFs, the bring-up notes, the pinout, the boot log and `board.txt`; it returns the chunks and the size and SHA-256 of each source. The harness bundles it so that it can import the TypeScript sources. |
| [evaluation.mjs](evaluation.mjs) | Validates the questions and their targets; computes keyword and semantic rankings, RRF fusion and metrics per language. | Takes the corpus, the questions and the rankings. Uses SQLite FTS for the keyword reference; it does not start an evaluation by itself and does not download models. Its tests are in `tests/integration/retrieval.test.ts`. |

The inputs are shared fixtures: the demo workbench in `tests/fixtures/workbenches/demo-board/` and
the questions in `tests/fixtures/retrieval/demo-board.yaml`.
