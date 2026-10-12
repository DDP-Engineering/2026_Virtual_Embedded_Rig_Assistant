<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-4d39ed00 - WP-27 Citations for every reference kind

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-7cd31fe3, REQ-FUNC-51165496, REQ-UX-34535128
parent:
branch: master
base: ad81bc693e96d3071a28fd0c4cbf88f45ec0223f
opened: 2026-10-12

## Done checklist (current stage)

- [x] validated candidate unchanged and both R2 independent verdicts approved
- [x] full candidate/proof/exclusions prepared for handback
- [x] human local commit authorization recorded; coordinator alone stages/commits
- [x] coordinator accepts candidate and makes authorized local ticket commit
- [x] coordinator includes journal/report/close-out in that commit

## Frame

Problem: OBSERVED shared refs supports line/artifact only, PDF validation is separate and heading refs cannot be verified; transcript uses raw ref labels.
Desired outcome: STATED every05§7 format parsed, formatted, current-source validated and shown with kind-specific chips.
Actors: agent, successful read/search/artifact tools, SessionService, workbench owner, transcript user.
Primary scenario: successful tool issues ref -> assistant cites [[ref]] -> core verifies provenance/source/bounds -> persisted valid/warning chip.
Examples: PDF page1/range1-2, Markdown/HTML #h=power, text #L1-L2, artifact:summary.md in the current session.
Counterexamples: fabricated/failed-tool-only, deleted/ignored/binary/escaping/stale source, absent heading, excessive bounds, other-session artifact.
In scope: shared pure reference APIs; current document-bound validation through knowledge extraction; immediate citation/session consumers and per-kind renderer labels/icons; focused tests/native chip E2E; related knowledge/context reconciliation.
Out of scope: WP28 viewer/Docs panel, skills, index/eval reruns without concrete relevance, remote publication, staging/commit, protected human optional-companions and wp21 manual data.
Constraints: STATED shared master/base ad81bc693e96d3071a28fd0c4cbf88f45ec0223f, autopilot=true, coordinator owns authorized local commit. Pinned versions/import boundaries/i18n/protocol preserved; verification-policy version3.
Success signals: STATED parse-format roundtrips eachkind and invalid out-of-range; native E2E valid/invalid chips different. Current-source/issued/session boundary regressions on Windows/native Ubuntu; strict/statics and two independent reviews.
Evidence: OBSERVED plan/M3-knowledge.md, architecture05§7/03§9; full reference evidence.ts/resolve.ts/citations.ts/EvidenceChip.tsx; shared/refs, core/agent/citations, knowledge/search+extraction+processor, sessions/service, renderer/session/markdown; knowledge document-search/sessions/chat-ui.
Assumptions: INFERRED page and explicit page-range remain separate syntactic kinds, even range1-1; existing LineRef/artifact APIs remain wrappers. Heading slugs use extractor Unicode rules.
Unknowns: none decision-blocking; bare HTML preamble refs remain outside the specified locator forms and invalid as before.
Decision-blocking questions: none.
Proposed behaviors: canonical typed ref parser/formatter and compact labels; verify successful-issued document refs against guarded source SHA/extraction bounds; retain stable line/current-session artifact guards; display kind icon/label and warnings.
Path and reason: full. New behavior=yes; new interface=yes; dependency=no; existing requirement fully covers=no; data handling changes=yes. Quick path fails. One tightly coupled implementation, independent read-only review agents at validation.

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Positive case | Boundary or failure | Verification | Design decision |
|---|---|---|---|---|---|---|
| Every format | Pure parse/format | REQ-FUNC-7cd31fe3 | Five syntax kinds, Unicode | malformed/escape/unsafe integer | shared refs tests | typed union with legacy wrappers |
| Verified citations | Issued current bounds | REQ-FUNC-51165496 | pages/ranges/headings/lines/artifacts | source/provenance/session/bounds | core refs + knowledge + session replay | common parse, guarded extraction, existing stable text and artifact readers |
| Shown citations | Kind/validity presentation | REQ-UX-34535128 | compact fivekind chips | malformed/unverified inert warnings | renderer units/native E2E | shared labels, kind icon, full-ref tooltip/accessibility |

