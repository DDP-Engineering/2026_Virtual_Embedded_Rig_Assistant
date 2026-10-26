# Organizarea testelor

Acest director conține verificările care folosesc mai multe componente și datele
lor de intrare. Testele unitare și de componente aflate lângă implementare rămân
în `src/apps/` și `src/libraries/`.

| Director | Rol |
|---|---|
| `tooling/` | Configurație, compilare, reguli de import, traduceri și infrastructura testelor. |
| `integration/` | CLI, procesarea documentelor, workeri și evaluarea căutării. |
| `packaging/` | Pregătirea distribuției, verificările smoke și actualizările. |
| `e2e/` | Fluxuri complete în Electron și browser, rulate cu Playwright. |
| [fixtures/](fixtures/README.md) | Date fictive și scenarii de intrare; nu sunt rezultate de teste. |

## Inventarul testelor Vitest

### Tooling

| Fișier | Ce verifică |
|---|---|
| [boundaries.test.ts](tooling/boundaries.test.ts) | Separarea modulelor prin regulile de import. |
| [build-mode.test.ts](tooling/build-mode.test.ts) | Identitatea și hook-urile compilate în modurile release/instrumentat. |
| [demo-documents.test.ts](tooling/demo-documents.test.ts) | Generatorul PDF al fixturilor și concordanța inventarului cu fișierele. |
| [i18n.test.ts](tooling/i18n.test.ts) | Verificatorul cataloagelor de traducere. |
| [network-guard.test.ts](tooling/network-guard.test.ts) | Blocarea conexiunilor externe în mediul de test. |
| [skeleton.test.ts](tooling/skeleton.test.ts) | Workspaces, configurația TypeScript și comenzile proiectului. |

### Integration

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
| [updates.test.ts](packaging/updates.test.ts) | Configurația feed-ului de actualizare și serverul local folosit la verificări. |

## Rulare

Din `05_Software`, se poate selecta unul dintre cele trei proiecte Vitest:

```powershell
python ../02_Tools/npmw.py npm test -- --project tooling
python ../02_Tools/npmw.py npm test -- --project integration
python ../02_Tools/npmw.py npm test -- --project packaging
```

Pentru un singur fișier:

```powershell
python ../02_Tools/npmw.py npx vitest run tests/integration/document-cli.test.ts
```

`vitest.config.ts` înregistrează cele trei categorii și aplică aceleași reguli de
izolare a rețelei prin `network-setup.ts` și `network-guard.ts`. Aceste două fișiere
sunt infrastructură comună, nu rezultate generate.

Testele E2E se rulează separat prin `npm run test:e2e`; configurația lor este în
`playwright.config.ts`. În mod implicit, rezultatele verificărilor sunt afișate în
terminal. Rapoartele de coverage necesită comanda explicită `npm run test:coverage`.
