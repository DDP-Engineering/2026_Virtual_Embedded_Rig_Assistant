<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-967bf4de - WP-28 Document viewer and Docs panel

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-28ad0001, REQ-UX-28ad0002, REQ-UX-28ad0003
parent:
branch: master
base: d67f5611ef6e8010bae5ba034e81bd40f3980587
opened: 2026-10-13

## Done checklist (current stage)

- [x] validated candidate unchanged; both R4 independent verdicts approved
- [x] validation evidence, complete diff/exclusions and coordinator handback recorded
- [x] standing user authorization for coordinator local commit recorded in RULING-001
- [x] report prepared; exact manifest and original proof provided
- [x] coordinator includes journal/report in authorized local ticket commit
- [x] coordinator records close-out with that commit

## Frame

Problem: STATED valid chips disclose a pending viewer; Docs has a placeholder.
Desired outcome: current documents open at citations; Docs exposes index/search/reindex/progress.
Actors: desktop user, session, index/ingester, sandboxed renderer and authorized main.
Primary scenario: valid citation -> verify issuance/current source -> modal at locator/snippet.
Examples: PDF page/range, Markdown/HTML heading, log line range, session artifact.
Counterexamples: stale/missing/ignored/binary/escaping/foreign/unissued refs disclose no bytes.
In scope: offline pdf.js page/zoom/search/snippet; anchored Markdown/HTML; numbered/highlighted lines; artifact seam; Docs; en/ro/de, keyboard/focus, minimum geometry and mock.
Out of scope: skills/release/full index/eval/unrelated refactor/publication.
Constraints: STATED sole implementation/master/base/autopilot; coordinator commit authorized, implementer no staging/commit/push/PR. Pinned Electron44.7.0/pdfjs6.4.299/BGE; exact vera://app, renderer no Node/fs, current ownership/read-only/session isolation. Policy3 targeted Windows/nativeUbuntu, statics/strict/two reviews, full M3 gate WP29/coordinator.
Success signals: native PDF page/snippet and line/heading Done E2E; browser language/theme/scale1024x640; source/provenance refusal tests.
Evidence: OBSERVED shared refs.ts/core agent/citations.ts, DocumentKnowledge/verifyDocumentSource, WorkbenchService/database/locks, Markdown/transcript/Shell/artifacts, index events; plan M3 WP28, architecture06 sections2/3/5-8 and05 sections7/9. Three requested Benchpilot files read as references.
Assumptions: INFERRED modal follows existing dialog/focus conventions; Docs keyword mode avoids model load.
Unknowns: worker/font resource requirements resolved by pinned source and native build proof.
Decision-blocking questions: none.
Proposed behaviors: guarded typed content/bytes, locator navigation and live Docs index.
Path and reason: full; new behavior/interface, no dependency, prior requirements insufficient, data boundary extended. One task, only mandated independent reviewer agents.

## Requirement coverage

| Outcome | Atomic behavior | Requirement | Positive | Failure | Verification | Design |
|---|---|---|---|---|---|---|
| safe open | current confined typed content | REQ-FUNC-28ad0001 | Docs/issued citation | stale/foreign/ignored/binary/escaping/unissued | shared/core/session/host | strict scoped IPC and current source |
| navigation | viewer at locator | REQ-UX-28ad0002 | PDF/snippet/heading/lines/artifact | inert warning/load error/retry | renderer/native/browser | modal, host anchors, bundled worker |
| index | Docs status/search/open/reindex/progress | REQ-UX-28ad0003 | event refresh | read-only/empty/errors/scope change | host/renderer/E2E | scoped keys/subscription before list |

## Design