## Design

REQ-FUNC-7cd31fe3: shared refs.ts owns Reference union (page/page-range/heading/lines/artifact), parseRef/formatRef/referenceLabel. Explicit1-1 range remains a range; canonical decimal positive safe integers, Unicode extractor-compatible slug; portable relative paths including spaces/#. Existing LineRef/formatLineRef/parseLineRef/artifact APIs retain shapes. No dependency/schema change.
REQ-FUNC-51165496: citations.ts retains successful structured ref-field provenance, unique ordered extraction, stable readWindow line bounds and current-session ArtifactStore existence. Replace PDF-only dispatch with parsed page/range/heading -> DocumentKnowledge.validDocumentRef; retain validPdfRef as page-only compatibility wrapper. Validation uses indexed document metadata plus persisted extraction, PathGuard and verifyDocumentSource SHA256 independent of read output cap; family/pagecount/slugs checked. Recheck current metadata after async verification; failure resolves invalid. SessionService binds this resolver. No DB write/migration, viewer or index behavior change.
REQ-UX-34535128: renderer CitationChip uses shared parsing/compact labels and per-kind decorative icons; full ref tooltip/accessibility, data kind attribute, malformed refs warn even if upstream valid. Existing valid chip pending-viewer disclosure remains WP28 seam. No new product strings or viewer behavior.
Architecture structure unchanged; existing component diagrams remain applicable, citation parser/resolver/presentation seams are behavioral additions.
Flow: successful tool JSON ref -> assistant terminal text -> issued gate -> shared parser -> guarded current-source bounds/current session artifact -> message.done -> common snapshot/replay -> compact kind chip.
Failures: malformed/invented/failed-result/removed/stale/ignored/redirected/binary/outside/out-of-bounds refs are invalid without throwing the turn. Document source validation checks current index metadata after I/O; no accepted stale extraction. Existing source verification/readWindow own file handles/finally cleanup.
Test seams: shared refs roundtrip/malformed units; real FS/SQLite knowledge bounds and source fixtures; citations provenance matrix and existing artifact isolation; actual SessionService read_doc replay; renderer kind/validity/inertness units; new native citations.spec.ts with real indexed PDF/Markdown/HTML/text+artifact replay and persisted restart projection. Immediate sessions/registry/workspace/shared state/import boundary tests. Focused runs use pinned Windows/native Ubuntu with own task temp; static lint/typecheck/i18n and strict after independent reviews. Full M3 verification remains WP29/coordinator.
Tradeoff: reuse verified full extraction to validate headings and PDF pages, avoiding parsers that disagree with search/read or rejecting large valid sections due output budgets. Text-line refs remain valid outside the index through existing M1 stable reader. Bare HTML preamble refs keep previous invalid behavior outside05§7; no invented locator or ref compatibility change.
Expected files: shared refs.ts/refs.test.ts; core agent citations.ts/test, knowledge search.ts/test, sessions/service.ts; renderer/session markdown.tsx/new test; E2E citations.spec.ts and replay fixture; three requirements, journal and knowledge document-search/sessions/chat-ui + project/environment relevant sentences. No API/schema/dependency/pinned version changes.
Risks: mismatched locator family, duplicate Unicode heading anchors, oversized source sections, stale source/index while awaiting verification, unsafe renderer context; selected negative tests cover these. No open decisions.

## Log

- 2026-10-12 frame: delegated scope accepted in autopilot, full path, master/base exception confirmed; only this implementation task open. Protected human file excluded. All mandatory scope/reference sources read. BMAD optional bootstrap is outside scope.

