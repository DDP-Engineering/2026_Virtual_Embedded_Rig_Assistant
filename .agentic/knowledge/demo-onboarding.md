# Fictional verification fixtures

## Routing

Select for the fictional board corpus, PDF regeneration and fixture-only
retrieval/CLI/smoke inputs. Start at `05_Software/tests/fixtures/README.md`,
`tests/support/make-demo-pdfs.mjs`, `evaluators/eval-retrieval-harness/product-eval.mjs` and `02_Tools/release/package.mjs`.
[Workbench](workbench.md) owns explicit user folder creation/opening and the normal lifecycle;
[chat UI](chat-ui.md) owns user-composed sessions; [native packaging](native-packaging.md)
owns application and real model/runtime resource delivery.

## Purpose and boundaries

The fictional VERA-DEMO-01 corpus is verification data under `tests/fixtures/workbenches/`.
Tests and evaluation/smoke harnesses copy it into owned isolated workspaces. The application
starts with ordinary user-selected workbenches and explicit session input.

## Public interface

- Welcome creates or opens a user-selected workbench and displays recents.
- Ordinary workbench and session IPC contracts support those user actions.
- `makeDemoPdfs(destination)` generates the three fixture PDFs from fixture Markdown.
- `demo-board.json` is a test-only identity and finite asset inventory.
- definitions/registers/vera-demo-01.json supplies I2C1_CR1 for VERA-DEMO-01 revisionA with PE0/TXIE1/RXIE2/ERRIE7 and sources/reference-manual.md#L7-L7; it is inventoried and used on isolated test copies for exact register decoding and real CLI/session citation parity.
- Baseline boot-0412.log has three INFO events and a WARN at line3; candidate boot-0413.log has an ERROR at line4. docs/runs.md identifies firmware1.0.0/1.1.0, board/unit/setup/test; boot-test.md defines boot@1 (i2c ready and no ERROR); release-notes.md records the timing change without a root-cause claim. parse_log/CLI tests cite the events and eval:retrieval covers the indexed notes.

## Invariants

- Fictional documents, skills and inventory live in `tests/fixtures/` and remain outside
  the compiled application and installer resources.
- Test consumers use isolated copies; fixture source bytes remain stable.
- Existing user folders/profiles are preserved and remain openable through normal lifecycle.
- Model assets and Windows runtime libraries remain real packaged application resources.
- Board values are fictional evidence; recorded boot events do not prove unmeasured hardware checks.

## Change map

| Change | Source | Proof |
|---|---|---|
| Welcome and normal composition | renderer workbench/App/session components | workspace.test.ts; native workbench acceptance |
| Runtime contract and payload | shared ipc/index; main index; builder and package.mjs | workbench-entry.test.ts; packaging.test.ts; real staging |
| Fixture documents and PDF generation | tests/fixtures/workbenches; make-demo-pdfs.mjs | inventory/hash checks; demo-documents.test.ts |
| Retrieval and CLI inputs | evaluators/retrieval-support; tests/packaging/smoke/smoke-runtime; tooling tests | focused retrieval/CLI/PDF consumers |

## Key behaviors

- User-selected workbenches and explicit session composition.
- Fictional verification data is separate from the distributed application.

## Files

`tests/fixtures/workbenches/demo-board/`, `demo-board.json`; renderer App/Workbench/Composer;
shared ipc/index; main index; electron-builder.yml; 02_Tools/release/package.mjs, make-demo-pdfs.mjs,
evaluators/eval-retrieval-harness/product-eval.mjs, compare-embeddings.mjs and smoke-runtime.mjs.
