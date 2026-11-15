# TASK-e35eedbe - PERF-11 Startup and first-token latency (#259)

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-NFR-54822de2, REQ-REL-ff1b5e56, REQ-SEC-613bf976, REQ-UX-86acd705, REQ-NFR-9b03e401, REQ-NFR-f3e0377c, REQ-NFR-4d0324ed
parent:
branch: feature/249-responsiveness
base: ff4f0ee2bd520f7c2f30c72cd952136603114f3a
opened: 2026-11-14

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: OBSERVED (`apps/desktop/src/main/index.ts` 1101-1102, 955-961): startup awaits `settings.load()`, then
`credentials.load()`, then the window-state read inside `createWindow`; a credential load failure exits the app
(`app.startup.failed`). The `BrowserWindow` has no `backgroundColor`. OBSERVED (build-before log): the renderer entry
chunk is 2,535.87 kB and unminified (electron-vite 5 sets renderer `minify: false` by default,
`node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js:536`). OBSERVED (`knowledge/embedding-worker.ts:18`): the
embedding model loads when the worker is created, which happens on the first embed or rank of a workbench root.
Desired outcome: STATED (#259 Goal): the first window appears without a white flash and without waiting for
credentials; startup parses only the code the first screen needs; the first semantic search in a session is as fast
as later ones; no network request repeats per agent iteration when its answer cannot have changed.
Actors: the desktop main process at launch, the renderer's first IPC calls, a user sending the first message of a
session in a workbench with indexed documents, the agent runtime calling `prepareModel` each iteration.
Primary scenario: launch VERA, the window paints the themed background at once, the renderer loads a minified
bundle, the user opens a workbench and sends a message; while the model answers, the embedding model loads.
Examples: STATED (#259 Tests): a credential load failure still opens the window; a credential-dependent IPC call
waits for loading and then succeeds; opening a workbench with documents starts exactly one worker and closing
terminates it; two agent iterations with the same model call the ChatGPT model list once.
Counterexamples: a workbench without indexed vectors for the current model starts no warm-up (INFERRED from the
ticket's "has indexed documents").
In scope: STATED (#259 plan 1-5, coordinator brief): parallel settings/credentials/window-state load with IPC gated
on a shared credentials-ready promise; `backgroundColor` from the saved theme via `nativeTheme`; a smaller first
bundle; an embedding warm-up with cancel on close; verify the ChatGPT model-list cache and only document it if present.
Out of scope: STATED (brief): lazy `Markdown` unless simple and layout-stable; `manualChunks` unless the bundle report
shows a benefit; low-memory settings (OBSERVED: none exist in `libraries/shared` settings).
Constraints: STATED (brief): simple and stable; Windows and Linux; parallel loading must not change the Linux
`safeStorage` backend; no compat code, format versions stay 1; at most two review rounds; targeted tests only.
Success signals: renderer entry chunk smaller in the build output; window shown without awaiting credentials; the
first and second embedding calls take similar time after a warm-up; the model-list fetch count stays 1 over two
`prepareModel` calls.
Evidence: OBSERVED: `rehype-highlight` 7.0.2 already defaults to lowlight `common` (37 grammars); the built chunk
contains no `armasm`/`x86asm`/`verilog`/`dts` grammar. OBSERVED (`llm/providers.ts` 180-247): the ChatGPT catalog is
cached per token/account for up to 300 s (Cache-Control aware) with in-flight dedupe. OBSERVED (`credentials.ts`
126-129): `load()` is memoized and `read`/`list`/`modify` await it; `scrub`/`containsSecret`/`sanitize` are
synchronous and need loaded secrets. OBSERVED (`indexer-host.ts`, `workbench/service.ts:347`): closing a workbench
releases its embedding worker in the indexer process.
Assumptions: INFERRED: gating every invoke and subscription on credentials-ready keeps the redaction boundary
correct, because every renderer-facing value is produced after that gate.
Unknowns: UNKNOWN: Linux keyring timing on GNOME/KWallet (Windows host only here).
Decision-blocking questions: none. The brief delegates warm-up timing (open vs first message) to design.
Proposed behaviors (not accepted until specify): renderer `minify: true`; IPC router `ready` gate; credential load
failure logged and IPC continues (credential operations reject); embedding warm-up on the first message.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | a credential load failure no longer stops startup |
| no new interface or data format | yes | no IPC channel or file format changes |
| no new dependency | yes | none |
| an existing requirement already covers the behavior | no | no startup-latency or warm-up requirement |
| no security or data-handling change | unknown | the redaction boundary now depends on an IPC gate |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| Concurrent settings, credentials and window-state load; window without credentials | REQ-NFR-54822de2 |
| Credential load failure opens the window, credential operations reject | REQ-REL-ff1b5e56 |
| IPC invoke and subscription wait for the settled credential load | REQ-SEC-613bf976 |
| Window background follows the theme | REQ-UX-86acd705 |
| Minified renderer entry chunk | REQ-NFR-9b03e401 |
| Embedding warm-up on the first message, cancelled on close | REQ-NFR-f3e0377c |
| ChatGPT model list reused across iterations (existing cache, documented) | REQ-NFR-4d0324ed |

## Design

- Startup (`index.ts` whenReady): `credentialsReady = credentials.load().then(() => {}, () => log credentials.load.failed)`
  starts first; `settings.load()` and `loadWindowState()` run under `Promise.all`; `createWindow(state)` takes the
  loaded state. Smoke/test branches that use credentials already await `credentials.read` (memoized `load`).
  Linux: Electron picks the `safeStorage` backend at app ready from the desktop and `--password-store`; the load
  still starts after `whenReady`, so concurrency does not change the backend.
- IPC gate: `createInvokeRouter({ ready })` awaits `ready()` after authorization and request parsing, before
  dispatch; `vera:subscription` awaits `credentialsReady` before `sessions.subscription`. `ready` never rejects.
- Background: `windowBackground(dark)` in `window-chrome.ts` returns the `--background` tokens of `themes.css`;
  `nativeTheme.themeSource` is already set from settings before the window, so `shouldUseDarkColors` gives the saved
  theme or the OS theme for `system`. The `nativeTheme` `updated` handler also calls `setBackgroundColor`.
- Bundle: renderer `build.minify: true` (esbuild). Dropped: highlight language subset (rehype-highlight 7 already
  registers lowlight `common` only); lazy `Markdown` (8 importers and synchronous render tests; minify gives most of
  the gain); `manualChunks` (all first-screen chunks load from local disk anyway, no cache benefit).
- Embedding warm-up: `embedding-warmup.ts` `createEmbeddingWarmup({ hasVectors, embed })` with `request(id)` and
  `cancel()`. Decision: warm on the first `session.send` of an open workbench, not on open, because PERF-10 already
  spawns probes on open, RAM is used only when the user chats, and model load overlaps the model's first answer;
  no idle delay is needed. `hasVectors` reads `SELECT 1 FROM embeddings WHERE model_id=? LIMIT 1` through
  `workbench.readDocuments`; the embed runs outside the lifecycle queue. `cancel()` runs before workbench
  create/open/close; close already releases the worker in the indexer.
- Model list: no code change; a test pins the existing 300 s catalog cache.

## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify - frame recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: red: vitest ipc-router, window-chrome, embedding-warmup, build-mode exit 1 - missing ready gate, windowBackground, warm-up module, unminified renderer (69487 lines) (REQ-SEC-613bf976, REQ-UX-86acd705, REQ-NFR-f3e0377c, REQ-NFR-9b03e401)
- 2026-11-14 build: green before change: subscription.test.ts prepareModel twice fetches once - the ChatGPT catalog cache already exists, documented only (REQ-NFR-4d0324ed)
- 2026-11-14 build: green: vitest ipc-router, window-chrome, embedding-warmup, subscription, credentials, window-state, indexer-host, build-mode exit 0; npmw.py run typecheck exit 0; biome check on changed files clean (REQ-SEC-613bf976, REQ-UX-86acd705, REQ-NFR-f3e0377c, REQ-NFR-9b03e401, REQ-NFR-4d0324ed)
- 2026-11-14 build: green: VERA_TEST=1 build, playwright tests/e2e/startup.spec.ts exit 0 - corrupt credentials.json opens the dark window, settings IPC answers, file unchanged, credentials.load.failed logged (REQ-REL-ff1b5e56, REQ-NFR-54822de2, REQ-UX-86acd705)
- 2026-11-14 build: DEVIATION build: the startup e2e was written after the index.ts change, so no red run - the old exit on a failed credential load is observed in HEAD index.ts (await credentials.load() inside the startup chain whose catch exits 1)
- 2026-11-14 build: measure: renderer entry 2,535,871 -> 1,180,917 B, pdf-viewer 867,213 -> 442,441 B, css 68,504 -> 55,519 B; V8 compile of the entry ~24 -> ~19 ms; launch->visible warm 842-873 -> 839-857 ms (no measurable change on Windows); first rank 433-584 ms cold vs 40-49 ms after warm-up, second ~12 ms
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 1: both approved; spec reviewer and own pass note CredentialFile.close() rethrows a failed load, so quit after a failed credential load skips settings.close() and logger.flush() - fixing in build
- 2026-11-14 validate: returned to build - close() must tolerate a failed credential load (REQ-REL-ff1b5e56)
- 2026-11-14 build: red: vitest credentials.test.ts exit 1 - close() rejected INVALID after a failed load (REQ-REL-ff1b5e56)
- 2026-11-14 build: green: vitest credentials, ipc-router, embedding-warmup, window-chrome, provider-settings, chatgpt-auth exit 0 (67 tests); typecheck exit 0 (REQ-REL-ff1b5e56)
- 2026-11-14 build: completed; next validate - round-1 finding fixed (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: Inspection REQ-NFR-54822de2: index.ts whenReady starts credentials.load() first, then Promise.all(settings.load, loadWindowState); createWindow(windowState) awaits no credential promise - holds
- 2026-11-14 validate: final: aegis check --task TASK-e35eedbe --strict --run exit 0; lint, typecheck, i18n ok (test not in [check] run - targeted vitest and the startup e2e ran in build); task warnings: ticket-ref on colour #101316 in REQ-UX-86acd705 (a hex colour, not a ticket), uncovered-source on embedding-warmup.test.ts (a test file); the remaining 52 warnings are pre-existing repository-wide
- 2026-11-14 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-14 | decision=Warm the embedding model on the first message of an open workbench with vectors, not on open; no idle delay | reason=PERF-10 already warms plugin probes on open; RAM only when the user chats; model load overlaps the first LLM answer; the coordinator brief delegates this choice to design | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e35eedbe.md
changed: parallel startup loads with IPC credentials gate, failed credential load opens the app, themed window background, minified renderer, first-message embedding warm-up, catalog cache pinned by test
evidence: aegis check --strict --run exit 0; targeted vitest exit 0; typecheck exit 0; startup e2e exit 0; build-mode exit 0
issues: Linux not run natively; startup e2e had no red run; renderer CSS also minified (typography e2e not run)
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-14)

- stage: validate; type: change; path: full; branch: feature/249-responsiveness
- requirements:
  - REQ-NFR-54822de2 - Load startup state concurrently and open the window without awaiting credentials
  - REQ-REL-ff1b5e56 - Open the window when the credential file fails to load
  - REQ-SEC-613bf976 - Gate renderer IPC on the settled credential load
  - REQ-UX-86acd705 - Paint the window background in the active theme colour
  - REQ-NFR-9b03e401 - Minify the production renderer bundle
  - REQ-NFR-f3e0377c - Warm the embedding model on the first message of an indexed workbench
  - REQ-NFR-4d0324ed - Reuse the ChatGPT model list across agent iterations
- deviations: 1 recorded
  - build: the startup e2e was written after the index.ts change, so no red run - the old exit on a failed credential load is observed in HEAD index.ts (await credentials.load() inside the startup chain whose catch exits 1)
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base ff4f0ee: 26 file(s) changed, 710 line(s) added
- checks: errors=0 warnings=54 notes=28
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