- 2026-10-12 specify: created3 atomic requirements; inventory/coverage covers canonical forms, trust/bounds and presentation positive/failure cases; established line/artifact/transcript requirements retained. No spec needed beyond self-contained prose and constrained Design contract.

- 2026-10-12 design: constrained parser/resolver/chip ownership, compatibility, source/session trust boundaries and focused native test seams recorded in Design. No structural architecture changes; proceed build.

- 2026-10-12 build red REQ-FUNC-7cd31fe3: command=python ../02_Tools/npmw.py npx vitest run packages/shared/src/refs.test.ts; exit1; expected missing behavior=parseRef API absent, five-kind roundtrip/labels cannot resolve; original refs-red receipts retained.

- 2026-10-12 build focused REQ-FUNC-7cd31fe3: refs-green exit0,4tests; roundtrip five forms plus explicit singleton range/Unicode labels and malformed ranges/paths/slugs/artifacts. Legacy line API regression passed.

- 2026-10-12 build red REQ-FUNC-51165496: command=python ../02_Tools/npmw.py npx vitest run packages/core/src/knowledge/search.test.ts -t validates-all-issued (exact spaced argv in bounds-red.json); exit1; expected missing behavior=validDocumentRef absent, headings/general bounded resolution unsupported.

- 2026-10-12 build red REQ-UX-34535128: command=python ../02_Tools/npmw.py npx vitest run apps/desktop/src/renderer/components/session/markdown.test.ts; exit1; expected missing behavior=page-kind absent on chip (undefined instead of page). Original chips-red receipts retained.

- 2026-10-12 build focused REQ-FUNC-51165496: bounds-green exit0,6tests including current-source/extraction bounds, oversized-valid sections, successful-issued guards and existing PDF SessionService replay. Native Ubuntu setup completed on own mirror with pinned runtime; exact source sync before final native proof.

- 2026-10-12 build focused REQ-UX-34535128: chips-green exit0,1test; per-kind icon/label/full tooltip/accessibility and malformed-warning inertness confirmed. replay-green exit0,9tests; real SessionService all-kinds fixture persists6valid/7invalid citations and replays terminal event. Immediate consumers exit0,7files56pass/1POSIX-only skip; current Windows runtime ready.

- 2026-10-12 build completed: all3 requirements active/linked; Windows units-final12pass and immediate consumers56pass/1POSIX-only skip. Real native Electron44.7.0 citations6valid/7invalid kinds, inert warnings/style difference and restart identity pass (e2e-ready). Owned source redirected-directory regression passes on Windows junction. Evolution11 software paths reviewed; no viewer/Docs/skills/version changes. Proceed validate; native current-byte focused proof and final independent reviews/statics follow.

- 2026-10-13 validate R1: both independent verdicts changes_required on unchanged19-file SHA1b765615656820e34baa973a50c29b1a665f6805659a34000681516853039942; spec P2 opening-bracket path compatibility, quality Q1 strict-end terminator rejection. Both original reports bind all files and approve focused coverage; retain originals, clear verdicts while correcting only these findings. Native Ubuntu current-byte units69pass/11files; Windows pre-format consumer/E2E proof is exploratory, final affected current-byte proof follows correction/review.

- 2026-10-13 build R1 corrections red: REQ-FUNC-7cd31fe3/51165496 command=python ../02_Tools/npmw.py npx vitest run packages/shared/src/refs.test.ts packages/core/src/knowledge/search.test.ts -t final-line-terminators/bracket-paths/opening-bracket (exact argv in review-red.json); exit1,3expected failures: final LF accepted, prior bracket LineRef formatter throws, bracket document read formatter throws. Add only bounded parser/legacy wrapper/compatibility tests before implementation.

- 2026-10-13 build R1 corrections green: review-green exit0,3bounded regressions; strict full-input checks cover every form and legacy line/artifact wrappers, Unicode line terminators rejected by formatting too. Restored accepted bracket paths; precise bracket document read/search/ref validation green. No additional files or scope; malformed byte-loss corrected, compatibility preserved. Advance validate R2; one bounded fix cycle used.

