# Evaluatori

Harness-uri independente care produc măsurători, scoruri și rapoarte despre produs.
Un harness poate aplica și praguri documentate, dar nu este o suită unitară sau E2E:
nu rulează la `npm test` și nici la `npm run test:e2e`. Testele funcționale sunt în
[`../tests/`](../tests/README.md), iar uneltele de mediu, build și release în
[`../../02_Tools/`](../../02_Tools/README.md).

Fiecare harness își deține intrarea, implementarea și eventualele date sau module proprii.
Datele comune de test, de exemplu demo-ul fictiv și întrebările de căutare, rămân în
`tests/fixtures/`. Comenzile se rulează din `05_Software` cu Node.js local:
`python ../02_Tools/environment/npmw.py …`.

| Director | Familie | Intrare | Statut |
|---|---|---|---|
| [eval-performance-harness/](#performanță) | Încărcarea sesiunilor salvate | `npm run perf:sessions` | Măsurare curentă (PERF-01); calibrarea și gate-urile sunt amânate. |
| [eval-retrieval-harness/](#căutare) | Căutarea reală a produsului | `npm run eval:retrieval` | Praguri hybrid documentate. |
| [eval-embedding-comparison-harness/](#comparația-bgee5) | Compararea modelelor BGE și E5 | `node evaluators/eval-embedding-comparison-harness/compare-embeddings.mjs` | Experiment istoric din ADR-0015; nu este un gate. |
| [eval-firmware-comparator-harness/](#rubricile-analysis-skills) | Rubrica skill-ului `firmware-comparator` | `node evaluators/eval-firmware-comparator-harness/firmware-comparator-rubric.mjs` | Opt-in, cu model real configurat. |
| [eval-test-planner-harness/](#rubricile-analysis-skills) | Rubrica skill-ului `test-planner` | `node evaluators/eval-test-planner-harness/test-planner-rubric.mjs` | Opt-in, cu model real configurat. |
| [retrieval-support/](retrieval-support/README.md) | Module comune căutării și comparației | — | Importate de cele două harness-uri. |

## Scratch și outputs

- **Scratch** (profiluri, baze de date, build-uri intermediare) este al fiecărui harness:
  fie un director temporar propriu, șters la final, fie zona ignorată
  `node_modules/.cache/evaluators/<familie>/`. Evaluatorii nu folosesc `02_Tools/cache/`,
  care servește mediului, build-ului și release-ului.
- **Outputs** salvate merg în [`../evaluation-outputs/<familie>/`](../evaluation-outputs/README.md),
  cu un nume unic pentru fiecare rulare. Directorul familiei se creează înaintea primei rulări,
  pentru că evaluatorii nu creează directoare părinte. Directorul este ignorat de Git; dovezile
  păstrate se selectează explicit.
- Zona `node_modules/.cache/evaluators/` poate fi ștearsă oricând nu rulează niciun evaluator;
  se recreează la nevoie. Scratch-ul păstrat al comparației și bundle-urile rubricilor nu conțin
  legături către alte directoare.
- Rapoartele istorice deja acceptate rămân în `06_SoftwareDocu/` cu hash-urile și proveniența
  lor originale; ele nu au fost mutate. Mutarea harness-ului de performanță a schimbat însă
  identitatea lui (`harnessHash`), iar `compare` și `calibrate` cer identități identice: rulările
  noi nu pot folosi rularea reținută din 2026-11-12 ca referință compatibilă.

| Familie | Scratch | Output |
|---|---|---|
| performance | director temporar `vera-session-performance-*`, șters la final | `--output <fișier nou>`, obligatoriu |
| retrieval | `node_modules/.cache/evaluators/retrieval/` sau `--scratch <părinte>`; directorul rulării este șters în `finally` | `--output <fișier nou>`, opțional |
| embedding-comparison | `--scratch` obligatoriu, subdirector al `node_modules/.cache/evaluators/embedding-comparison/`; păstrat pentru inspecție | `--output <json>`, obligatoriu |
| firmware-comparator, test-planner | bundle-ul host-ului izolat în `node_modules/.cache/evaluators/<familie>/` | `ABS_OUTPUT` nou, păstrat complet |

## Performanță

`perf:sessions run|calibrate|compare --output <fișier nou> [opțiuni]` măsoară
încărcarea sesiunilor salvate într-un build instrumentat, compară o rulare cu o
referință și calibrează referințe. Fișierele harness-ului sunt
[perf-sessions.mjs](eval-performance-harness/perf-sessions.mjs) (intrarea),
[runner.mjs](eval-performance-harness/runner.mjs), [report.mjs](eval-performance-harness/report.mjs)
și [fixtures.mjs](eval-performance-harness/fixtures.mjs), care generează sesiunile sintetice.
Runner-ul folosește protecția de rețea a suitei E2E, `tests/e2e/network-guard.ts`.
Metoda, rezultatele și limitele sunt în
[06_SoftwareDocu/session-performance.md](../../06_SoftwareDocu/session-performance.md).
Testele lor focalizate sunt `tests/tooling/session-performance*.test.ts`.

## Căutare

[eval-retrieval.mjs](eval-retrieval-harness/eval-retrieval.mjs) împachetează
[product-eval.mjs](eval-retrieval-harness/product-eval.mjs) și exercită serviciul
real de căutare, cu baze de date și workeri izolați, pe demo și cele 28 de întrebări fixe,
în modurile `keyword`, `semantic` și `hybrid`. Cere modelul local deja pregătit
(`npm run prepare:model`) și nu îl descarcă. Pragurile hybrid sunt recall@5 de minimum
`0.85` global, `0.95` pentru engleză și `0.75` pentru română.

```powershell
python ../02_Tools/environment/npmw.py npm run eval:retrieval
mkdir evaluation-outputs/retrieval -Force
python ../02_Tools/environment/npmw.py npm run eval:retrieval -- --output evaluation-outputs/retrieval/<run>.json
```

`--scratch <părinte>` alege părintele directorului temporar; `--output <fișier nou>`
salvează raportul complet și refuză un fișier existent.

## Comparația BGE/E5

[compare-embeddings.mjs](eval-embedding-comparison-harness/compare-embeddings.mjs) compară
izolat cele două modele pe același corpus: rezultate, timpi CPU, dimensiuni și hash-uri.
Fiecare model rulează în [embedding-worker.mjs](eval-embedding-comparison-harness/embedding-worker.mjs),
un worker thread care folosește CPU și q8 și interzice rețeaua în timpul inferenței.
Comparația nu înlocuiește evaluarea prin serviciul real; decizia de selecție este în
[ADR-0015](../../00_Planning/decisions/ADR-0015-embedding-model-selection.md).

```powershell
python ../02_Tools/environment/npmw.py node evaluators/eval-embedding-comparison-harness/compare-embeddings.mjs --scratch node_modules/.cache/evaluators/embedding-comparison/<run> --models <models-directory> --output evaluation-outputs/embedding-comparison/<run>.json
```

Implicit cere cache-urile locale ale ambelor modele. `--prepare` permite descărcarea
fișierelor fixate în manifestele BGE/E5 din `tests/fixtures/retrieval/`. Scratch-ul și
raportul sunt păstrate; un raport existent cu același nume este suprascris.

## Rubricile analysis-skills

Cele două rubrici au aceeași formă. `--prepare ABS_OUTPUT` construiește offline host-ul
izolat din [harness.ts](eval-firmware-comparator-harness/harness.ts) și
[live.ts](eval-firmware-comparator-harness/live.ts) (respectiv
[harness.ts](eval-test-planner-harness/harness.ts) și [live.ts](eval-test-planner-harness/live.ts)),
pregătește cele șapte cazuri fictive și foaia de verdicte. `--run ABS_OUTPUT ABS_EXISTING_VERA_PROFILE
[MODEL]` folosește un model real configurat, prin credențialele unui profil existent.
Testele de integrare importă `harness.ts`: `tests/integration/cli.test.ts` pe ambele, iar
`analysis-skills.test.ts` pe cel al `firmware-comparator`. `live.ts` este numai pentru Electron
și nu este importat de testele automate. Procedurile complete sunt în README-urile `verification/` ale skill-urilor din
`plugins/analysis-skills/skills/`.
