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
| [retrieval-support/](retrieval-support/README.md) | Module ale evaluării căutării | — | Importate de harness-ul de căutare. |

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
- Rapoartele istorice deja acceptate rămân în `06_SoftwareDocu/` cu hash-urile și proveniența
  lor originale; ele nu au fost mutate. Mutarea harness-ului de performanță a schimbat însă
  identitatea lui (`harnessHash`), iar `compare` și `calibrate` cer identități identice: rulările
  noi nu pot folosi rularea reținută din 2026-11-12 ca referință compatibilă.

| Familie | Scratch | Output |
|---|---|---|
| performance | director temporar `vera-session-performance-*`, șters la final | `--output <fișier nou>`, obligatoriu |
| retrieval | `node_modules/.cache/evaluators/retrieval/` sau `--scratch <părinte>`; directorul rulării este șters în `finally` | `--output <fișier nou>`, opțional |

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
