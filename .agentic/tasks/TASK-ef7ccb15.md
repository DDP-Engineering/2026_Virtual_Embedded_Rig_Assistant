<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-ef7ccb15 - WP-36 Session export and search

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-70479d66, REQ-FUNC-1b882a4b, REQ-SEC-17075aa1
parent:
branch: master
base: 28c03475c8d1f017233c24e782554811d50fd908
opened: 2026-10-13

## Done checklist (current stage)

- [x] Unchanged non-journal candidate bound to final static proof and both round2 approvals
- [x] Scope/diff/proof/exclusions/deferred runtime obligations presented
- [x] Standing user authorization for coordinator local commit recorded
- [x] Coordinator includes journal/report in the local commit
- [x] Coordinator makes the authorized WP36 local commit
- [x] Coordinator carries close-out in that commit

## Deferred plan Done

- [ ] Fixture Markdown snapshot and JSON roundtrip: authored, execution deferred; no PASS.
- [ ] E2E search finds a session by a word from its messages: authored, execution deferred; no PASS.

## Frame

Problem: STATED WP36 sessions must leave VERA and be found again.
Desired outcome: Markdown full transcript/tool summaries/citations/changes; JSON durable events; sidebar title/message search.
Actors: local user, sandbox renderer, authorized main frame, workbench-owned SessionService.
Primary scenario: user searches message word -> session appears -> select -> choose Markdown/JSON -> native picker -> scrubbed atomic export.
Examples: historical message hidden from request by compaction remains exported/searchable; pending steering appears once with pending marker.
Counterexamples: derived compactor summaries, another workbench, live-only deltas, credentials, runtime .vera destination.
In scope: core projections/formatters, strict shared schemas/IPC, native dialog/file port, renderer/mock/i18n, authored deferred regression fixtures, directly affected knowledge.
Out of scope: CLI additions not demanded by plan, model calls, dependency changes, migrations, coordinator helpers, publication.
Constraints: STATED master/base recorded, autopilot, sole implementer; coordinator owns authorized local commit; no staging/commit/push. Runtime test/build prohibition supersedes prior test-first/full-gate policy. Preserve optional-companions SHA2562a69f5b335a53e498b1f8e30fa5adb8096e870e7a12bbc05b0727a03cee72c6b.
Success signals: statics and two independent read-only reviews; both runtime Done criteria explicitly deferred.
Evidence: STATED delegation/plan M5 WP36; OBSERVED shared reducer preserves queued/delivered and full message.done, SessionHub persists event order, artifacts native export confines destination. Referenced benchmark export uses deterministic sections; its report schema is unrelated.
Assumptions: INFERRED case-insensitive literal substring is sufficient; bounded search input uses existing no-index SQLite event storage.
Unknowns: runtime acceptance remains unexecuted by instruction.
Decision-blocking questions: none.
Proposed behaviors: complete durable history export, literal title/message matching, native save with redaction and confinement.
Path and reason: full; new behavior/interface/data format (quick criteria=no), no dependency (yes), existing exact requirement (no), new data disclosure boundary (no). One task; reviewers read-only only.

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Positive case | Boundary/failure | Verification | Design |
|---|---|---|---|---|---|---|
| Session leaves VERA | Full durable export | REQ-FUNC-70479d66 | Historical and pending transcript | Empty/running/citations/changes | Frozen Markdown + JSON reducer roundtrip (deferred) | Pure core formatter over shared schema |
| Find session | Literal title/message matching | REQ-FUNC-1b882a4b | Later message word and Unicode | Wildcards literal, empty results/workbench separation | Core + native E2E (deferred) | Existing ordered event repository, no index/migration |
| Safe disclosure | Authorized scrubbed native write | REQ-SEC-17075aa1 | Read-only external export | Cancel/.vera/relative/secret text | Main fixture (deferred) | Reuse sanitizer/destination and serial host |


## Design

