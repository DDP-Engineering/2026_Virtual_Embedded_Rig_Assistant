# TASK-e7a0e4d8 - PLG-12 Plugin builder
stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-4fdb0d42, REQ-FUNC-bf693078, REQ-FUNC-ef7d2de3, REQ-SEC-72b2eb0b, REQ-FUNC-01ec1dbd, REQ-FUNC-d0bba9ec, REQ-FUNC-636a49ad
parent:
branch: master
base: cf91a71815194c886b9dd52b5d9db5651417b9cf
opened: 2026-11-03

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

Problem: STATED (#68, architecture §8): agents need a reviewed path from CLI documentation to a trial plugin.

Desired outcome: STATED: research and draft through normal tools, validate, user-reviewed trial install, user-only promotion and zip sharing.

Actors: STATED: agent drafts; user approves install, enables, provisions, promotes and exports.

Primary scenario: STATED: help-only CLI fixture -> draft -> validation -> trial review -> user enable -> approved run even in bypass -> user promotion -> bypass run without prompt.

Examples: STATED: plugin_validate {path: "plugins/fixture-cli"}; plugin_install with the same draft.

Counterexamples: STATED: agent promotion, enablement, mode changes and installed-file writes fail.

In scope: STATED: official create-plugin skill, authoring tools, install review, trial, promotion, zip export, CONTRIBUTING; immediate desktop/CLI consumers and tests.

Out of scope: STATED (delegation): next tickets, publication, commits by this implementation chat; compatibility/migrations (AGENTS).

Constraints: STATED: shared master, autopilot; coordinator alone makes the authorized local commit. OBSERVED: clean base cf91a71815194c886b9dd52b5d9db5651417b9cf; formats stay 1. STATED: focused checks plus both independent reviews per verification policy.

Success signals: STATED: all #68 Done criteria plus warnings, hash-conflict refusal and export round trip.

Evidence: OBSERVED: issue read with tea issues 68 --comments=false --repo dpasare/2026_Virtual_Embedded_Rig_Assistant --login ddp; architecture §8 and ADR0016-19; store, registry, gate and UI inspected.

Assumptions: INFERRED: existing gate and store can carry reviewed trial installs, from their exact-request and hash APIs.

Unknowns: UNKNOWN: native Ubuntu runner availability; no hardware required for this ticket.

Decision-blocking questions: None; behavior is specified in #68 and architecture.

Proposed behaviors: None beyond accepted scope.

Path and reason:

| Criterion | Holds? | Evidence |

| no new observable behavior | no | authoring tools |

| no new interface/data format | no | tools and user IPC |

| no new dependency | yes | existing zip/YAML/schema libraries |

| existing requirement covers all | no | authoring not implemented |

| no security/data change | no | installed-file write refusal |

Full path.

## Requirement coverage

| Requirement | Behavior | Design | Proof |
|---|---|---|---|
| REQ-FUNC-4fdb0d42 | Oversized export refusal | Existing zip cap | authoring boundary regression |
| REQ-FUNC-bf693078 | Validate plugin drafts | scoped extension | focused authoring tests |
| REQ-FUNC-ef7d2de3 | Review and install plugin drafts as trial | scoped extension | focused authoring tests |
| REQ-SEC-72b2eb0b | Protect plugin management from agent mutation | scoped extension | focused authoring tests |
| REQ-FUNC-01ec1dbd | Promote reviewed trial plugins through user controls | scoped extension | focused authoring tests |
| REQ-FUNC-d0bba9ec | Export installed plugin packages | scoped extension | focused authoring tests |
| REQ-FUNC-636a49ad | Provide the official plugin authoring skill | scoped extension | focused authoring tests |



## Design

### Approach
STATED (architecture 8): reuse PluginStore package reading and ApprovalGate exact-request approvals.
Add authoring tools and a distinct plugin_install request; always require user decision, including bypass.
Use existing inline approval screen with all manifest fields shown; no install action before approval.
### Interfaces and data
REQ-FUNC-bf693078: validation reads confined folders and returns schema errors plus bounded lint warnings.
REQ-FUNC-ef7d2de3: install prepare captures manifest/hash; apply checks current draft and consumes one approval; installs trial without enablement or provisioning.
REQ-SEC-72b2eb0b: installed/runtime plugin tree is immutable to agent file writes, including bypass. Protect workbench management fields and app configuration from bypass edits. Management IPC stays renderer-only.
REQ-FUNC-01ec1dbd: user promote IPC requires displayed hash and trial tier; atomic record replacement; invalidate program entries.
REQ-FUNC-d0bba9ec: export IPC uses native save picker and writes verified package zip, excluding install.json.
REQ-FUNC-636a49ad: immutable built-in official skill in catalog, same disable/shadow policy as other skills, no editable IPC source.
### Files and test seams
Core plugins authoring/store, gate, registry, session composition; shared tool/event/skill/IPC contracts; desktop main/UI/mock/locales; CLI composition; contribution guide.
Focused unit, real filesystem/SQLite replay integration and desktop/browser acceptance cover Done and failures.
### Risks and open decisions
Hash races use existing store serialization and reviewed hash. Trial reinstall may replace only a trial plugin through the agent path; user trust cannot be downgraded or overwritten by agent calls.
Formats stay 1. No new dependency. Native Ubuntu availability remains unknown.
### Requirement map
All authoring requirements map to the decisions and tests above. REQ-FUNC-4fdb0d42 bounds exported bytes to the established import cap and returns INVALID before saving.
Diagrams: [diagram_TASK-e7a0e4d8.md](diagram_TASK-e7a0e4d8.md)



## Log

- 2026-11-03 frame: journal opened
- 2026-11-03 frame: Human authorized coordinator local commits in AGENTS and delegation; implementation chat must not stage/commit. Clean master base cf91a71815194c886b9dd52b5d9db5651417b9cf.
- 2026-11-03 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-03 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-03 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-03 build: Readiness: setup --check finds pinned Node 24.21.0; npm package timestamp stale; existing node_modules and vitest present, verify actual execution before any reinstall.
- 2026-11-03 build: red: pinned npmw npx vitest run src/libraries/core/src/plugins/authoring.test.ts exit 1, 3 expected failures: plugin_validate unavailable, installTrial missing, official skill absent (REQ-FUNC-bf693078,ef7d2de3,01ec1dbd,d0bba9ec,636a49ad).
- 2026-11-03 build: red: focused write-edit test exit 1; bypass prepare incorrectly allowed managed plugin path (REQ-SEC-72b2eb0b).
- 2026-11-03 build: red: CLI approval-prompt -t never exit 1; --approve all incorrectly preapproves plugin_install and trial commands. Explicit review remains required per architecture 8. Windows focused run: 130 passed, 2 platform skips; one catalog test hit 5s under concurrent setup, to rerun alone. typecheck exit 0 after locked dependency restoration.
- 2026-11-03 build: green: Windows focused source/real-process/UI checks 130 passed (one catalog timeout subsequently passed alone); CLI/mock rerun 26 passed, catalog plus CLI rerun 36 passed except updated mock indexing now corrected; typecheck exit 0. Original logs 02_Tools/cache/plugin-cycle/plg-12/logs. Native Electron initial launch used production build, so picker seam absent; rerunning VERA_TEST=1, no product change.
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: Independent round1 reviews: both changes_required for P2 oversized export archive. Enforce existing PLUGIN_LIMITS.zipBytes before returning zip; boundary regression. Native Windows acceptance passed 1 test/32.4s. Reviewers also requested higher-risk no-warning proof (added) and removed accidental unused prompt env spreads.
- 2026-11-03 validate: returned to build - Round1 P2 export zip cap refusal and focused boundary proof
- 2026-11-03 build: red: oversized export boundary test exit1, got exported instead of INVALID; implemented byte cap before return. Controlled ESM mock test corrected before this valid red.
- 2026-11-03 build: green: review-fixes.txt 95 passed (authoring5 including export cap, service40, workspace49, integration1); remaining context assertion changed from empty skills to official create-plugin and context-consumer.txt passes1. Earlier consumer timeouts resolved with serial checks and no product changes. Native Ubuntu final script exited0; copying original logs.
- 2026-11-03 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-03 validate: Round2 independent specification and quality reviewers both approved complete candidate. Original native evidence: e2e-windows.txt1 pass32.4s; native Ubuntu final-status exit0, affected-final6 pass including real-process replay/export cap, e2e1 pass11.8s; prior native focused90 pass1skip and corrected integration timeout. No hardware used. Final statics next.
- 2026-11-03 validate: Final --strict --run: typecheck exit0 and i18n exit0; lint exit1 solely for CRLF in untouched knowledge/chunk-settings.test.ts and extraction.test.ts. Verified normalized bytes equal HEAD blobs, restored LF without Git diff. Per verification policy rerun only lint and strict structural check, reuse unchanged typecheck/i18n evidence. Existing advisory warnings are historical; uncovered workbench/service.test.ts is immediate-consumer expectation coverage proved by40 passing tests, not missing product coverage.
- 2026-11-03 validate: Final composite static proof: strict structural exit0 (47 advisory warnings explained), lint-final exit0, typecheck/i18n exit0 from original strict-final --run. No candidate edit after reviews; two untouched CRLF checkout files normalized to exact HEAD bytes and produce no Git diff. Main sessions focused4 passed. Owned Windows/Ubuntu scratch cleaned with original logs retained.
- 2026-11-03 validate: completed; next done
- 2026-11-03 done: Coordinator acceptance: inspected complete current candidate including untracked files, full journal/requirements and original Windows/native Ubuntu proof; confirmed both independent round2 approvals in reviewer chats 01a1a207-552a-7cf3-a85e-aefc29da4437 and 01a1a207-845c-7522-94f8-71c97c165707. Focused failures are superseded by affected reruns; static composite lint/typecheck/i18n and strict structural proof accepted per verification policy. User explicitly authorized this coordinator to make one local commit on master before the next ticket; no remote/Gitea mutation. No product edits or handover retesting. Commit PLG-12 candidate and journal only; source scope matches base cf91a71815194c886b9dd52b5d9db5651417b9cf.

## Rulings



## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e7a0e4d8.md
changed: PLG-12 authoring skill/tools, reviewed trial install, user promotion/export and management boundary; concise docs and regression tests
evidence: Focused Windows/Ubuntu and real CLI replay passed; native Electron 1 each; composite lint/typecheck/i18n and strict structural exit0; both independent reviews approved round2. Original proof: 02_Tools/cache/plugin-cycle/plg-12/{logs,linux-logs}.
issues: No functional blockers. Virtual CLI only, no hardware claim; full suites deferred by ticket policy. Initial strict --run lint failure corrected as checkout-only LF normalization; passing typecheck/i18n reused with lint and strict reruns. 47 nonblocking AEGIS advisories explained.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-4fdb0d42 - Refuse oversized plugin exports
  - REQ-FUNC-bf693078 - Validate plugin drafts
  - REQ-FUNC-ef7d2de3 - Review and install plugin drafts as trial
  - REQ-SEC-72b2eb0b - Protect plugin management from agent mutation
  - REQ-FUNC-01ec1dbd - Promote reviewed trial plugins through user controls
  - REQ-FUNC-d0bba9ec - Export installed plugin packages
  - REQ-FUNC-636a49ad - Provide the official plugin authoring skill
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base cf91a71: 58 file(s) changed, 1511 line(s) added
- checks: errors=0 warnings=47 notes=6
- checklist: 9/9 done