- 2026-10-13 validate R2 focused: current-byte Windows units-r2 exit0,11files71pass/1POSIX-only skip; native Ubuntu units-r2 exit0,11files72pass; all original argv/cwd/UTC/exit/stdout/stderr/software pre-post receipts retained, both softwareUnchanged=true. Source921file parity and19nonjournal candidate hashes match. Reconciles earlier exploratory pre-format receipts; no broad/full suite. Hunk/requirements/knowledge/context/architecture and exclusions audited; no manual substitution or unrelated changes.

- 2026-10-13 validate R2 independent specification_compliance=approved and implementation_quality=approved; both reviewed all19 nonjournal raw files with aggregate de65c726b789e99198a73c5649db64561631b72bef93b600c0a9b1db7ff87fdb, resolved R1 findings and judged selected coverage sufficient. Original spec-review-r2.json/quality-review-r2.json retained. One of5 fix cycles used; no remaining findings. Final configured strict/statics and current-byte rebuilt native Electron acceptance follows without candidate edits.

- 2026-10-13 validate final: unchanged semantic19-file SHAde65c726b789e99198a73c5649db64561631b72bef93b600c0a9b1db7ff87fdb has bothR2 approvals and original current-byte Windows71pass/1POSIXskip/nativeUbuntu72pass (11selected files). Windows/nativeUbuntu rebuilt e2e/citations.spec.ts exit0,1pass each: actual Electron44.7.0/Node24.21.0,6valid+7invalid kinds, distinct warning styles/inert Enter, complete equal snapshots/transcripts after real restart and no outbound. Configured check --task TASK-4d39ed00 --strict --run exit0 each, lint/typecheck/i18n passed; import-boundary units pass. Linux initial strict could not find configured python; an owned task-bin symlink to /usr/bin/python3 repaired command discovery, all failed statics rerun successfully without product/config edits. Final-proof-parity.json audits every original output digest, all current software hashes and platform parity; full M3 gate remains WP29/coordinator.

- 2026-10-13 validate warnings/Done: Windows0errors11inherited advisories/3manual notes; Ubuntu0errors11inherited advisories/4notes (additional absent ignored anchor in native mirror; authoritative Windows anchor/evolution/base and exact native parity retained). Upstream bundled annotation/NO_COLOR notices are diagnostic only. All WP27 Done oracles automated; no unresolved failure, skipped required check or accepted review finding. Knowledge/context/three requirements/current diagrams reconciled; no structural diagram change or child implementation. Protected optional-companions SHA2a69f5b335a53e498b1f8e30fa5adb8096e870e7a12bbc05b0727a03cee72c6b unchanged/excluded, wp21 manual-user-data untouched.

- 2026-10-13 DEVIATION deliver: automatic approval review rejected verified owned Windows TEMP recursive Remove-Item cleanup, reason blocked by policy; command never executed, scratch retained without bypass. Cost is owned disk scratch only; product validation unchanged. Original Linux proofs copied/hashed and native owned mirror/bin/short temp alias removed after no matching owned processes; shared pinned runtime preserved. windows-cleanup.json/linux-cleanup.json record outcomes.

- 2026-10-13 deliver handback: both current R2 approvals/all19 hashes and original Windows/Ubuntu proof verified; final-proof-parity software367files SHA74dbc4f06ce26c2b9cd75f4a7acd4aeb59b08edbf863d0de21fa2a128c6a6224 identical. Native screenshot inspection confirms readable kinds/warnings/wrapping; automated Done retained. Report read:0errors12warnings means11inherited+expected pending-deliver; automatic21diff paths include excluded human file, actual20delivery files13modified/7added in final-manifest.json. Handoff.json links original argv/cwd/UTC/exit/output/current-source digests, both approvals, exclusions and actual limitations. Implementer now idle, no staging/commit/push/PR/issue closure; coordinator alone accepts/commits under standing human authority, no repeated tests or approval.

