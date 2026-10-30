# TASK-6bbaec5c - Download public PDFs and open them in VERA

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-b975a8b5, REQ-SEC-6c43bda5, REQ-REL-45112294, REQ-SEC-1a37ade3, REQ-DATA-fd1933a1, REQ-UX-b93197aa, REQ-FUNC-4c3f4f0c, REQ-REL-39e8cc78
parent:
branch: master
base: ee74ec69357c0d02c4f3664059133b2cdc33a9d2
opened: 2026-10-30

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: STATED â€” the agent needs to download datasheets/documents found on the web and open PDFs in VERA; research-only web_read currently cannot save binary files (OBSERVED core/tools/web.ts).
Desired outcome: STATED â€” implement the previously discussed web_download tool and internal PDF opening using AEGIS.
Actors: user, workbench agent, permission gate, public document server, local PDF viewer.
Primary scenario: approved agent request downloads a public datasheet into .vera/downloads; the user opens it from the successful tool card or downloaded documents list.
Examples: a public manufacturer's PDF, with an optional portable filename; one ordinary PDF and one redirecting PDF are test cases (INFERRED).
Counterexamples: private-network URL, HTML login page masquerading as PDF, denial, disabled Web access, corrupt or oversized PDF.
In scope: INFERRED from accepted proposal â€” separate provider-neutral direct PDF downloader; immutable workbench-owned files and provenance; current permission modes/global web gate; internal viewer and localized Open PDF action; focused automated and native visual tests.
Out of scope: STATED accepted proposal â€” automatic RAG ingestion/embeddings; generic browser automation, cookies/login bypass and other download formats. Existing user folders remain user-owned.
Constraints: STATED â€” AEGIS; shared master checkout; authorized one local commit after validation (root AGENTS.md), no remote publication, preserve historical journals and unrelated changes. OBSERVED â€” PDF viewer accepts at most 100 MiB binary PDFs through its existing bounded extraction/IPC pipeline; .vera is excluded from ingestion. OBSERVED unrelated baseline: scripts/README.md, keyboard-shortcuts.tsx, permission-picker.tsx, context-tab.tsx, session-inspector.tsx, styles.css, llm/gateway.test.ts, llm/providers.ts, llm/subscription.test.ts, tests/e2e/bypass.spec.ts, untracked optional-companions.md. Keep these uncommitted baseline hunks intact.
Success signals: download bytes/hash match the public PDF, approved writes only, private destinations and stale workbench IDs cannot escape, failed/cancelled attempts leave no published download, multi-page PDF opens locally with existing page navigation, no PDF bytes enter model results, global web revocation cancels pending network work.
Evidence: OBSERVED â€” core tools/changes.ts + agent/approvals.ts implement prepared write approval; ConfiguredWebProvider owns revoke/close; knowledge/worker-host.ts supplies cancellable PDF parsing; docs viewer supports local PDF pages. Base ee74ec69357c0d02c4f3664059133b2cdc33a9d2.
Assumptions: INFERRED â€” a user action opens a downloaded PDF; agent completion does not steal focus with an automatic popup. Downloads remain workbench documents when their originating session is deleted.
Unknowns: public servers may require authentication or reject automated downloads; fail with the current tool error contract, without adding browser credentials or bypasses.
Decision-blocking questions: none; the user accepted the download/internal-viewer scope. Routine bounded-transfer constants are documented implementation choices, not additional product settings.
Proposed behaviors: authenticated provider API keys are never sent to document hosts; read-only hides the write tool, Ask and protected Auto-edit requests require approval, Bypass approves through the existing gate; global Web access controls transfer independently of Exa/Tavily/Brave credentials. Stored downloads remain outside RAG.
Path and reason: full, new write tool, download metadata/IPC interfaces and network/storage boundary.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | web_download and Open PDF |
| no new interface or data format | no | download manifest and typed IPC |
| no new dependency | yes | Node HTTP/DNS and existing PDF worker |
| existing requirement covers behavior | no | download-specific requirements needed |
| no security or data-handling change | no | approved public-network binary writes |

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Download an approved public PDF into managed storage | REQ-FUNC-b975a8b5 | Immutable metadata + binary store | 05_Software/src/libraries/core/src/web/pdf-downloads.test.ts |
| Validate and pin public PDF download destinations | REQ-SEC-6c43bda5 | Public DNS pinned Node HTTP transport | 05_Software/src/libraries/core/src/web/pdf-transfer.test.ts |
| Bound and cancel PDF transfers without partial publication | REQ-REL-45112294 | Shared deadline, byte cap, bounded redirects and atomic publication | 05_Software/src/libraries/core/src/web/pdf-downloads.test.ts |
| Enforce download permissions and live Web access | REQ-SEC-1a37ade3 | Prepared write approval + global gate | 05_Software/src/libraries/core/src/sessions/downloads.test.ts |
| Keep immutable PDF downloads inside the current workbench | REQ-DATA-fd1933a1 | Ordinary managed directories and hash verification, outside RAG | 05_Software/src/libraries/core/src/web/pdf-downloads.test.ts |
| Expose localized downloaded PDF actions and history | REQ-UX-b93197aa | Localized download card and Docs section | 05_Software/tests/e2e/pdf-download.spec.ts |
| Open scoped verified downloads in the existing PDF viewer | REQ-FUNC-4c3f4f0c | Typed scoped IPC reusing PdfExtractor and PDFViewer | 05_Software/tests/e2e/pdf-download.spec.ts |
| Reject invalid PDF payloads before publication | REQ-REL-39e8cc78 | Cancellable PDF worker validation before save | 05_Software/src/libraries/core/src/web/pdf-downloads.test.ts |

