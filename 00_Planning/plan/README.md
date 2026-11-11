# VERA implementation plan

PURPOSE: the order in which VERA 1.0 is built — milestones, work packages, dependencies and risks —
and the decisions taken with the user that shape it. Specs: `../architecture/`; decisions: `../decisions/`.
STATE: planned 2026-10-09; implemented — WP-01…WP-38 and the epics M0–M5 are closed in Gitea. This file and the milestone files are now the historical record of the plan. What the code
actually does is in `../architecture/`; per-WP outcomes are in the "Implementation notes" section of
each milestone file. New work is planned in `../plugins/plan.md`, `../capabilities/` and
[plugins-ui-redesign.md](plugins-ui-redesign.md) (PLG-23…PLG-25, accepted 2026-11-11; not implemented).

## 0. Outcome (2026-11-01)

| Milestone | Outcome |
|---|---|
| M0 | Implemented. shadcn/ui only scaffolded (hand-written CSS); six text sizes plus separate chat/code sizes; custom window chrome; the WP-05 measurement record was later deleted (ADR-0013) |
| M1 | Implemented. A send during a running turn is queued as steering instead of refused with BUSY; the prompt size is not shown in the UI; the workbench database has no migrations (one complete schema, `schema_version` 1; any other value is INVALID) |
| M2 | Implemented, plus a fourth permission mode `bypass`. `.vera/` is refused outright outside bypass, so "protected paths ask in auto-edit" only applies to `web_download` |
| M3 | Implemented. Office documents are indexed; `.log` files are not; default chunking uses 1 400-character windows; indexing runs in the VERA Indexer utility process; the retrieval eval does not use the product's chunking |
| M4 | Implemented. No size budget (removed 2026-11-01, ADR-0017); About shows no "unsigned build" label; WP-32 (upgrade and migration safety) is deferred until the first public release and its code and fixtures were removed; clean offline Windows, release-artifact update and Windows pktmon evidence still pending |
| M5 | Implemented, except: session search has no UI; the demo workbench and onboarding were removed on 2026-10-26 (WP-37 now means fictional verification fixtures); human review of `ro`/`de` translations is not recorded |
| Beyond the plan | web search/read (Exa, Tavily, Brave) and approved `web_download`; reasoning-level picker; session archive and manual ordering; customisable keyboard shortcuts; CLI `vera index` and `vera search` |

## 1. Decisions taken with the user (2026-10-09)

- Code from the earlier BenchPilot proof of concept is reused; its snapshot is in
  `09_Others/benchpilot-reference/`. Every work package names the files it starts
  from; the full map is [benchpilot-reuse.md](benchpilot-reuse.md).
- ChatGPT-subscription sign-in is acceptable for the way VERA will be distributed.

## 2. Milestones

| Milestone | Plan | DONE-WHEN |
|---|---|---|
| **M0 Foundation** | [M0-foundation.md](M0-foundation.md) | the launch e2e passes on Windows and Ubuntu with the security baseline (01 §7); theme, text size and language switch and persist; the packaging spike WP-05 has filed its ADR |
| **M1 Read-only agent** | [M1-read-only-agent.md](M1-read-only-agent.md) | the agent reads and cites files; every request fits its context budget, including a long first turn; grep timeout/abort leaves IPC responsive; sessions survive restart; `vera run` prints the same events headless; real-provider smoke is manual |
| **M2 Edits, artifacts, ChatGPT** | [M2-edits-artifacts-chatgpt.md](M2-edits-artifacts-chatgpt.md) | approval is bound to one exact change and used once; sessions share one write queue per workbench; restart recovers interrupted approvals and writes; protected paths ask even in `auto-edit` (as built: `.vera/` is refused outside `bypass`, so only `web_download` asks in `auto-edit`); panels and ChatGPT sign-in work |
| **M3 Knowledge** | [M3-knowledge.md](M3-knowledge.md) | demo PDFs, Markdown and logs index in the background; hybrid `search_docs` meets the recall threshold; citations open the viewer at the cited page; skills load from workbench and user folders |
| **M4 Delivery** | [M4-delivery.md](M4-delivery.md) | release artifacts install and index offline on both systems; a scripted loopback endpoint drives the normal provider path; the egress check finds no unexpected connection; vN → vN+1 updates through the updater (data preservation across versions is WP-32, deferred until the first public release) |
| **M5 Version 1.0** | [M5-version-1.md](M5-version-1.md) | historical compaction extends the M1 context budget; messages can be sent during a turn; sessions export; fictional fixtures support verification; translations reviewed; final 1.0 release smoke passes |