- 2026-10-13 coordinator deliver acceptance: full20file current candidate/journal/requirements/design and both originalR2 verdicts reviewed;19nonjournal bound hashes and367software paths match original6native final receipts. Windows71pass1POSIXskip/Ubuntu72pass,Electron1each,strict/statics0each,exact6valid7invalid snapshot restart and screenshot inspected; allDone complete. No coordinator tests. Standing human authorization applies to one localWP27 commit, protected human hash/exclusions preserved. Original11inherited advisories and blockedWindowscleanup accepted as documented. Acceptance: 02_Tools/cache/wp27-TASK-4d39ed00/coordinator-acceptance.json.

- 2026-10-13 coordinator local closeout: delivery report read errors0, expected pending checklist advisory plus11inherited findings. Local commit itself is the complete authorized outcome; done5/5 carried by that single commit per deliver step7. Product proof unchanged, no push/PR/remote publication.

## Rulings

- RULING-001 | date=2026-10-12 | decision=Shared master/autopilot; human authorizes coordinator local ticket commit; implementer must hand back without staging/commit/push/PR/issue closure | reason=delegated user instruction and root AGENTS.md | source=user | supersedes=none
- RULING-002 | date=2026-10-12 | decision=Focused Windows/native Ubuntu tests, Done E2E, static/strict and two independent reviews; M3 full gate remains WP29/coordinator | reason=verification-policy version3 | source=user | supersedes=none

## Handoff

current: done
status: ready
next: coordinator verifies local commit and starts eligible WP28
must_read: .agentic/tasks/TASK-4d39ed00.md
blockers: none; owned Windows scratch retained after automatic cleanup rejection

## Stage report

stage: deliver
result: completed
current: done
changed: 20files; reference syntax/validation/chips and focusedtests/docs
evidence: Windows71pass1POSIXskip;Ubuntu72pass;Electron1each;originalstatic/strict0each;bothR2approved;coordinatoraccepted
issues: 11inherited advisories; Windows cleanup blocked, ownedscratchretained
next: verify local commit then WP28
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-7cd31fe3 - Parse and format every citation reference kind
  - REQ-FUNC-51165496 - Validate issued document citation bounds
  - REQ-UX-34535128 - Show reference kind and citation validity in transcript
- deviations: 1 recorded
  - deliver: automatic approval review rejected verified owned Windows TEMP recursive Remove-Item cleanup, reason blocked by policy; command never executed, scratch retained without bypass. Cost is owned disk scratch only; product validation unchanged. Original Linux proofs copied/hashed and native owned mirror/bin/short temp alias removed after no matching owned processes; shared pinned runtime preserved. windows-cleanup.json/linux-cleanup.json record outcomes.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base ad81bc6: 21 file(s) changed, 1102 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 3/5 done; open: coordinator accepts candidate and makes authorized local ticket commit; coordinator includes journal/report/close-out in that commit

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-7cd31fe3 - Parse and format every citation reference kind
  - REQ-FUNC-51165496 - Validate issued document citation bounds
  - REQ-UX-34535128 - Show reference kind and citation validity in transcript
- deviations: 1 recorded
  - deliver: automatic approval review rejected verified owned Windows TEMP recursive Remove-Item cleanup, reason blocked by policy; command never executed, scratch retained without bypass. Cost is owned disk scratch only; product validation unchanged. Original Linux proofs copied/hashed and native owned mirror/bin/short temp alias removed after no matching owned processes; shared pinned runtime preserved. windows-cleanup.json/linux-cleanup.json record outcomes.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base ad81bc6: 21 file(s) changed, 1119 line(s) added
- checks: errors=0 warnings=12 notes=3
- checklist: 4/5 done; open: coordinator includes journal/report/close-out in that commit
