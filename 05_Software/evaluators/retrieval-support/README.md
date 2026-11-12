# Module comune pentru evaluarea căutării

Module interne folosite de ambele harness-uri de căutare:
[evaluarea produsului](../eval-retrieval-harness/eval-retrieval.mjs) și
[comparația BGE/E5](../eval-embedding-comparison-harness/compare-embeddings.mjs).
Nu sunt comenzi independente. Rularea, scratch-ul și outputs sunt descrise în
[README-ul evaluatorilor](../README.md).

| Fișier | Rol | Intrări și rezultate |
|---|---|---|
| [corpus.mjs](corpus.mjs) | Construiește corpusul fix de evaluare cu aceleași extractoare și reguli de chunking folosite de produs. | `loadCorpus(workbench, pdfWorker)` citește cele trei PDF-uri demo, notele de bring-up, pinout-ul, boot log-ul și `board.txt`; întoarce chunk-uri și hash-urile surselor. Este împachetat de harness pentru a putea importa sursele TypeScript. |
| [evaluation.mjs](evaluation.mjs) | Validează întrebările și țintele; calculează clasamente keyword/semantic, fuziune RRF și metrici pe limbi. | Primește corpusul, întrebările și clasamentele. Folosește SQLite FTS pentru referința keyword; nu lansează singur o evaluare și nu descarcă modele. Testele lui sunt în `tests/integration/retrieval.test.ts`. |

Datele de intrare rămân fixturi comune: demo-ul din `tests/fixtures/workbenches/demo-board/`,
întrebările din `tests/fixtures/retrieval/demo-board.yaml` și manifestele BGE/E5 din
`tests/fixtures/retrieval/`.