Strict docs.list/search/open requests/responses carry workbenchId. Open selects Docs path/ref or citation sessionId/messageId/ref; host resolves successful tool provenance and snippet, never client snippets. SessionService requires a completed valid assistant citation and revalidates current source/issuance; artifact refs resolve inside that session's existing store.
DocumentViewer verifies source bytes with verifyDocumentSource, index/extraction consistency and family/bounds. File-tool line refs use readWindow metadata and verified full source within20MB; the renderer displays250 numbered lines at a time with navigation and full cited-range identity. Verified indexed Markdown uses extraction slugs; HTML renders visible extraction text only. WorkbenchService serializes reads with lifecycle and checks exact ID/ownership; protected read-only snapshots remain readable.
Renderer modal binds selections/async results to scope while preserving Shell/Welcome mounts, handles load/error/retry/close/focus. PDF renders a navigable canvas with searchable text/snippet marks; pinned worker/resources build same-origin and confined protocol/CSP allow only local assets. Ranges preserve start/end. Docs uses bounded keyword results and scoped index events. Existing artifact content rendering is reused.
Focused selection: shared wire schemas; core viewer current source/locators; session provenance/artifact isolation; renderer async/error/focus; immediate IPC/preload/mock/markdown/workspace/artifact/import consumers; native Windows/Ubuntu Done+Docs+offline worker; browser en/ro/de/light-dark/all scales1024x640. Static strict runs configured lint/typecheck/i18n only, no full suite/eval. Both reviews inspect selection.

## Log

- 2026-10-13 frame: delegated scope accepted full/autopilot/master/base; Windows setup --check ready. Protected optional-companions.md excluded. BMAD optional, no setup.
- 2026-10-13 specify: three atomic contracts created; positive/boundary/recovery inventory captured in coverage/Design, no retirements.
- 2026-10-13 design: current source/issuance/ownership/artifact seams inspected; design audited, advance build.

- 2026-10-13 build: test-first missing viewer module/new IPC failed (2files, exit1); guarded core/shared implementation green. Full current citation provenance uses preceding successful tool IDs and exact ref payloads; unknown/invalid refs stay inert.
- 2026-10-13 build: Windows Done native e2e-build7 exit0,1pass; offline worker/PDF page/snippet/range/search/zoom, Markdown/HTML focus and actual repeated-heading/line60–62 scrolling, artifact, Docs/reindex/progress/search, exact persisted restart and no egress. Original output/argv/cwd/UTC/hash/native runtime in02_Tools/cache/wp28-TASK-967bf4de/windows. Modal chip identity/focus corrected; test setup uses repeated paragraphs and current post-restart Page. Bounded250line presentation avoids unbounded DOM while preserving absolute locators.
- 2026-10-13 build: focused-build2 first12files passed/3failed; two5s host timeouts and renderer async settle under concurrent workers. Unchanged failed3files rerun --maxWorkers=1 exit0,38pass1POSIXskip; no timeout/assertion weakening. Other85passing checks reused; changed bounded text renderer plus immediate Markdown/workspace/artifact consumers rerun serial exit0,23pass. Windows browser matrix build3 passed, but final rerun required after focus/CSP/line UI changes. Final core current-row recheck awaits affected proof; native Ubuntu serial selection running. Three linked requirements active; current component knowledge, architecture and environment reconciled; no full suite/eval.

- 2026-10-13 validate round1: both independent verdicts changes_required on49path candidateSHA bf9bd488cafa498ebfbbd3e964adc71d78d9d533bc38f003ee1a7c87dfe242e7. Consolidated three findings: raw Docs success fields bypass secret projection; Docs search stale extraction needs deduplicated current source/bounds checks; provider key remount loses Welcome name/folder draft. Exact verdicts in review-round1-verdicts.json. Return build for these findings only; both approvals cleared. Focused policy3 selection approved; final native/static proof follows round2.

- 2026-10-13 build review fixes: source-current Docs hits now use shared verified indexedSource/currentBounds, deduplicated per path with index epoch check; successful list/search/user heading fields use bounded credential projections; provider selections carry scope without keyed Shell remount. Regressions cover redaction/schema bounds, edited/replaced/binary/ignored/pending sources, Welcome name/folder draft roundtrip and late-response isolation with the same provider mount. Windows affected8files73pass before final heading/epoch additions; final affected proof follows. No scope expansion or accepted findings.

- 2026-10-13 validate round2: specification approved, quality changes_required on candidateSHA7ba0b9707e913ae0deb0564810a9f2d73ab19640958e7068d617516b0e708da3. Three R1 findings resolved; one consolidated schema-safe redaction edge remained: sensitive heading refs invalidated whole search response and expanded viewer snippets exceeded12000. Corrected only projection: omit unusable locator identities, retain usable results, bound after actual redactor expansion and preserve Unicode boundaries. Whole search response/viewer schemas tested with actual core redactor. Windows affected20pass, native affected original73pass reused; latest2file native proof pending. Both verdicts reset for round3.

