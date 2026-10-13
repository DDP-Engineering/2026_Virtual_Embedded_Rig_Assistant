<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-3b991c6e - WP-34 Advanced context compaction

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-e5b6a1c9, REQ-UX-d1b480e0
parent:
branch: master
base: 91acfb95ea2fe5a372bde83182fd4f1aef82aa0a
opened: 2026-10-13

## Done checklist (current stage)

- [x] Complete candidate confirmed, static proof recorded and both round3 reviews approved.
- [x] Present exact scope, evidence, exclusions and deferred Done criteria.
- [x] Hand back candidate without staging/commit/publication under delegated boundary.
- [x] Coordinator verifies candidate/deviation and authorizes standing single local commit.
- [x] Coordinator closes before local-only commit outcome; actual commit stored in cycle/receipt.

## Frame

Problem: STATED WP34 long sessions need useful history beyond M1 reduction.
Desired outcome: Derived summaries preserve decisions, source refs and outstanding work with full transcript retained.
Actors: user, ReferenceRuntime, ContextPolicy, SessionService, gateway, renderer.
Primary scenario: Above80% input budget -> one bounded historical summary -> normal budget recheck -> dispatch or explicit context limit.
Examples: multi-turn small-window replay retains decisions/refs.
Counterexamples: First-turn/current oversized instruction and unfinished work cannot be summarized away.
In scope: completed-exchange compaction, derived session cache, bounded failures, status/request-view meter and affected documentation/regressions.
Out of scope: WP35, live APIs, M4 continuation, release probes, staging/commit/publication, cycle helper changes.
Constraints: STATED runtime tests deferred by user; pinned runtime/security; shared master, sole implementer, two read-only reviewers.
Success signals: bounded normal/summary requests, one attempt, preserved transcript; statics and reviewers. Runtime Done proof deferred.
Evidence: OBSERVED core agent context/runtime perform M1 detached reduction; SessionService recreates runtime each send; cycle WP34 matches base. STATED M5 WP34/architecture03Â§2/7/8,04Â§3/7/8.
Assumptions: INFERRED derived in-memory cache can be rebuilt after restart from full history.
Unknowns: Runtime summary semantic quality unobserved until tests resume.
Decision-blocking questions: none.
Proposed behaviors: summarize bounded whole completed exchanges; retain refs deterministically; fallback to M1 and meter.
Path and reason: full. New behavior/interface yes; existing complete coverage no; dependency change no; persistent replacement no. Tightly coupled scope needs no implementation children.

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Positive case | Boundary or failure | Verification | Design decision or no impact |
|---|---|---|---|---|---|---|
| Useful history | Bounded derived compaction | REQ-FUNC-e5b6a1c9 | decisions/refs/work retained | first turn, current oversized, small model, failed summary, abort | deferred runtime replay | completed history only, one attempt, policy on both calls |
| Observable context | status/request-view size | REQ-UX-d1b480e0 | live/replayed meter | optional old fields | deferred shared/UI regressions | optional usage schema, translations |

## Design

- REQ-FUNC-e5b6a1c9: ContextPolicy counts raw input for the80% trigger before M1 reduction, and remains the mandatory whole-request budget owner.
- ContextCompactor owns an ephemeral summary/covered-prefix fingerprint; SessionService owns one per session and clears delete/close. Direct runtime resets its local instance at start.
- Eligible history consists of complete user exchanges ending in successful assistant stop with answered tool pairs. Current turn and interrupted history remain intact; historical incomplete exchanges are retained separately even when later completed exchanges are summarized.
- Select largest group of whole completed exchanges whose summary prompt fits ContextPolicy with current output reserve/safety margin; at most one summary dispatch per normal request. No eligible/fitting history means M1 fallback.
- Same model/gateway/signal, no tools; retain original system rules and label historical input untrusted. Accept only text-only successful structured summary with decisions/outstanding work; attach refs deterministically.
- Adopt only a shorter derived view; recheck current model budget. Invalid/failed summary uses M1 fallback without recursive retry. Full persisted messages/events/citation provenance stay unchanged.
- REQ-UX-d1b480e0: optional compactionStatus/requestViewTokens usage fields, localized en/ro/de meter. Summary actual usage counts separately from estimates.
- No migration/dependency changes. Risk: semantic summary quality needs deferred runtime proof; one bounded prefix may not rescue irreducible current input.
- Expected files: core agent context/compaction/runtime/types, sessions/service; shared/events; usage-meter/locales; focused regression files; knowledge/context.
- Test seams: context/runtime replay, SessionService transcript, shared usage projection and UI. Execution deferred by user.