## 3. Work packages

| WP | Title | Milestone | Depends on |
|---|---|---|---|
| WP-01 | Electron shell and source skeleton | M0 | — |
| WP-02 | Shared contracts and the typed IPC bridge | M0 | 01 |
| WP-03 | App data locations, settings and logging | M0 | 02 |
| WP-04 | UI foundation: layout, themes, text size, languages | M0 | 03 |
| WP-05 | Spike: native modules and the embedding model in packaged builds | M0 | 01 |
| WP-06 | Workbench format, create and open, Welcome screen | M1 | 04 |
| WP-07 | Workbench database and migrations (built without migrations: one schema, version 1) | M1 | 05, 06 |
| WP-08 | Credential store and provider settings | M1 | 04 |
| WP-09 | LLM gateway, connection test, replay provider | M1 | 08 |
| WP-10 | Spike: agent runtime | M1 | 09 |
| WP-11 | Path guard, tool registry, read-only file tools | M1 | 06 |
| WP-12 | System prompt builder | M1 | 06 |
| WP-13 | Session engine | M1 | 07, 09, 10, 11, 12 |
| WP-14 | Chat UI | M1 | 04, 13 |
| WP-15 | Headless CLI | M1 | 13 |
| WP-16 | Write and edit tools | M2 | 11, 13 |
| WP-17 | Permission modes and approvals | M2 | 14, 16 |
| WP-18 | Changes panel | M2 | 17 |
| WP-19 | Session artifacts | M2 | 14 |
| WP-20 | Plan tool and panel | M2 | 14 |
| WP-21 | ChatGPT subscription sign-in | M2 | 09 |
| WP-22 | Ingest pipeline | M3 | 07 |
| WP-23 | Extraction, chunking, demo documents | M3 | 22 |
| WP-24 | Spike: embedding model | M3 | 05, 23 |
| WP-25 | Keyword index | M3 | 23 |
| WP-26 | Embeddings, hybrid search, document tools | M3 | 24, 25 |
| WP-27 | Citations for every reference kind | M3 | 26 |
| WP-28 | Document viewer and Docs panel | M3 | 27 |
| WP-29 | Skills | M3 | 12 |
| WP-30 | Packaging targets | M4 | 05, 26 |
| WP-31 | Auto-update | M4 | 30 |
| WP-32 | Upgrade and migration safety (deferred until the first public release) | M4 | 17, 30 |
| WP-33 | Release-package smoke and egress check | M4 | 18, 28, 30, 31, 32 |
| WP-34 | Advanced context compaction | M5 | 10, 13, 14 |
| WP-35 | Messages during a running turn | M5 | 13, 14 |
| WP-36 | Session export and search | M5 | 13 |
| WP-37 | Demo workbench, sample skills, onboarding (delivered as fictional verification fixtures; demo and onboarding removed 2026-10-26) | M5 | 29 |
| WP-38 | Accessibility and translation pass | M5 | all UI packages |

## 4. Dependencies, M0–M2

```mermaid
flowchart LR
  W01[01 shell] --> W02[02 IPC] --> W03[03 settings] --> W04[04 UI base]
  W01 --> W05[05 spike: packaging]
  W04 --> W06[06 workbench]
  W06 --> W07[07 database]
  W05 --> W07
  W04 --> W08[08 credentials] --> W09[09 LLM gateway] --> W10[10 spike: runtime]
  W06 --> W11[11 read tools]
  W06 --> W12[12 prompt]
  W07 --> W13[13 sessions]
  W09 --> W13
  W10 --> W13
  W11 --> W13
  W12 --> W13
  W13 --> W14[14 chat UI]
  W13 --> W15[15 CLI]
  W13 --> W16[16 write, edit]
  W11 --> W16
  W14 --> W17[17 approvals]
  W16 --> W17
  W17 --> W18[18 changes]
  W14 --> W19[19 artifacts]
  W14 --> W20[20 plan]
  W09 --> W21[21 ChatGPT]
```