- 2026-10-13 validate round3: both independent reviewers approved the same50semantic-path candidateSHA9f276731eaab9196a1a5b03f8d568ef24965048e8aaa3c026d1d08ef08e3211d; membership/base/master/empty index/protected exclusion independently verified. Windows and native Ubuntu final projection20pass with matching raw software hashes; native affected73pass includes final source/epoch checks. Latest evolution records10post-anchor corrections; complete base candidate remains manifest authority. Final native/browser and configured strict proof now run after approvals.

- 2026-10-13 validate final statics: lint found formatter errors in the three owned locale JSON files (CRLF versus configured LF). Return build for formatting only; independent approvals cleared for exact-candidate round4. Translated JSON values and runtime behavior remain identical. Current warnings are nonblocking style advisories; final statics will rerun after both reviews.

- 2026-10-13 validate round4: both reviewers approved candidateSHA2fc6f3427e882ec8d7a74788dacc34e73248810ecfc9d3dd8af1fa89f1a52202 after independently verifying exactly3locale LF-only edits and identical decoded catalogs; unchanged runtime proof reused. Windows final native Done1pass and zero renderer errors reused across formatting; browser interrupted by Vite full reload during formatting, so only browser reruns. Strict statics rerun after approvals.

- 2026-10-13 DEVIATION validate: automatic approval review rejected verified owned Windows scratch/archive removal with reason blocked by policy. No bypass; ignored owned scratch retained with original evidence. Required runtime/static proof remains intact; cleanup limitation accompanies handback.

- 2026-10-13 validate completed: original proof reuse over15source-matched test files yields Windows128pass1POSIXskip and nativeUbuntu129pass; affected fixes rerun, unchanged proof reused perpolicy3. Windows native final Done1pass (e2e-final has1nativepass and operational browser interruption; browser-final exit0,1pass). Native Ubuntu e2e-final exit0,2pass. Exact PDF/snippet/ranges/find/zoom, heading and line60-62 anchor/scroll/highlight, artifact, live Docs/reindex/search and persisted restart proven; no non-loopback egress and zero renderer errors on both native launches/platform. Browser en/ro/de, light/dark and five scales at1024x640 exercises PDF/Markdown/text, keyboard/focus/overflow; screenshots visually inspected (native exact highlighted lines both platforms, Romanian minimum-size Docs). Original receipts/logs/native outputs/screenshots copied byte-for-byte under02_Tools/cache/wp28-TASK-967bf4de/{windows,linux}; hashes verified. Native mirror software bytes match all378current files, aggregateSHA08697637b7af1ba8e741cabea919ed4300a369902af7e6c84aa9cefbd51313fa. Windows compiled main remains exact accepted nativeSHAe497a1199da5bc850b91c366a2c23088d34f134e708d9df8672faf496ad60ed7 across LF-only catalogs.
- 2026-10-13 validate strict: check --task TASK-967bf4de --strict --run exit0 on Windows and nativeUbuntu; configured lint/typecheck/i18n pass (test deliberately absent perpolicy3). Catalog0errors/11inherited warnings/3baseline manual notes; nonblocking Biome style advisories and pinned dependency Rollup annotation warnings remain, no runtime/security finding. Imports covered by focused boundaries9pass and static restricted-import lint. Final evolution13post-anchor changes reviewed; full base manifest covers51owned candidate files (35modified/16new),50semantic files (39software/10AEGIS/1architecture), excludes human optional-companions.md with originalSHA. No payload/setup/dependency edits or BMAD installation. Full M3 gate intentionally remains WP29/coordinator; no unrelated suite/eval run.
- 2026-10-13 deliver: validated candidate handed back on unchanged master/base with both R4approved, empty staging and standing user local-commit authorization. Implementer makes no commit/push/PR/issue closure. Coordinator next verifies complete current candidate and original proof, then performs one authorized local WP28commit without routine retesting. Owned ignored scratch retained after automatic cleanup rejection; no bypass or user/manual cache touched.

