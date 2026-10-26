# Scripturile de dezvoltare și verificare VERA

Acest director conține comenzile auxiliare pentru dezvoltare, compilare,
împachetare și diagnosticare. Implementarea produsului este în `../src/`;
testele și datele lor sunt în `../tests/`.

Subdirectoare:

- [retrieval/](retrieval/README.md): module pentru evaluarea căutării și compararea modelelor de embeddings.
- [sandbox/](sandbox/README.md): configurația exemplu pentru Windows Sandbox.

## De unde rulăm comenzile

Comenzile de mai jos se execută din **`05_Software`**, după pregătirea mediului
cu `python 02_Tools/setup.py` din rădăcina repo-ului. Wrapper-ul Python folosește
Node.js local din `02_Tools/runtime/` și dependențele din `05_Software/node_modules/`.

```powershell
# Din rădăcina repo-ului:
cd 05_Software

# Exemple uzuale:
python ../02_Tools/npmw.py npm run dev
python ../02_Tools/npmw.py npm run check:i18n
python ../02_Tools/npmw.py npm run build:cli
```

`npm run dev` și `npm run build` pornesc direct `electron-vite`, conform
[`package.json`](../package.json); nu au un script propriu în acest director.
`Ctrl+C` oprește serverele de dezvoltare pornite în terminal.

## Dezvoltare, compilare și teste

| Fișier | Ce face | Cum este folosit / rezultat |
|---|---|---|
| [build-cli.mjs](build-cli.mjs) | Compilează și împachetează intrarea CLI și worker-ele grep, PDF și embeddings cu esbuild. | `npm run build:cli`; generează `src/apps/cli/dist/`. `npm run vera -- …` îl rulează înaintea CLI-ului. |
| [check-i18n.mjs](check-i18n.mjs) | Compară cataloagele EN/RO/DE cu cheile de traducere utilizate în interfață; detectează chei lipsă, nefolosite sau disponibile numai în traduceri. | `npm run check:i18n`; afișează rezultatul în terminal și întoarce cod nenul pentru erori. `--fixture <json>` permite verificarea scenariilor negative. |
| [dev-renderer.mjs](dev-renderer.mjs) | Pornește numai serverul Vite al interfeței, folosind configurația desktop; nu lansează Electron. | `npm run dev:renderer`; pentru date simulate, setează `VITE_API=mock` înainte de rulare. Afișează URL-ul și `VERA_RENDERER_READY`. |
| [dev-test-server.mjs](dev-test-server.mjs) | Compilează main/preload în modul development și pornește serverul Vite, fără o instanță Electron suplimentară. | Harness utilizat de testele de development/HMR; rulare directă: `node scripts/dev-test-server.mjs`. Afișează `VERA_DEV_READY`. |
| [test-e2e.mjs](test-e2e.mjs) | Compilează desktopul, apoi lansează Playwright. Pe Linux folosește `xvfb-run -a`. | `npm run test:e2e`; argumentele suplimentare sunt transmise către Playwright. Testele sunt în `tests/e2e/`. |
| [cleanup-e2e-output.mjs](cleanup-e2e-output.mjs) | Reporter Playwright care șterge directorul temporar al rulării după scrierea metadatelor finale, inclusiv după eșecuri. | Este încărcat de `playwright.config.ts`, nu se execută direct. Configurația implicită afișează rezultatele în terminal și dezactivează trace/video/capturi automate. |

Exemplu de selecție E2E:

```powershell
python ../02_Tools/npmw.py npm run test:e2e -- tests/e2e/workbench.spec.ts
```

Testele care folosesc hook-uri de instrumentare cer un build cu `VERA_TEST=1`;
scriptul de rulare nu activează singur această opțiune. Politica de selecție a
verificărilor este în [02_Tools/verification-policy.md](../../02_Tools/verification-policy.md).

## Pregătirea resurselor

| Fișier | Ce face | Cum este folosit / rezultat |
|---|---|---|
| [prepare-model.mjs](prepare-model.mjs) | Verifică fișierele modelului după manifestul cu versiuni și SHA-256 fixe; descarcă fișierele lipsă când este permis. | `npm run prepare:model`; scrie în `src/models/`. `npm run prepare:model -- --offline` verifică doar cache-ul existent și eșuează dacă lipsește ceva. |
| [prepare-windows-runtime.mjs](prepare-windows-runtime.mjs) | Pregătește DLL-urile Microsoft VC++ cerute de manifest, verificând hash-urile și semnătura surselor Microsoft. | `npm run prepare:windows-runtime`, pe Windows; scrie în `src/windows_runtime/`. Sursa implicită este System32; `VERA_VC_REDIST_DIR` poate indica un director de redistribuire. |
| [make-demo-pdfs.mjs](make-demo-pdfs.mjs) | Generează reproductibil cele trei PDF-uri fictive din Markdown-ul demo-ului. | `npm run make:demo-pdfs`; citește `tests/fixtures/workbenches/demo-board/sources/` și rescrie PDF-urile din `tests/fixtures/workbenches/demo-board/docs/`. |

