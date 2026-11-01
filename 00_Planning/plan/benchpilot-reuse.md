# BenchPilot reuse map

STATE: 2026-11-01 — the reuse phase is complete: every work package that started from a reference
file (WP-01…WP-38) is closed in Gitea. This map is a historical record. Reference paths were
corrected to the snapshot's real layout (`apps/server/src/`, `packages/shared/src/`, `apps/web/src/`,
`scripts/`, `skills/` directly under `09_Others/benchpilot-reference/`); where the code landed
elsewhere than planned, the VERA target column names the actual location under `05_Software/`.

PURPOSE: which reference files each VERA module starts from, and what changes. The reference code is
a snapshot of the BenchPilot proof of concept in `09_Others/benchpilot-reference/` (see its README); it uses VERA's stack — TypeScript, pi-ai 1.1.0, React 19, Vite, Tailwind CSS v4,
shadcn/ui, TanStack Query, better-sqlite3, zod — so its code moves with small adaptations. Copy a
file together with its tests, then adapt it.

Rules:
- **Logic stays, transport changes.** Hono routes and Server-Sent Events become IPC handlers and the
  `vera:event` channel (01 §3). Request and event shapes move into `src/libraries/shared/src/ipc.ts` and
  `events.ts`.
- **Domain words change.** Testbench → workbench, `docs/TESTBENCH.md` → `WORKBENCH.md`, `ev:` evidence
  references → VERA references (05 §7).
- **Network-testbench specifics stay behind**: the simulated runner, evaluators, pcap/syslog/iperf3
  ingest, reports, plans, triage evaluation and the tshark tools. They are prior art for the test
  catalog and wrapper tools after 1.0.

## Core — `09_Others/benchpilot-reference/apps/server/src/` → VERA `src/libraries/core/src/`

| Reference file | Lines | VERA target | Change |
|---|---|---|---|
| `llm/gateway.ts` | 60 | `llm/gateway.ts` | keep the `LlmGateway` interface; provider ids gain `custom:<slug>` |
| `llm/providers.ts` | 223 | `llm/providers.ts` | keep the **api** and **subscription** collections and the custom provider; allow several custom endpoints |
| `llm/oauth.ts` | 79 | `src/apps/desktop/src/main/chatgpt-auth.ts` (sign-in) + `llm/chatgpt-catalog.ts` | keep the in-process sign-in; open `auth_url` through an `openExternal` host callback of `ChatgptAuth` (`src/apps/desktop/src/main/open-external.ts`; no core `OpenExternal` port exists); add the manual-code paste flow; `agentName: "VERA"` |
| `llm/credentials.ts` | 190 | `CredentialStore` port + `src/apps/desktop/src/main/credentials.ts` | keep write-then-rename with the Windows retry and the pi-ai store view; encrypt every value with `safeStorage` |
| `llm/replay.ts` | 228 | `llm/replay.ts` | the scripted provider for tests (08 §3); keep placeholders and the stateless step derivation; drop the verdict guards |
| `agent/loop.ts` | 185 | `agent/runtime.ts` | starting loop (ADR-0003); M1 context policy before every call, per-call approvals, limits; M5 steering and historical compaction |
| `agent/approval.ts` | 45 | `agent/approvals.ts` | gate pattern only; VERA binds each approval to the digest of the exact change and the active turn, used once |
| `agent/hub.ts` | 76 | `sessions/hub.ts` | keep persist → fold with the shared reducer → fan out; fan-out goes to the IPC emitter |
| `agent/sessions.ts` | 296 | `sessions/service.ts` | keep one turn per session and stop; recover running and awaiting-approval sessions, resolve `pending` changes; drop plans and runs |
| `agent/prompt.ts` | 46 | `agent/prompt.ts` | sections and rules per 03 §3 |
| `agent/citations.ts` | 9 | `agent/citations.ts` | swap the resolver for VERA references |
| `evidence/resolve.ts`, `evidence/context.ts` | 54, 166 | `src/libraries/shared/src/refs.ts`, `agent/citations.ts`, `knowledge/viewer.ts` | resolve VERA references; the context rendering feeds the document viewer |
| `tools/registry.ts` | 222 | `tools/registry.ts` | keep zod → JSON Schema, caps and previews; VERA tool classes; caps per 03 §7 |
| `tools/knowledge.ts` | 138 | `tools/documents.ts` | FTS5 search and document reading become the keyword part of `search_docs`, and `read_doc` |
| `skills/load.ts`, `content.ts` | 25, 41 | `skills/catalog.ts`, `workbench/` | keep the frontmatter split and zod validation; add the user skill folder; limits per 02 §5 |
| `testbench/load.ts` | 61 | `workbench/` | from loading a testbench folder to create, open and validate a workbench |
| `db/index.ts`, `db/schema.sql`, `db/repos/` | 34, 87, — | `storage/` | keep the better-sqlite3 set-up and repository style; schema per 02 §9; add checksummed migrations (built, then removed in commit 33e72b8: `storage/schema.ts` creates one complete schema, `schema_version` 1) |
| `cli/chat.ts`, `cli/bench.ts` | 138, 117 | `src/apps/cli/` | `chat --script` becomes `vera run` |

