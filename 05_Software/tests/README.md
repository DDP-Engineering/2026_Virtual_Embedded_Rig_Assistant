# Organizarea testelor

Acest director conține verificările care folosesc mai multe componente, datele lor
de intrare și infrastructura lor. Testele unitare și de componente aflate lângă
implementare rămân în `src/apps/` și `src/libraries/`. Harness-urile care produc
măsurători și scoruri sunt în [`../evaluators/`](../evaluators/README.md).

| Director | Rol |
|---|---|
| `tooling/` | Configurație, compilare, reguli de import, traduceri, infrastructura testelor și uneltele de evaluare. |
| `integration/` | CLI, procesarea documentelor, workeri, evaluarea căutării și sistemul de pluginuri cu pluginuri de test. |
| `plugins/` | One suite per official plugin (`<id>.test.ts`), often with the plugin's real programs. Not part of `npm test`; run with `npm run test:plugins`. |
| `packaging/` | Pregătirea distribuției, smoke-ul de pachet, proba de actualizare și actualizările. |
| `e2e/` | Fluxuri complete în Electron și browser, rulate cu Playwright. |
| [fixtures/](fixtures/README.md) | Date fictive și scenarii de intrare; nu sunt rezultate de teste și nu conțin cod de evaluare. |
| `support/` | Rularea E2E, reporterul Playwright, protecția de rețea și generatoarele documentelor demo/Office. Programele simulate și generatoarele unei singure fixturi rămân lângă aceasta, în `fixtures/`. |

Native `e2e/display-masking.spec.ts` verifies conditional Display masking with stored MQTT credentials,
Files/Find UI selection, colliding labels, live settings/workbench choices and restart-safe tabs.

## Inventarul testelor Vitest

TERM-05 adds `packaging/terminal-runtime.test.ts` for native PTY architecture/helper closure,
and `e2e/terminal.spec.ts` for actual typed input, resize/reflow, per-terminal agent consent,
Linux background-job cleanup on close/workbench replacement/shutdown,
revocation, close/switch cleanup and CSP under native or extracted packaged Electron. Set
`VERA_TERM05_APP` to an explicitly extracted app binary and `VERA_TERM05_EVIDENCE_DIR` to owned
evidence. `VERA_TERM05_SKIP_AGENT=1` limits release-artifact smoke to user terminal behavior.

### Tooling

| Fișier | Ce verifică |
|---|---|
| [boundaries.test.ts](tooling/boundaries.test.ts) | Separarea modulelor prin regulile de import. |
| [build-mode.test.ts](tooling/build-mode.test.ts) | Identitatea și hook-urile compilate în modurile release/instrumentat. |
| [demo-documents.test.ts](tooling/demo-documents.test.ts) | Generatorul PDF al fixturilor și concordanța inventarului cu fișierele. |
| [i18n.test.ts](tooling/i18n.test.ts) | Verificatorul cataloagelor de traducere. |
| [network-guard.test.ts](tooling/network-guard.test.ts) | Blocarea conexiunilor externe în mediul de test. |
| [session-performance.test.ts](tooling/session-performance.test.ts) | Fixturile, raportul și comparația harness-ului de performanță. |
| [session-performance-probe.test.ts](tooling/session-performance-probe.test.ts) | Sondele de performanță compilate în aplicație. |
| [skeleton.test.ts](tooling/skeleton.test.ts) | Workspaces, configurația TypeScript și comenzile proiectului. |
| [test-discovery.test.ts](tooling/test-discovery.test.ts) | Descoperirea fișierelor de test de către proiectele Vitest. |

### Integration

`commands.test.ts` runs actual shell acceptance through `support/command-platform-probe.ts`
(foreground output, Unicode quoting, clean environment, closed stdin, readiness and tree cleanup).

| Fișier | Ce verifică |
|---|---|
| [cli.test.ts](integration/cli.test.ts) | Procesul CLI, argumente, sesiuni, aprobări, ieșire și curățarea resurselor. |
| [document-cli.test.ts](integration/document-cli.test.ts) | Indexarea și căutarea documentelor prin CLI. |
| [document-hosts.test.ts](integration/document-hosts.test.ts) | Procesarea PDF și modelele locale pentru desktop/CLI, în layout de surse și de distribuție. |
| [retrieval.test.ts](integration/retrieval.test.ts) | Evaluarea clasamentelor, întrebărilor fixe, FTS și fuziunii rezultatelor. |
| [worker-hosts.test.ts](integration/worker-hosts.test.ts) | Worker-ele desktop/CLI, anularea, limitele de timp și înlocuirea worker-elor. |