Spre deosebire de cache-urile modelelor și DLL-urilor, PDF-urile fictive sunt date de test
versionate. Generarea lor poate modifica fișiere urmărite de Git.

## Împachetare și actualizări

| Fișier | Ce face | Cum este folosit / rezultat |
|---|---|---|
| [package.mjs](package.mjs) | Pregătește resursele, compilează desktopul, asamblează dependențele native și produce installer-ele/pachetele platformei. Verifică payload-ul, separarea build-urilor și bugetul de dimensiune. | `npm run package` pentru release; `npm run package:test` pentru build instrumentat. Generează staging în `release_tmp/`, artefacte și `package-report.json` în `release_tmp/{release,test}/`. Nu publică pachetele. |
| [package-checks.mjs](package-checks.mjs) | Verificări reutilizabile pentru resurse PDF.js, fișiere native, hook-uri de test și conținutul payload-ului. | Modul intern importat de împachetare, probe și teste; nu are CLI propriu. |
| [update-config.mjs](update-config.mjs) | Validează URL-ul feed-ului de actualizări și construiește configurația de publicare pentru electron-builder. | Modul importat de Vite și `package.mjs`; citește setarea furnizată la build. Release cere HTTPS; build-ul instrumentat permite și HTTP loopback. Nu publică nimic singur. |
| [update-feed.mjs](update-feed.mjs) | Servește fișierele unui feed de actualizări local și înregistrează cererile. | Modul `startUpdateFeed(directory, port)` folosit de probele de upgrade; ascultă numai pe loopback și nu are CLI propriu. |

Împachetarea cere un host nativ Windows/Linux x64. Reface staging-ul și directorul
de output al modului ales; nu este un director pentru arhivarea livrărilor.
Pregătirea modelului poate necesita rețea. Livrările selectate și validate aparțin
lui `07_Delivery`, conform [README-ului software](../README.md).

## Evaluarea căutării

| Fișier | Ce face | Cum este folosit / rezultat |
|---|---|---|
| [eval-retrieval.mjs](eval-retrieval.mjs) | Evaluează căutarea reală a produsului pe demo și întrebările fixe, în modurile keyword, semantic și hybrid. | `npm run eval:retrieval`; cere modelul local deja pregătit. Afișează metricile și eșuează dacă pragurile hybrid nu sunt atinse. `--scratch <parent>` alege locul temporar; `--output <json>` salvează explicit raportul într-un fișier nou. Directorul temporar al rulării este șters în `finally`. |
| [compare-embeddings.mjs](compare-embeddings.mjs) | Compară izolat modelele BGE și E5 pe același corpus: rezultate, timpi CPU, dimensiuni și hash-uri. | Harness de măsurare cu `--scratch`, `--models` și `--output` obligatorii. Are o restricție istorică de cale și păstrează output-ul; vezi [retrieval/README.md](retrieval/README.md). |

## Smoke tests și modulele lor interne

Un smoke test verifică un flux esențial al aplicației. Scripturile de release de
mai jos sunt diferite de testele E2E obișnuite: păstrează rapoarte și loguri în
directoarele explicit alese pentru diagnosticare sau în directoare temporare.

| Fișier | Ce face | Cum este folosit / rezultat |
|---|---|---|
| [smoke-live.mjs](smoke-live.mjs) | Compilează un build release și lansează verificarea unui furnizor real prin aplicație. | `npm run smoke:live -- --provider openai` sau `--provider custom:slug`; acceptă `--data <userData>`. Folosește configurația/credențialele aplicației și poate trimite cereri reale furnizorului. |
| [smoke-package.mjs](smoke-package.mjs) | Verifică un artefact release deja construit: extragere/instalare, pornire, indexare, PDF, unelte, aprobare și persistență după restart. Folosește un furnizor simulat local pentru fluxul scriptat. | `npm run smoke:package -- --artifact <path>`; opțional `--scratch <new-directory>`, `--resume <failed-run>`, `--upgrade-proof <report>` și `--windows-evidence <json>`. Nu compilează. Păstrează `smoke-report.json`, extrageri, profiluri izolate și loguri. Poate instala NSIS dacă nu există deja o instalare VERA. |
| [smoke-calibration.mjs](smoke-calibration.mjs) | Calibrează pe Linux observarea conexiunilor unui renderer instrumentat, folosind deliberat un endpoint care trebuie detectat de oracle-ul de rețea. | `node scripts/smoke-calibration.mjs <built-test-app-directory> <new-scratch>`; cere build separat cu `VERA_TEST=1`, Electron local și `strace`. Generează `calibration-report.json`; nu reprezintă validarea unui release. |
| [smoke-runtime.mjs](smoke-runtime.mjs) | Extrage artefacte, pregătește profiluri și copii demo, pornește/oprește aplicația și colectează identități de execuție și loguri. | Modul intern folosit de `smoke-package.mjs` și calibrare; include observarea externă Linux cu `strace`. |
| [smoke-server.mjs](smoke-server.mjs) | Furnizor HTTP/SSE local și verificări ale bugetelor de cerere/context pentru fluxul scriptat. | Modul intern folosit de smoke-ul de pachet; fără CLI propriu. |
| [smoke-egress.mjs](smoke-egress.mjs) | Analizează trace-urile de rețea, inclusiv tentativele eșuate, și verifică destinațiile permise exact. | Modul intern; furnizează și regula pentru endpoint-ul loopback permis. |
| [smoke-report.mjs](smoke-report.mjs) | Parsează argumentele smoke-ului, calculează hash-uri și combină stările funcționale, de rețea și dovezile suplimentare. | Modul intern; stabilește și interpretarea dovezilor Windows și de upgrade. |