Critical path: WP-01 → 02 → 03 → 04 → 08 → 09 → 10 → 13 → 14 → 17. The packaging spike WP-05 runs
in parallel from WP-01 and must finish before the database (WP-07).

## 5. Risks

| ID | Risk | Mitigation | Watch in |
|---|---|---|---|
| R-01 | pi-ai changes its API | exact pin; one wrapper module; replay tests | WP-09 |
| R-02 | A native module (better-sqlite3, onnxruntime-node) fails in a packaged build | spike in M0; plan B `node:sqlite`; WASM ONNX backend as last resort | WP-05 |
| R-03 | The ChatGPT sign-in flow changes on OpenAI's side | isolated module; API key and local endpoints keep working | WP-21 |
| R-04 | Local models call tools poorly | the connection test flags tool support; UI warning (not implemented: `supportsTools` is recorded but unused) | WP-09 |
| R-05 | Datasheet PDFs extract badly (multi-column pages, tables) | page-level citations; `read_doc` page ranges; evaluation on demo PDFs; tables and OCR after 1.0 | WP-23, WP-24 |
| R-06 | Prompt injection through documents | the defences of 03 §10 | every tool package |
| R-07 | The package exceeds its size budget | retired 2026-11-01: no size budget (ADR-0017); the package report still lists the largest contributors | WP-30 |
| R-08 | Agent-written code drifts from the architecture | laws of 01 §1, the import boundaries in `npm run lint`, review of every work package | all |
| R-09 | A first turn or model switch exceeds context before historical compaction | budget every request from M1, including current-turn tool results; reserve output; explicit limit outcome | WP-09, WP-10, WP-13, WP-34 |
| R-10 | Concurrent or interrupted edits apply stale or repeated approvals | approval bound to the change's digest and used once; one write queue per workbench; hash check before writing; `pending` changes resolved on restart | WP-16, WP-17 |
| R-11 | A pathological grep blocks the main process or ignores Stop | regex work in a terminable worker; host deadline and abort; responsiveness test | WP-11, WP-14, WP-15 |
| R-12 | Instrumented-build results hide a release packaging or egress defect | separate artifacts; smoke on the release artifact by SHA-256; `strace` egress check on Ubuntu, Sandbox check on Windows | WP-30, WP-33 |

## 6. After 1.0

Seams marked "planned" below were never built; the others exist in the code.

| Direction | Seam already in 1.0 |
|---|---|
| Analysis capabilities: `parse_log`, `decode_register`, firmware comparison and test planning skills — planned in [../capabilities/README.md](../capabilities/README.md) (CAP-01…04, epic #75) | the tool registry, the grep worker host, the skill catalog |
| Wrapper tools and serial: superseded by plugins, planned in [../plugins/plan.md](../plugins/plan.md) (PLG-01…18) | skills, approvals bound to `requestSha256`, permission modes; the spawn pattern of `09_Others/benchpilot-reference/apps/server/src/tshark.ts` (argument array, no shell, timeout, output cap) |
| Camera snapshots and live view | `getUserMedia`; the permission handler of 01 §7 |
| Voice: local speech-to-text, optional text-to-speech | `SpeechToText` port (planned; not in `core/src/ports.ts`); the ONNX runtime shipped for embeddings (06 §9) |
| Test catalog with deterministic evaluators | test definitions with machine-checked criteria; VERA's artifacts and references as evidence |
| Anthropic and Azure OpenAI providers | ADR-0002 |
| `apply_patch` for Codex-trained models; image input | the tool registry |
| macOS | ADR-0001 |