## Log

- 2026-10-13 frame: accepted delegated scope; full path, autopilot/master at recorded base. Pre-existing untracked optional-companions excluded.
- 2026-10-13 specify: two requirements; M1 contracts unchanged; coverage maps compaction/meter.
- 2026-10-13 design: bounded prefix/cache/failure/budget design above accepted in autopilot.
- 2026-10-13 build: red/green runtime execution deferred by user; author regression scenarios without running.
- 2026-10-13 DEVIATION validate: unit/integration/E2E/CLI/package/smoke/full suites and runtime Done proof deferred by direct user instruction. M4 remains incomplete, not PASS; statics/two reviews retained.

- 2026-10-13 build: implemented whole completed-exchange summary selection, preserving interrupted historical segments separately; ephemeral per-session cache, budget checks/fallback, exact reference union and optional localized meter. Added regression scenarios without execution.

- 2026-10-13 validate: setup --check ready (pinned Node24.21.0, lock-matching dependencies); reviewed14software paths, updated relevant knowledge/context/spec and preserved user file. Runtime tests remain unexecuted.

- 2026-10-13 validate round1: spec_review approved; quality_review changes_required, P2 unstable synthetic repair timestamps invalidate cache, P2 abort during summary leaves running meter persisted. Return to build for these two findings only; both verdicts cleared during edits.

- 2026-10-13 build round2: corrected both P2 findings: synthetic unresolved-result timestamps now derive from source assistant; terminal usage is published before abort return. Authored deferred advancing-clock/cache and abort/status regressions; runtime tests still unexecuted.

- 2026-10-13 validate round2: independent spec_review specification_compliance=approved and quality_review implementation_quality=approved on the corrected complete candidate; both read-only, no tests/builds/probes. Round1 P2 findings resolved, no actionable findings remain.

- 2026-10-13 validate: strict --run executed only lint/typecheck/i18n, tests explicitly skipped. Lint/i18n exit0; typecheck exit2 on optional compactionStatus under exactOptionalPropertyTypes; strict exit1,14 pre-existing governance warnings. Returned to build for type contract correction; round2 verdicts cleared.
- 2026-10-13 build round3: narrowed ContextCompactor.prepare return to guaranteed CompactionView with required status/requestViewTokens; implementation values/behavior unchanged. Reuse identical renderer/catalog i18n and lint proof except changed compaction.ts; rerun affected lint/typecheck and strict catalog only.

- 2026-10-13 validate round3: independent spec_review=approved and quality_review=approved for the complete current candidate; type-only contract correction preserves reviewed behavior/P2 fixes. Read-only reviews and diff whitespace check; runtime evidence deferred.

- 2026-10-13 validate final: original `check --task TASK-3b991c6e --strict --run` lint exit0/i18n exit0 reused for byte-identical affected files except compaction.ts; changed-file `python ../02_Tools/npmw.py npx biome check packages/core/src/agent/compaction.ts` exit0. Final `python ../02_Tools/npmw.py npm run typecheck` exit0 after correction (silent npm output per .npmrc). Final `python .agentic/aegis.py check --task TASK-3b991c6e --strict` exit0, errors0/warnings14/notes3; all14 warnings are pre-existing ticket-ref/historical journal format findings, unpromoted and outside scope. No runtime tests executed. Logs:02_Tools/cache/wp34/implementer-{static,typecheck,strict}.log; evolution14software paths reviewed.
- 2026-10-13 deliver:23owned candidate paths (14software,5knowledge/context,2requirements,1spec,1journal); base/HEAD91acfb95ea2fe5a372bde83182fd4f1aef82aa0a, index empty, protected optional-companions SHA256 unchanged. Candidate handback only; no commit/staging/publication/issue mutation, coordinator cycle untouched. No functional blocker to authorized advance; runtime acceptance remains deferred.

