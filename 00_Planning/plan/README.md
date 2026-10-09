# VERA implementation plan

PURPOSE: the order in which VERA 1.0 is built — milestones, work packages, dependencies and risks —
and the decisions taken with the user that shape it. Specs: `../architecture/`; decisions: `../decisions/`.
STATE: 2026-10-09 — planned; nothing implemented yet.

## 1. Decisions taken with the user (2026-10-09)

- BenchPilot code (`D:\2026_Beldin`) may be reused. Every work package names the files it starts
  from; the full map is [benchpilot-reuse.md](benchpilot-reuse.md).
- ChatGPT-subscription sign-in is acceptable for the way VERA will be distributed.

## 2. Milestones

| Milestone | Plan | DONE-WHEN |
|---|---|---|
| **M0 Foundation** | [M0-foundation.md](M0-foundation.md) | the launch e2e passes on Windows and Ubuntu with the security baseline (01 §7); theme, text size and language switch and persist; the packaging spike WP-05 has filed its ADR |
| **M1 Read-only agent** | [M1-read-only-agent.md](M1-read-only-agent.md) | in the demo workbench — scripted in tests, and with a real OpenAI key or local endpoint by hand — the agent greps and reads files and answers with a valid citation; the session reloads after a restart; `vera run` prints the same events headless |
| **M2 Edits, artifacts, ChatGPT** | [M2-edits-artifacts-chatgpt.md](M2-edits-artifacts-chatgpt.md) | in `ask` mode an edit waits for approval with a diff; approve, deny and stop behave per 03 §6; protected paths ask even in `auto-edit`; artifacts, changes and the plan show in their panels; a ChatGPT subscription signs in and runs a session |
| **M3 Knowledge** | [M3-knowledge.md](M3-knowledge.md) | demo PDFs, Markdown and logs index in the background; hybrid `search_docs` meets the recall threshold; citations open the viewer at the cited page; skills load from workbench and user folders |
| **M4 Delivery** | [M4-delivery.md](M4-delivery.md) | the DONE-WHEN of 07: offline clean-machine install on both systems, update vN → vN+1 from a test feed, egress audit green |
| **M5 Version 1.0** | [M5-version-1.md](M5-version-1.md) | long sessions survive context limits; messages can be sent during a turn; sessions export; demo workbench and onboarding ship; translations reviewed |

## 3. Work packages

| WP | Title | Milestone | Depends on |
|---|---|---|---|
| WP-01 | Electron shell and source skeleton | M0 | — |
| WP-02 | Shared contracts and the typed IPC bridge | M0 | 01 |
| WP-03 | App data locations, settings and logging | M0 | 02 |
| WP-04 | UI foundation: layout, themes, text size, languages | M0 | 03 |
| WP-05 | Spike: native modules and the embedding model in packaged builds | M0 | 01 |
| WP-06 | Workbench format, create and open, Welcome screen | M1 | 04 |
| WP-07 | Workbench database and migrations | M1 | 05, 06 |
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
| WP-32 | Upgrade and migration safety | M4 | 30 |
| WP-33 | Offline packaged smoke and egress audit | M4 | 30 |
| WP-34 | Context management | M5 | 13 |
| WP-35 | Messages during a running turn | M5 | 13, 14 |
| WP-36 | Session export and search | M5 | 13 |
| WP-37 | Demo workbench, sample skills, onboarding | M5 | 29 |
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
| R-04 | Local models call tools poorly | the connection test flags tool support; UI warning | WP-09 |
| R-05 | Datasheet PDFs extract badly (multi-column pages, tables) | page-level citations; `read_doc` page ranges; evaluation on demo PDFs; tables and OCR after 1.0 | WP-23, WP-24 |
| R-06 | Prompt injection through documents | the defences of 03 §10 | every tool package |
| R-07 | The package exceeds its size budget | size check; smaller English model as fallback | WP-30 |
| R-08 | Agent-written code drifts from the architecture | laws of 01 §1, the boundary check, review of every work package | all |

## 6. After 1.0

| Direction | Seam already in 1.0 |
|---|---|
| Wrapper tools: declared external programs (STM32 and ESP32 flashers, `sigrok-cli`, scripts) with typed parameters, fixed argument templates, policy, timeout, success criteria and process-tree termination | `<workbench>/tools/`; the shape of NILO's `operation.schema.json`; ADR-0007; BenchPilot's `tshark.ts` spawn pattern |
| Serial terminal and logging | `serialport`; a `devices` module in core |
| Camera snapshots and live view | `getUserMedia`; the permission handler of 01 §7 |
| Voice: local speech-to-text, optional text-to-speech | `SpeechToText` port; the ONNX runtime shipped for embeddings (06 §9) |
| Test catalog with deterministic evaluators | BenchPilot's catalog, runner and evaluators; VERA's artifacts and references as evidence |
| Anthropic and Azure OpenAI providers | ADR-0002 |
| `apply_patch` for Codex-trained models; image input | the tool registry |
| macOS | ADR-0001 |