REQ-FUNC-70479d66: core SessionService.exportSession reads metadata/events synchronously from existing DB; shared strict versioned export schema. Pure buildSessionMarkdown folds the full shared reducer and includes ordered applied stored diffs. Deterministic literal fences prevent injected Markdown/HTML while retaining every text byte. JSON keeps all durable events, no compactor summaries.
REQ-FUNC-1b882a4b: SessionService.search bounds/validates query, matches host-scrubbed title and message-event text using Unicode lowercase includes. EventsRepository message-only query reuses current session index, handles queued/delivered without duplicate session results. Linear history scan trades indexing complexity for small minimal implementation; no migration.
REQ-SEC-17075aa1: main serial SessionsHost owns dialog lifetime and delayed export snapshot. Reuse artifact destination guard and existing metadata/event sanitizer, then strict parse JSON. Renderer sends ID/enum only, never a path; atomic host write. Read-only reads/export supported. Error/cancel propagate ordinary contract; no write before selection. Main captures workbench root during serial operation, preventing lifecycle switch.
Renderer separate search query keyed by workbench/query avoids clearing active selection; polling/invalidation keeps results current; export selected session and completion/cancel/error localized en/ro/de. Mock mirrors message-only match.
Compatibility: no DB migration/pins/new dependencies. CLI unchanged because WP36 does not demand a new CLI entrypoint.
Test seams: core export/search fixture + snapshot, shared strict IPC/schema, main export cancel/guard/scrub fixture, native message-only search E2E. All authored, none executed per authority.
Expected files: core sessions export/service and EventsRepository; shared session-export/index/ipc; main session-export/artifacts/events/index; renderer App/session-list/workspace/mock/locales; related tests, sessions/chat knowledge and context. Risk: runtime evidence deferred; no unsupported PASS. Open decisions: none.

### Proposed architecture - TASK-ef7ccb15

Renderer search/export -> strict shared channels -> authorized ipc-router -> serial SessionsHost -> SessionService/events DB -> pure core formatter -> existing native dialog/destination/atomic file port.


## Log

- 2026-10-13 build: implemented core/shared/main/UI/mock export/search and authored frozen Markdown/JSON, search, strict IPC and native destination/redaction/E2E scenarios. No runtime tests or builds executed.
- 2026-10-13 DEVIATION validate: runtime test-first/focused/full/native acceptance and both WP36 Done criteria deferred under explicit user skip-tests policy; statics/two reviews retained. Runtime confidence is unproven; M4 incomplete, not PASS.

- 2026-10-13 specify: three atomic requirements and versioned export/search spec cover history, matching and native disclosure; assumptions resolved from existing seams.
- 2026-10-13 design: minimal event-based projection, existing sanitizer/guard and separate renderer search cache agreed; no migration/dependency/CLI expansion.

- 2026-10-13 frame: accepted delegated WP36 scope on master/base; full path, autopilot, one implementation task. Existing user local-commit authority belongs to coordinator after handback; implementer prohibited from staging/commit/publication.

- 2026-10-13 validate entry: full journal/requirements/step reread; formats, escaping, secret/redaction, lifetime and scope inspected; knowledge/context updated. Runtime obligations stay deferred.

- 2026-10-13 validate round1: independent spec_compliance=approved (/root/spec_review) and implementation_quality=approved (/root/quality_review), no actionable findings. Same35path candidate;34non-journalSHA5f6ac8532cd0e78bd740420e8a8cb878193ec91877b5a78005e780852779ec7c. Original verdict record and hashes:02_Tools/cache/wp36/implementer-TASK-ef7ccb15/{reviews,review-round1-manifest}.json. Proceed final statics; runtime Done2deferred.

- 2026-10-13 validate correction: first strict exit1 exposed missing new-channel adapters in router/preload authored tests and unsupported dynamic i18n call; final stdout/stderr retained as attempt1 proof. Updated immediate adapters and literal translation calls; formatting corrected; source/requirement traceability completed. Both round1 approvals invalidated, request round2 on updated candidate. No runtime tests.

- 2026-10-13 validate round2: independent spec_compliance=approved and implementation_quality=approved; both reviewers reconfirmed integrated37path candidate after adapter/i18n correction, no actionable findings. Bound36non-journalSHA2d85c1063838387418d3f0d76706fa0c17baafef294c5f52f01024f3f024b4a9/softwareSHA4b6355e633fdd783a280446414659c3f451635bda8f51ceaeb00aa16361224b4; original verdicts/round2manifest in own cache. Proceed corrected final statics only.

- 2026-10-13 validate final: corrected `python .agentic/aegis.py check --task TASK-ef7ccb15 --strict --run` exit0 at2026-10-13T16:25:44.102889Z..16:25:56.023148Z, repository cwd; static commands run under05_Software (lint3.0s,typecheck6.9s,i18n1.0s), no test. errors0/WARN14/NOTE3:13historic journal format warnings and one pre-existingDEMO-01pattern, outside WP36; no source/traceability warning remains. Original raw stdoutSHAce14fc3733d394abe596c6090bebd0ced190cfbe150738be8fa47c6ca7f23165, empty stderrSHAe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. Proof JSON and raw logs retained in02_Tools/cache/wp36/implementer-TASK-ef7ccb15/windows-strict*. Bound softwareSHA4b6355e633fdd783a280446414659c3f451635bda8f51ceaeb00aa16361224b4 and36non-journalSHA2d85c1063838387418d3f0d76706fa0c17baafef294c5f52f01024f3f024b4a9 match both round2 reviews. Tests/Done2deferred by user; M4 incomplete, not PASS. Advance deliver to coordinator handback, no implementation blocker.