## Design

### Approach
REQ-FUNC-b975a8b5 / REQ-DATA-fd1933a1: add provider-neutral PdfDownloads and pdf-transfer modules, approved web_download, immutable .vera/downloads storage and existing local PDFViewer. The .vera ingestion exclusion remains unchanged.

### Interfaces and data
REQ-SEC-1a37ade3: prepare binds source URL, portable filename and UUID destination without network I/O. The current approval gate decides; write queue covers publication only, avoiding network waits on other workbench writes. Live Web access and tool/permission settings remain authoritative.
REQ-SEC-6c43bda5 / REQ-REL-45112294: Node HTTP(S) resolves all DNS addresses and pins a public address; TLS still verifies the original hostname. Revalidate every redirect, never forward credentials; reject encoded/oversized responses. Reuse PDF_LIMIT=100 MiB and the 120-second PDF worker deadline for the whole operation; cap redirects at five.
REQ-REL-39e8cc78: validate PDF/binary MIME and PDF signature and parse through existing cancellable PdfExtractor before publishing, with a download-only 256 MiB worker heap cap. Failures use current tool errors and leave no final record.
REQ-DATA-fd1933a1: stage exclusive files plus strict provenance, fsync, recheck ordinary managed parents/current ownership and atomically rename a fresh UUID directory. No overwrite; clean only owned unpublished scratch. Completed documents survive session deletion.
REQ-FUNC-4c3f4f0c: typed downloads.list/open IPC requires active workbench ID and UUID. Verify metadata, path and exact SHA-256 before producing existing PDF ViewerContent. Reuse worker and viewer page navigation, cancellation/scope handling and local PDF rendering.
REQ-UX-b93197aa: metadata-only tool output; localized Open PDF action in the successful transcript tool result plus Docs downloaded history (filename/source/date), without automatic popups.

### Files and test seams
Shared downloads schema/tool catalog/IPC/approval events; core transfer/store/global gate/tool/SessionService; desktop and CLI composition, viewer selection, Docs/download-card UI and en/ro/de. Unit tests inject DNS and transport, session tests exercise real approval/runtime, native tests use a controlled public-URL fixture and real PDF worker/viewer.

### Risks and open decisions
Negative proofs: private/mixed DNS, redirect-to-private, timeout/size, cancellation, links, manifest/file mutation and stale workbench IDs. No dependency, migration, RAG or external-launch addition. Preserve unrelated baseline hunks and stop normal app before native build; restart afterward. No unresolved product decisions.

### Requirement map
Each decision above names its requirement; coverage table identifies source/test seams.

Diagrams: [diagram_TASK-6bbaec5c.md](diagram_TASK-6bbaec5c.md)

## Log

