# Modulele pentru evaluarea căutării

Acest director conține module interne importate sau împachetate de
[`../eval-retrieval.mjs`](../eval-retrieval.mjs) și
[`../compare-embeddings.mjs`](../compare-embeddings.mjs).
Nu sunt comenzi independente de pornire a aplicației.

## Fișiere

| Fișier | Rol | Intrări și rezultate |
|---|---|---|
| [corpus.mjs](corpus.mjs) | Construiește corpusul fix de evaluare cu aceleași extractoare și reguli de chunking folosite de produs. | `loadCorpus(workbench, pdfWorker)` citește cele trei PDF-uri demo, notele de bring-up, pinout-ul, boot log-ul și `board.txt`; întoarce chunk-uri și hash-urile surselor. Este împachetat de harness pentru a putea importa sursele TypeScript. |
| [embedding-worker.mjs](embedding-worker.mjs) | Măsoară izolat, într-un worker thread, un model candidat de embeddings. | Primește descriptorul, modelele locale, chunk-urile și întrebările prin `workerData`; folosește CPU și q8, măsoară timpii și vectorii și interzice rețeaua în timpul inferenței. Este pornit de comparația BGE/E5, nu prin `node` direct. |
| [evaluation.mjs](evaluation.mjs) | Validează întrebările și țintele; calculează clasamente keyword/semantic, fuziune RRF și metrici pe limbi. | Primește corpusul, întrebările și clasamentele. Folosește SQLite FTS pentru referința keyword; nu lansează singur o evaluare și nu descarcă modele. |
| [product-eval.mjs](product-eval.mjs) | Exercită serviciul real de căutare al produsului, cu baze de date și workeri izolați. | `evaluate(software, scratch)` folosește `tests/fixtures/workbenches/demo-board/`, întrebările din `tests/fixtures/retrieval/demo-board.yaml` și modelul selectat din `src/models/model-manifest.json`; întoarce metricile și verdictul. |

## Evaluarea curentă a produsului

Din `05_Software`, după pregătirea modelului local:

```powershell
python ../02_Tools/npmw.py npm run eval:retrieval
```

Nu descarcă modelul automat. Verifică trei moduri: `keyword`, `semantic` și
`hybrid`. Pragurile hybrid sunt recall@5 de minimum `0.85` global, `0.95` pentru
engleză și `0.75` pentru română, pe cele 28 de întrebări fixe.

Metricile sunt afișate în terminal. Opțional:

- `--scratch <parent>` alege părintele directorului temporar; implicit este
  `node_modules/.cache/retrieval-eval/`.
- `--output <new-json-file>` salvează explicit raportul complet; fișierul nu
  trebuie să existe deja. Directorul temporar al evaluării se șterge în `finally`.

Argumentele se transmit după separatorul npm: `npm run eval:retrieval -- …`.

## Comparația istorică BGE/E5

`compare-embeddings.mjs` este un harness separat pentru compararea modelelor,
nu înlocuiește evaluarea prin serviciul real al produsului.

Argumentele obligatorii sunt `--scratch <directory>`, `--models <directory>` și
`--output <json>`. În implementarea actuală, scratch-ul trebuie să fie un
subdirector al `02_Tools/cache/wp24-TASK-fd4046b2/`, verificat explicit de script.
Aceasta este o restricție istorică a harness-ului, nu o convenție pentru toate
scripturile. Directorul de scratch și raportul sunt păstrate.

Implicit, comparația cere cache-urile locale ale ambelor modele. Opțiunea
`--prepare` permite descărcarea fișierelor fixate în manifestele BGE/E5 din
`tests/fixtures/retrieval/`. Inferența rămâne locală. Raportul include clasamente,
timpi, dimensiuni și hash-uri pentru a permite compararea acelorași intrări.

Decizia de selecție a modelului este în
[ADR-0015](../../../00_Planning/decisions/ADR-0015-embedding-model-selection.md).
Pentru lista tuturor comenzilor auxiliare, vezi [scripts/README.md](../README.md).