## Shared — `09_Others/benchpilot-reference/packages/shared/src/` → VERA `src/libraries/shared/src/`

| Reference file | Lines | VERA target | Change |
|---|---|---|---|
| `events.ts` | 91 | `events.ts` | keep turn, message and tool events; add the events of 03 §8; drop plan and run events |
| `session.ts` (+ `session.test.ts`) | 315 | `session-state.ts` | keep `applySessionEvent`; the snapshot stays the fold of the stream |
| `evidence.ts` (+ test) | 123 | `refs.ts` | citation extraction and parsing for VERA's formats |
| `api.ts`, `domain.ts` | 452, 260 | `ipc.ts`, `workbench.ts`, `settings.ts` | request and response types become zod-defined channels |
| `markdown.ts` | 20 | `src/libraries/core/src/knowledge/extraction.ts` (`slugger`) | heading slugs only; no shared `markdown.ts` exists |

## Renderer — `09_Others/benchpilot-reference/apps/web/src/` → VERA `src/apps/desktop/src/renderer/`

| Reference file | Lines | VERA target | Change |
|---|---|---|---|
| `api/client.ts`, `api/index.ts` | 118, — | `api/` | keep the single data boundary; add `ipcApi` beside `mockApi`; `httpApi` goes |
| `api/useSessionEvents.ts` | 92 | `hooks/use-session-events.ts` | keep snapshot, then `sinceSeq`, and the skip-duplicates rule; subscribe through `window.vera.subscribe` |
| `mocks/` | ≈ 2 700 | `mocks/` | keep the in-memory engine; new fixtures |
| `components/session/Transcript.tsx`, `ToolCallRow.tsx`, `Composer.tsx`, `SessionList.tsx`, `ContextTab.tsx` | 126, 115, 96, 51, 97 | `components/session/` (`transcript.tsx`, `composer.tsx`, `session-list.tsx`, `context-tab.tsx`) | same roles; the composer gains the model and mode pickers and `@` completion |
| `components/session/ApprovalCard.tsx` | 184 | `components/session/approval-card.tsx` | from plan approval to diff approval |
| `components/evidence/` | — | `components/documents/` (viewer); chips in `components/session/markdown.tsx` | chips and drawer for VERA references; `EvidenceViewer.tsx` (224) seeds the document viewer (06 §5) |
| `components/common/Markdown.tsx` | 107 | `components/session/markdown.tsx` | as is |
| `components/testbench/DocumentsTab.tsx`, `SkillsTab.tsx`, `ToolsTab.tsx`, `OverviewTab.tsx` | 192, 119, 102, 139 | `components/workbench-*.tsx`, `components/skills.tsx`, `components/documents/docs-tab.tsx` | the workbench settings tabs of 06 §2 |
| `components/shell/`, `hooks/use-theme.ts`, `components/ui/` | — | `components/shell.tsx`, `hooks/use-preferences.ts`, `components/ui/` | layout shell, theme hook, shadcn components |
| `pages/SessionWorkspace.tsx`, `SettingsPage.tsx`, `NewTestbenchPage.tsx` | 279, 508, 342 | `components/session/workspace.tsx`, `components/settings.tsx` (+ `providers.tsx`, `chatgpt.tsx`), `components/workbench-create.tsx` (no `pages/` folder) | session screen; app settings, whose provider and ChatGPT sections already exist; the create-workbench flow |

## Scripts and tests

| Reference file | Lines | VERA target | Change |
|---|---|---|---|
| `scripts/smoke.mjs` | 123 | e2e helpers (`tests/e2e/network-guard.ts`) | fail on console errors and on requests that leave the app |
| `scripts/package-smoke.mjs` | 368 | `scripts/smoke-package.mjs` | reuse path/environment checks; add the artifact SHA-256, the scripted loopback session and the egress check (WP-33) |
| `scripts/package.mjs` | 358 | `scripts/package.mjs`, `scripts/package-checks.mjs` | electron-builder replaces it; keep its pre-packaging checks: no secrets, path length, native files complete |
| `scripts/sandbox/BenchPilot.wsb` | — | `scripts/sandbox/VERA.wsb` | Windows Sandbox for the clean-machine run |
| `apps/server/src/agent/replay-e2e.spec.ts`, `agent/guards.spec.ts`, `tools/caps.spec.ts` | — | `*.test.ts` beside the sources in `src/libraries/core/src/` (no `test/` folder) | the same kinds of tests for VERA's runtime, approvals and caps |
| `skills/*/SKILL.md` (7) | — | none: skill tests build their own skills (`src/libraries/core/src/skills/catalog.test.ts`); the demo-board fixture has no `skills/` | format examples; `failure-analyzer` is the exemplar shape |