### Packaging

| Fișier | Ce verifică |
|---|---|
| [packaging.test.ts](packaging/packaging.test.ts) | Modele/DLL-uri, payload nativ, resurse, ASAR și limitele pachetelor. |
| [package-smoke.test.ts](packaging/package-smoke.test.ts) | Uneltele smoke: extragere, identități, observarea rețelei și interpretarea dovezilor. |
| [prepare-plugins.test.ts](packaging/prepare-plugins.test.ts) | Construirea și verificarea catalogului de pluginuri inclus. |
| [updates.test.ts](packaging/updates.test.ts) | Configurația feed-ului de actualizare și serverul local folosit la verificări. |

## Rulare

Din `05_Software`, se poate selecta unul dintre cele trei proiecte Vitest:

```powershell
python ../02_Tools/environment/npmw.py npm test -- --project tooling
python ../02_Tools/environment/npmw.py npm test -- --project integration
python ../02_Tools/environment/npmw.py npm test -- --project packaging
```

The official plugins have their own suite, outside `npm test` and `npm run verify`:

```powershell
python ../02_Tools/environment/npmw.py npm run test:plugins
python ../02_Tools/environment/npmw.py npx vitest run tests/plugins/kicad.test.ts
```

Run it when a plugin or the plugin system changes and before a delivery; `npm run verify:all`
runs `verify` and then the plugin suite.

Pentru un singur fișier:

```powershell
python ../02_Tools/environment/npmw.py npx vitest run tests/integration/document-cli.test.ts
```

`vitest.config.ts` și configurațiile workspace-urilor înregistrează aceleași reguli de
izolare a rețelei prin `support/network-setup.ts` și `support/network-guard.ts`.

În mod implicit, rezultatele verificărilor sunt afișate în terminal. Rapoartele de
coverage necesită comanda explicită `npm run test:coverage`. Politica de selecție a
verificărilor este în [02_Tools/verification-policy.md](../../02_Tools/verification-policy.md).

## E2E

`npm run test:e2e` rulează [support/test-e2e.mjs](support/test-e2e.mjs): compilează
desktopul, apoi lansează Playwright cu `playwright.config.ts`; pe Linux folosește
`xvfb-run -a`. Argumentele suplimentare sunt transmise către Playwright:

```powershell
python ../02_Tools/environment/npmw.py npm run test:e2e -- tests/e2e/workbench.spec.ts
```

Testele care folosesc hook-uri de instrumentare cer un build cu `VERA_TEST=1`;
scriptul de rulare nu activează singur această opțiune.

Build-ul E2E rescrie `src/apps/desktop/out`, folosit și de development. Închide
instanța development înaintea acestor teste: modulele încă neîncărcate dintr-un
proces deschis pot ajunge să folosească fișiere din alt build. După teste,
pentru verificarea manuală, repornește `npm run dev` cu `VERA_TEST=0`, astfel
încât procesul și toate modulele sale să provină din același build.

Output-ul E2E este un director temporar al sistemului, eliminat la final de
reporterul [support/cleanup-e2e-output.mjs](support/cleanup-e2e-output.mjs), inclusiv
după eșecuri. Configurația dezactivează trace/video/capturi automate. Înlocuirea
reporterelor din CLI poate ocoli reporterul de curățare.

## Support