Pentru `smoke-package.mjs`, codurile de ieșire sunt: `0` = PASS complet,
`1` = eșec, `2` = flux funcțional trecut cu dovada de rețea a platformei încă
în așteptare. Procedura completă este în
[release-package-smoke.md](../../06_SoftwareDocu/release-package-smoke.md).

## Upgrade și migrarea datelor

| Fișier | Ce face | Cum este folosit / rezultat |
|---|---|---|
| [probe-upgrade.mjs](probe-upgrade.mjs) | Construiește și execută scenarii instrumentate de instalare/upgrade; verifică migrarea, recovery și protejarea datelor. | `node scripts/probe-upgrade.mjs <owned-scratch>`; `--migration-safety` selectează scenariile extinse, `--reuse` reutilizează raportul existent în condițiile verificate de script. Păstrează `upgrade-report.json`, build-uri și loguri. |
| [upgrade-fixture.mjs](upgrade-fixture.mjs) | Pregătește datele scenariilor de întrerupere și verifică recuperarea lor prin IPC. | Modul intern al probei de upgrade și al testelor; folosește `tests/fixtures/upgrade/interrupted.json`. |

`probe-upgrade.mjs` este un harness istoric cu versiuni și commit-uri de bază
fixate în cod, nu un test generic de rulat după fiecare modificare. Necesită
acele revizii Git, uneltele platformei și un director de lucru propriu; poate
executa installer-e și dezinstalări pentru identitățile sale de test.

## Probe offline pe mașini dedicate

| Fișier | Ce face | Parametri și cerințe |
|---|---|---|
| [probe-windows-offline.ps1](probe-windows-offline.ps1) | Verifică hash-ul unui ZIP Windows instrumentat, confirmă izolarea de rețea existentă, extrage și lansează proba de împachetare. | `-Artifact <zip> -ExpectedSha256 <sha256> -EvidenceDirectory <directory>`. Refuză adaptoare/interfețe/rute active din afara loopback; nu deconectează singur host-ul. Scrie metadate, loguri, `probe.json` și `completion.json`. |
| [probe-windows-sandbox.ps1](probe-windows-sandbox.ps1) | Pregătește configurația `.wsb`, scriptul de pornire din guest și hash-urile pentru proba Windows offline. | `-Artifact <instrumented-zip> -EvidenceDirectory <directory>`, opțional `-Launch`. Cu `-Launch` deschide Windows Sandbox și pornește proba în guest. |
| [probe-linux-offline.sh](probe-linux-offline.sh) | Rulează un AppImage instrumentat într-o VM Linux offline și colectează rezultatele probei. | `bash scripts/probe-linux-offline.sh <AppImage> <existing-evidence-directory> <test-user>`. Cere root, Python 3 și Xvfb; coboară adaptoarele active și le restaurează la ieșire. Se folosește în VM-ul de test, nu în sesiunea de dezvoltare de pe host. |

Șablonul manual `.wsb` și diferența față de configurația generată sunt descrise
în [sandbox/README.md](sandbox/README.md).

## Unde ajung fișierele generate

- Build desktop: `src/apps/desktop/out/`; build CLI: `src/apps/cli/dist/`.
- Modele și DLL-uri pregătite: `src/models/` și `src/windows_runtime/`.
- Împachetare: `release_tmp/`, cu staging și output separate pe mod.
- E2E implicit: output temporar în directorul sistemului, eliminat la final;
  raportarea rămâne în terminal. Înlocuirea reporterelor din CLI poate ocoli
  reporterul de curățare configurat implicit.
- Evaluări și probe: unele păstrează explicit JSON, loguri, extrageri și profiluri;
  se aleg directoare temporare/de lucru proprii, în afara surselor versionate.
- PDF-urile fictive rămân versionate exclusiv în `tests/fixtures/`.

Acest README descrie comenzile existente; prezența unui script nu înseamnă că
proba respectivă a fost executată sau că un release a fost validat.