- 2026-10-13 deliver coordinator acceptance: complete51file candidate reviewed against base; all50semantic hashes/current378software bytes match original proof. Both independent R4 final messages verified, original receipt/log/test hashes and native executable/main binding checked; Windows128pass1POSIXskip/Ubuntu129pass, native1/browser1 each and strict0 reused. Exact Done anchors/snippet and minimum Romanian Docs screenshot inspected. No product finding;11inherited advisories/3baseline notes and owned cleanup rejection retained. Standing user local commit authorized for exact51paths; protected human draft unchanged. Acceptance:02_Tools/cache/wp28-TASK-967bf4de/coordinator-acceptance.json; no handover retesting or remote publication.

- 2026-10-13 deliver local-only close-out: authorized outcome is the single delivery commit itself; step6 section7 therefore closes before that commit, carrying completed journal/report in the same51path commit. Candidate is unchanged; no push/PR/release/issue mutation. Actual commit SHA/parent/membership will be recorded atomically outside this journal after Git succeeds.

## Rulings

- RULING-001 | date=2026-10-13 | decision=Shared master/autopilot; coordinator local commit authorized by user, implementer hands back without staging/commit/push/PR/issue mutation | reason=delegation/root AGENTS | source=user | supersedes=none
- RULING-002 | date=2026-10-13 | decision=Focused Windows/nativeUbuntu proof and Done E2E, statics/strict/two independent reviews; full M3 gate WP29/coordinator | reason=verification-policy version3 | source=user | supersedes=none

## Handoff

current: done
status: ready
next: coordinator starts eligible WP29; owns M3 integrated gate after29commit
must_read: .agentic/tasks/TASK-967bf4de.md, 02_Tools/cache/wp28-TASK-967bf4de/coordinator-acceptance.json
blockers: none for product; ignored owned scratch retained after automatic cleanup rejection

## Stage report

stage: deliver
result: completed
current: done
changed:51owned files;50semantic approved; protected human draft excluded
evidence: original Windows128pass1skip/Ubuntu129pass; native1/browser1 each; strict both0; R4spec/quality approved; coordinator acceptance source/receipt/native hashes verified
issues:11inherited advisories; owned cleanup automatic rejection; M3gate followsWP29
next: authorized local single commit, thenWP29
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-28ad0001 - Open current confined documents for the active workbench
  - REQ-UX-28ad0002 - Navigate citations in an accessible offline document viewer
  - REQ-UX-28ad0003 - Expose the live document index in Docs
- deviations: 1 recorded
  - validate: automatic approval review rejected verified owned Windows scratch/archive removal with reason blocked by policy. No bypass; ignored owned scratch retained with original evidence. Required runtime/static proof remains intact; cleanup limitation accompanies handback.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base d67f561: 52 file(s) changed, 3018 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 4/6 done; open: coordinator includes journal/report in authorized local ticket commit; coordinator records close-out with that commit

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-28ad0001 - Open current confined documents for the active workbench
  - REQ-UX-28ad0002 - Navigate citations in an accessible offline document viewer
  - REQ-UX-28ad0003 - Expose the live document index in Docs
- deviations: 1 recorded
  - validate: automatic approval review rejected verified owned Windows scratch/archive removal with reason blocked by policy. No bypass; ignored owned scratch retained with original evidence. Required runtime/static proof remains intact; cleanup limitation accompanies handback.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base d67f561: 52 file(s) changed, 3034 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 5/6 done; open: coordinator records close-out with that commit

## Delivery report (2026-10-13)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-28ad0001 - Open current confined documents for the active workbench
  - REQ-UX-28ad0002 - Navigate citations in an accessible offline document viewer
  - REQ-UX-28ad0003 - Expose the live document index in Docs
- deviations: 1 recorded
  - validate: automatic approval review rejected verified owned Windows scratch/archive removal with reason blocked by policy. No bypass; ignored owned scratch retained with original evidence. Required runtime/static proof remains intact; cleanup limitation accompanies handback.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base d67f561: 52 file(s) changed, 3050 line(s) added
- checks: errors=0 warnings=11 notes=3
- checklist: 6/6 done