| Fișier | Ce face | Cum este folosit / rezultat |
|---|---|---|
| [test-e2e.mjs](support/test-e2e.mjs) | Compilează desktopul și pornește Playwright. | `npm run test:e2e`; vezi [E2E](#e2e). |
| [cleanup-e2e-output.mjs](support/cleanup-e2e-output.mjs) | Reporter Playwright care șterge directorul temporar al rulării după scrierea metadatelor finale. | Încărcat de `playwright.config.ts`; nu se execută direct. |
| [dev-test-server.mjs](support/dev-test-server.mjs) | Compilează main/preload în modul development și pornește serverul Vite, fără o instanță Electron suplimentară. | Folosit de testul HMR din `e2e/shell.spec.ts`, cu `--prepare` sau `--serve` și un `VERA_BUILD_ROOT` izolat. Afișează `VERA_DEV_READY`. |
| [network-setup.ts](support/network-setup.ts), [network-guard.ts](support/network-guard.ts) | Blochează conexiunile non-loopback în testele Vitest și raportează tentativele. | `setupFiles` în configurațiile Vitest. |
| [make-demo-pdfs.mjs](support/make-demo-pdfs.mjs) | Generează reproductibil cele trei PDF-uri fictive din Markdown-ul demo-ului. | `npm run make:demo-pdfs`; citește `fixtures/workbenches/demo-board/sources/` și rescrie PDF-urile din `fixtures/workbenches/demo-board/docs/`. |
| [make-office-fixtures.mjs](support/make-office-fixtures.mjs) | Generează determinist documentele Office din `fixtures/documents/office/`. | `node tests/support/make-office-fixtures.mjs`. |

PDF-urile și documentele Office fictive sunt date de test versionate. Generarea lor
poate modifica fișiere urmărite de Git.

Serverul renderer-ului pentru specificațiile E2E de browser este comanda de
dezvoltare [`02_Tools/environment/dev-renderer.mjs`](../../02_Tools/environment/dev-renderer.mjs).
Bridge-ul simulat al interfeței rămâne în `src/apps/desktop/src/renderer/mocks/`: este
selectat la compilare prin `VITE_API=mock` și eliminat din build-urile normale, iar
mutarea lui sub `tests/` ar face ca sursa produsului să importe cod de test.

## Packaging

Smoke-ul de pachet și proba de actualizare verifică artefacte reale. Sunt diferite de
testele E2E obișnuite: păstrează rapoarte și loguri în directoarele explicit alese
pentru diagnosticare sau în directoare temporare.

| Fișier | Ce face | Cum este folosit / rezultat |
|---|---|---|
| [smoke-package.mjs](packaging/smoke/smoke-package.mjs) | Verifică un artefact release deja construit: extragere/instalare, pornire, indexare, PDF, unelte, aprobare și persistență după restart, cu un furnizor simulat local pentru fluxul scriptat. | `npm run smoke:package -- --artifact <path>`; opțional `--scratch <new-directory>`, `--resume <failed-run>`, `--upgrade-proof <report>` (repetabil) și `--windows-evidence <json>`. Nu compilează. Păstrează `smoke-report.json`, extrageri, profiluri izolate și loguri. Poate instala NSIS dacă nu există deja o instalare VERA. |
| [smoke-calibration.mjs](packaging/smoke/smoke-calibration.mjs) | Calibrează pe Linux observarea conexiunilor unui renderer instrumentat, folosind deliberat un endpoint care trebuie detectat de oracle-ul de rețea. | `node tests/packaging/smoke/smoke-calibration.mjs <built-test-app-directory> <new-scratch>`; cere build separat cu `VERA_TEST=1`, Electron local și `strace`. Generează `calibration-report.json`; nu reprezintă validarea unui release. |
| [smoke-runtime.mjs](packaging/smoke/smoke-runtime.mjs) | Extrage artefacte, pregătește profiluri și copii demo, pornește/oprește aplicația și colectează identități de execuție și loguri. | Modul intern al smoke-ului și calibrării; include observarea externă Linux cu `strace`. |
| [smoke-server.mjs](packaging/smoke/smoke-server.mjs) | Furnizor HTTP/SSE local și verificări ale bugetelor de cerere/context pentru fluxul scriptat. | Modul intern, fără CLI propriu. |
| [smoke-egress.mjs](packaging/smoke/smoke-egress.mjs) | Analizează trace-urile de rețea, inclusiv tentativele eșuate, și verifică destinațiile permise exact. | Modul intern; furnizează și regula pentru endpoint-ul loopback permis. |
| [smoke-report.mjs](packaging/smoke/smoke-report.mjs) | Parsează argumentele, calculează hash-uri și combină stările funcționale, de rețea și dovezile suplimentare. | Modul intern; interpretează dovezile Windows și raportul probei de actualizare (`--upgrade-proof`), clasificat ca dovadă instrumentată suplimentară WP31. |
| [probe-upgrade.mjs](packaging/probe-upgrade.mjs) | Construiește build-uri instrumentate și verifică actualizarea: build-ul gestionat (deb) primește doar metadate, SHA-512 este obligatoriu și un hash corupt este refuzat, instalarea așteaptă terminarea aprobării și apoi instalează real, iar build-ul portabil primește un link de release. | `node tests/packaging/probe-upgrade.mjs <owned-scratch>`; `--reuse` reutilizează raportul existent în condițiile verificate de script. Păstrează `upgrade-report.json`, build-uri și loguri. |

Pentru `smoke-package.mjs`, codurile de ieșire sunt: `0` = PASS complet,
`1` = eșec, `2` = flux funcțional trecut cu dovada de rețea a platformei încă
în așteptare. Procedura completă este în
[release-package-smoke.md](../../06_SoftwareDocu/release-package-smoke.md).

`probe-upgrade.mjs` este un harness istoric cu versiuni și commit-uri de bază
fixate în cod, nu un test generic de rulat după fiecare modificare. Necesită
acele revizii Git, uneltele platformei și un director de lucru propriu; poate
executa installer-e și dezinstalări pentru identitățile sale de test. Intrările
sale de build includ `05_Software` și uneltele din `02_Tools/{environment,build,release}`.
Proba nu verifică migrarea datelor și nici păstrarea setărilor, a istoricului sau a
recuperării după actualizare; siguranța datelor la upgrade este amânată până la prima
versiune publică.

Lansatoarele mediilor de release (VM Linux offline, Windows offline și Windows Sandbox)
sunt în [02_Tools/release](../../02_Tools/README.md#release).

`e2e/bookmarks.spec.ts` covers message/preview bookmark controls in four browser languages and native restart/archive guards.

`e2e/bookmark-navigation.spec.ts` covers sparse/grouped marker styling, three marks in long sessions, browser renderer restart against a retained mock backend, native process restart and next/previous navigation with localized Settings entries in en/ro/de/fr.

Bypass acceptance (`e2e/bypass.spec.ts`) covers per-change confirmation/cancellation in all four languages and native application-data refusal for actual read/write calls, alongside ordinary outside-file edits and restart. The configured CLI application-data boundary is exercised in `integration/cli.test.ts`; immediate irreversible-plugin approval behavior remains in `e2e/program-approvals.spec.ts`.

Confined agent-input application-data exclusions also have shared core coverage in `src/libraries/core/src/tools/app-data-inputs.test.ts`, with candidate/apply, program/runner and HIL regressions beside those implementations.

`e2e/program-bypass.spec.ts` uses two owned sibling Git repositories and the local echo-tools fixture to verify Bypass edits, real outside cwd execution, absolute JSON/Markdown export paths, workbench-owned logs, and background revocation after turn completion. `VERA_BYP01_EVIDENCE_DIR` retains exports, native snapshot and original logs. `core/src/plugins/program-bypass.test.ts` adds mode, argument-hash, alias and exclusion boundaries; `core/src/sessions/programs.test.ts` checks the durable session revocation signal.

`integration/hil-bypass.test.ts` runs real standard-library HIL/lab-validation helpers on owned sibling inputs, checking canonical requests, host input policy exclusions and workbench-only output without instruments or external accounts.

`e2e/command-prefixes.spec.ts` covers native command approval, format1 persistence/restart, Auto-edit/Ask and destructive refusal, immediate removal including credential-masked grants and unrelated-save preservation, plus four-language browser editor Save/Cancel. Native receipts use VERA_TERM02_EVIDENCE_DIR.

`e2e/additional-folders.spec.ts` proves native General chooser Save/Cancel, sibling Ask read/command,
unlisted/protected refusal, restart, pending-request revocation, masked unrelated save/removal and
four-locale browser controls. VERA_TERM03_EVIDENCE_DIR retains native proof. Core
`tools/additional-folders.test.ts` covers ordinary file operations, worker revocation and protected aliases.

`integration/additional-folders.test.ts` runs `support/additional-folder-platform-probe.ts` against real files and shell processes; the same probe bundles for pinned WSL2 Node without a second dependency tree.

`e2e/command-runs.spec.ts` proves real sibling server readiness, live masked command/folder/output, Runs Stop of the whole tree, next agent output stopped, full viewer logs, exit code/duration and session isolation. Original receipts use `VERA_TERM04_EVIDENCE_DIR`.

`support/command-runs-platform-probe.ts` bundles current source for pinned Linux Node: real sibling command server, scoped run identity, short-read-safe full/tail logs, Stop and next agent output.

`e2e/run-masking.spec.ts` proves native stored MQTT credentials in actual command output, run arguments/canonical cwd, provisioning statuses, tail/full logs and terminal snapshots with live app/workbench overrides and two-workbench isolation. Original receipts/logs use evaluation-outputs/mask03; no delivery artifacts are rebuilt.