- 2026-10-30 frame: journal opened
- 2026-10-30 frame: Local commit authorized by root AGENTS.md; preserve unrelated working changes, no push. Autopilot scope recorded from the accepted PDF download/viewer proposal.
- 2026-10-30 frame: completed; next specify - Accepted user scope recorded; full path, no blocking question. (7 Done checklist item(s) left unticked)
- 2026-10-30 specify: Engineering bounds: reuse existing PDF_LIMIT=100 MiB and PDF worker deadline=120 seconds; cap manual redirects at five as a bounded transport safeguard. Existing tool/IPC error contracts apply.
- 2026-10-30 specify: completed; next design - Atomic download, permission, storage, viewer and failure requirements recorded and parsed. (7 Done checklist item(s) left unticked)
- 2026-10-30 design: completed; next build - Scoped design and requested diagrams recorded; reuse PDF worker/viewer, prepared permissions and existing PDF budget. (6 Done checklist item(s) left unticked)
- 2026-10-30 build: Corrected UTF-8 TOML spec references and completed design/three diagrams before any production edit; prior advance followed a failed shell subcommand, no implementation was made.
- 2026-10-30 build: red: focused tools/web-download.test.ts exit 1; prepared PDF write tool is absent (REQ-FUNC-b975a8b5, REQ-SEC-1a37ade3).
- 2026-10-30 build: green: focused tools/web-download.test.ts exit 0; prepared write registration and disabled catalog confirmed. DEVIATION build: detailed transfer/store adversarial tests follow the integrated registration red/implementation increment, rather than an individual red run for each storage branch; focused negative proofs are required before acceptance.
- 2026-10-30 build: red: PDF transfer tests found public IPv4 falsely rejected by the shared URL guard: Node BlockList maps IPv4 into the blocked mapped-IPv6 prefix. Split family lists to retain private-address denial while allowing intended public IPv4. Scope includes core/web/provider.ts; existing web-search knowledge boundary already read. Store tests including real multi-page worker parsing passed.
- 2026-10-30 build: red: shared downloads.test.ts exit 1 (missing mandatory download approval details); session downloads.test.ts first exposed missing Bypass cancellation (one timeout). Fixed prepared/execution signal combination and added live access assertion at publication.
- 2026-10-30 build: green: focused shared/transfer/store/IPC/preload/CLI approval checks: 73 tests passed; session permission suite: 8 passed. Native Electron pdf-download.spec.ts passed (11.4s): Ask before network, public redirect, exact bytes/SHA, multi-page viewer, en/ro/de, no RAG, invalid PDF, global revoke, offline restart and stale workbench rejection. Normal app was closed before the native build.
- 2026-10-30 build: Visual native proof found an uncited download labeled Cited pages and the reused dialog aligned top-left. Scoped download centering, omitted citation-only label for unreferenced PDFs, and compacted completed download approval/details while retaining expandable technical results. Added native geometry/no-false-citation assertions.
- 2026-10-30 build: red: three focused transfer/store boundary tests failed as expected (binary-download MIME, authority loss at rename completion, raw ENOENT); implemented PDF octet-stream acceptance with signature/parser verification, guarded post-rename publication rollback, structured missing/invalid errors. Added optional PDF worker heap limits for downloads only (256 MiB), retaining existing ingest parser defaults.
- 2026-10-30 build: green: current focused transfer/store/shared/registry/approval/redaction regressions passed (74 tests); parser heap cap is exercised by real PDF parsing. Live default pinned HTTPS transport downloaded W3C's public dummy.pdf: 13264 bytes, SHA-256 3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4; no credentials, API calls or repository output.
- 2026-10-30 build: Current TypeScript build passed (tsc -b); owned-file Biome passed with two unchanged pre-existing non-null warnings. Updated component knowledge/context for actual download interfaces, permission/lifetime, worker cap, network pinning and native proof.
- 2026-10-30 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-30 validate: Native rerun on current code passed (16.5s), including centered modal geometry and omitted false citation label; exact bytes, page navigation, translations, failure/revocation and offline restart passed again after the resource/error/publication changes.
- 2026-10-30 validate: Visual inspection confirmed centered PDF modal, readable page/tool card, compact completed approval and translated actions. Invalid-PDF verification uses real valid/corrupt worker input, empty/HTML/signature cases, plus injected password-required parser rejection; no new encrypted binary fixture or PDF-generation dependency was added.
- 2026-10-30 validate: DEVIATION validate: project 02_Tools/verification-policy.md overrides generic full-suite --run; reused focused/native proof and ran lint, typecheck, i18n/import checks plus strict AEGIS without --run. Full suites remain milestone-owned.
- 2026-10-30 validate: final: current strict AEGIS exit 0 (0 errors, 33 non-blocking warnings in pre-existing metadata and unrelated baseline; none in owned source); npm run lint exit 0 (108 existing warnings,11 infos), full tsc -b exit 0 and focused core recheck exit0, check:i18n exit0, owned Biome exit0. Two added empty/password tests passed. Independent specification and quality reviewers approved round1. Anchor SHA-256 comparison confirms all11 pre-existing dirty paths unchanged; no historical journal changed. Normal development VERA PID8996 responds.
- 2026-10-30 validate: Import-boundary focused suite passed12 tests. All validation checklist outcomes verified; project-policy full-suite exception recorded. Final report read; closing after both approved reviews.
- 2026-10-30 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-6bbaec5c.md
changed: web_download; managed PDF storage/IPC; Open PDF viewer and history; focused tests and AEGIS records
evidence: Focused/native/live HTTPS tests and lint/types/i18n/imports/strict passed
issues: No blocking issues; existing warnings documented
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-10-30)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-b975a8b5 - Download an approved public PDF into managed storage
  - REQ-SEC-6c43bda5 - Validate and pin public PDF download destinations
  - REQ-REL-45112294 - Bound and cancel PDF transfers without partial publication
  - REQ-SEC-1a37ade3 - Enforce download permissions and live Web access
  - REQ-DATA-fd1933a1 - Keep immutable PDF downloads inside the current workbench
  - REQ-UX-b93197aa - Expose localized downloaded PDF actions and history
  - REQ-FUNC-4c3f4f0c - Open scoped verified downloads in the existing PDF viewer
  - REQ-REL-39e8cc78 - Reject invalid PDF payloads before publication
- deviations: 2 recorded
  - build: detailed transfer/store adversarial tests follow the integrated registration red/implementation increment, rather than an individual red run for each storage branch; focused negative proofs are required before acceptance.
  - validate: project 02_Tools/verification-policy.md overrides generic full-suite --run; reused focused/native proof and ran lint, typecheck, i18n/import checks plus strict AEGIS without --run. Full suites remain milestone-owned.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base ee74ec6: 77 file(s) changed, 2728 line(s) added
- checks: errors=0 warnings=33 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