- 2026-10-13 deliver catalog: final journal-only handoff strict exit0, errors0/warnings15/notes3; added unticked-deliver warning correctly identifies the2pending coordinator commit/close items. Validation source proof remains unchanged; no tests or statics repeated for the journal update.

- 2026-10-13 coordinator delivery: inspected exact23owned files, full journal/Done/spec/requirements and complete source/authored deferred regression delta; independently read both currentround3reviewer final verdicts approved. Manifest23currentbyte hashes and protected humanSHA unchanged; original lint/i18n proof reused only on unchanged files, changedcompaction lint/typecheck/strict actual0 confirmed in original tool execution records/logs. Runtime tests and allthreeDone remain explicitly deferred by direct human instruction, not PASS; sourceimplementation accepted under this deviation. No coordinator test/static rerun, no historicalcacheaudit. Standing one local commit authority confirmed; closeout carried before localonly commit per deliverstep7. ActualSHA recorded atomically in cycle/receipt before WP35; no remote publication.

## Deferred Done evidence

| WP34 plan Done criterion | Status | Authored future regression route |
|---|---|---|
| Multi-turn replay exceeds small window, preserves decisions/refs, all normal/summary requests fit | DEFERRED by explicit user instruction; not executed, no PASS | agent/compaction.test.ts multi-turn, structured refs/cache |
| Long first turn, oversized instruction, smaller-model switch, failed summary preserve M1 semantics/retry bound | DEFERRED by explicit user instruction; not executed, no PASS | agent/compaction.test.ts boundaries/failure/abort; existing M1 context/runtime-edge scenarios |
| Transcript shows full history after compaction | DEFERRED by explicit user instruction; not executed, no PASS | sessions/service.test.ts durable compaction/restart; runtime transcript assertion |

## Rulings

- RULING-001 | date=2026-10-13 | decision=Shared master/autopilot; candidate handback without staging or commit | reason=Standing single local commit authority belongs exclusively to coordinator after candidate/deviation review | source=user | supersedes=none
- RULING-002 | date=2026-10-13 | decision=Defer runtime tests/M4; retain statics and two read-only reviewers | reason=Direct human development-priority instruction supplied in delegation | source=user | supersedes=none

## Handoff


current: done
status: ready
next: Coordinator makes single local commit then advances WP35; runtime evidence stays deferred.
must_read: .agentic/tasks/TASK-3b991c6e.md, .agentic/specs/REQ-FUNC-e5b6a1c9.md
blockers: None for authorized advance; runtime Done proof deferred by user.

## Stage report


stage: deliver
result: completed
current: done
changed: Compaction/runtime/session cache, shared usage, localized meter, deferred scenarios and knowledge.
evidence: Lint/typecheck/i18n exit0; strict exit0; handoff catalog15warnings (14pre-existing,1pending coordinator delivery); both round3 reviews approved.
issues: All3runtime Done criteria deferred;14pre-existing warnings; unticked-deliver reflects2coordinator-owned commit/close items.
next: Coordinator makes single local commit then advances WP35; runtime evidence stays deferred.
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-10-13)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-e5b6a1c9 - Bounded completed-exchange compaction
  - REQ-UX-d1b480e0 - Compaction context meter
- deviations: 1 recorded
  - validate: unit/integration/E2E/CLI/package/smoke/full suites and runtime Done proof deferred by direct user instruction. M4 remains incomplete, not PASS; statics/two reviews retained.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 91acfb9: 24 file(s) changed, 1183 line(s) added
- checks: errors=0 warnings=14 notes=3
- checklist: 5/5 done