- 2026-10-13 deliver handback: complete37path candidate vs base, index empty, master/HEAD unchanged28c03475c8d1f017233c24e782554811d50fd908. Final per-pathSHA manifest in own cache;36non-journal and25software paths still match round2 reviews/final strict. Protected optional-companions.md excluded/intactSHA2a69f5b335a53e498b1f8e30fa5adb8096e870e7a12bbc05b0727a03cee72c6b. Generated report counts38paths because it includes that existing user untracked file; authorized candidate remains37paths. ReportWARN15 = final historical14 plus coordinator-owned unticked deliver; report is advisory, original static logs authoritative. No runtime tests/DonePASS, no staging/commit/push/PR/issue changes, no new builds/profiles/mirrors. Own scratch contains original proof/review/manifests only, retained for coordinator; no disposable owned scratch data or test processes. Reviewer agents completed readonly. Implementation has no blocker; next is coordinator verification and standing-authorized single local commit/close-out.

- 2026-10-13 coordinator deliver: inspected full37path candidate/journal/requirements/Done, both original round2 verdicts and exact current manifest/raw static receipt/log identities. Reused statics exit0; no retesting. Both runtime Done remain deferred/no PASS by direct human instruction; M4 incomplete. Standing authorization covers one local WP36 commit, protected human draft excluded/intact. Local-commit-only outcome carries close-out in this commit; actual SHA recorded atomically after success.

## Rulings

- RULING-001 | date=2026-10-13 | decision=Master/base/autopilot; coordinator owns standing-authorized local commit; implementer returns candidate without staging or commit | reason=delegation and AGENTS | source=user | supersedes=none
- RULING-002 | date=2026-10-13 | decision=No runtime/unit/integration/E2E/CLI/package/smoke/full/M4/M5/Ubuntu/build probes; statics and two read-only reviews retained; both Done deferred | reason=explicit development-priority and skip-tests instruction; cycle active verification confirms override | source=user | supersedes=none

## Handoff

current: done
status: ready
next: coordinator records actual local commit SHA and starts WP37
must_read: .agentic/tasks/TASK-ef7ccb15.md, 02_Tools/cache/wp36/implementer-TASK-ef7ccb15/candidate-manifest.json, 02_Tools/cache/wp36/implementer-TASK-ef7ccb15/windows-strict.json, 02_Tools/cache/wp36/implementer-TASK-ef7ccb15/reviews.json
blockers: none; runtime Done2 deferred under user policy

## Stage report

stage: done
result: completed
current: done
changed: Markdown/JSON export; title/message search
evidence: strict/statics exit0; both round2 reviews approved
issues: runtime Done2 deferred; M4 incomplete; historical warnings14
next: coordinator records local commit and starts WP37
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-10-13)

- stage: deliver; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-70479d66 - Export complete session history
  - REQ-FUNC-1b882a4b - Search sessions by title and message text
  - REQ-SEC-17075aa1 - Confine and scrub session exports
- deviations: 1 recorded
  - validate: runtime test-first/focused/full/native acceptance and both WP36 Done criteria deferred under explicit user skip-tests policy; statics/two reviews retained. Runtime confidence is unproven; M4 incomplete, not PASS.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 28c0347: 38 file(s) changed, 1149 line(s) added
- checks: errors=0 warnings=15 notes=3
- checklist: 3/6 done; open: Coordinator includes journal/report in the local commit; Coordinator makes the authorized WP36 local commit; Coordinator carries close-out in that commit

## Delivery report (2026-10-13)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-70479d66 - Export complete session history
  - REQ-FUNC-1b882a4b - Search sessions by title and message text
  - REQ-SEC-17075aa1 - Confine and scrub session exports
- deviations: 1 recorded
  - validate: runtime test-first/focused/full/native acceptance and both WP36 Done criteria deferred under explicit user skip-tests policy; statics/two reviews retained. Runtime confidence is unproven; M4 incomplete, not PASS.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 28c0347: 38 file(s) changed, 1167 line(s) added
- checks: errors=0 warnings=14 notes=3
- checklist: 6/6 done
