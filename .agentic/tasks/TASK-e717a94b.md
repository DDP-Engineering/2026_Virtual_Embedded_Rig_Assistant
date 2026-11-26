# TASK-e717a94b - Improve Analysis Skills routing and saved report handoff

stage: done
type: change
interaction: autopilot
requirements: REQ-FUNC-b4f70e7e, REQ-FUNC-13532c3c, REQ-FUNC-850f8cc8, REQ-FUNC-c0300003, REQ-FUNC-c0400007
parent:
branch: master
base: bdd1fd55b9f125171470cc25bf08501ae7591974
opened: 2026-11-26

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
- [x] final strict result and focused proof logged under the repository verification policy
- [x] remaining warnings and model limitations explained
- [x] `report` appended

## Frame

Problem: OBSERVED. The planner advertises execution requests; the agent can save but cannot reopen a named session artifact through ordinary text tools.
Desired outcome: STATED. Implement the proposed plugin improvements, starting with routing, and verify the saved comparison to plan on one local and one hosted model.
Actors: STATED. An embedded engineer and the VERA agent.
Primary scenario: STATED. Compare two saved firmware runs, then create a manual plan from the saved report.
Examples: INFERRED. Reopen the same session and refer to the comparison by its exact artifact reference.
Counterexamples: STATED. A request to execute tests is distinct from a request to plan; absent criteria cannot support an acceptance verdict.
In scope: STATED. Work package in 00_Planning/plan/analysis-skills-improvements.md.
Out of scope: INFERRED. Cross-session artifact access, hardware execution, new providers and publication.
Constraints: STATED. Shared local master, preserve existing unrelated edits and format 1.
Success signals: INFERRED. Clear skill selection, bounded verified read of the same-session report, per-case planning status, repeatable local and hosted results.
Evidence: OBSERVED. Plugin contains two Markdown skills; ArtifactStore verifies bytes and already indexes per session; model catalog responds on the provided LM Studio endpoint.
Assumptions: INFERRED. Use fictional evidence and existing authenticated hosted integration.
Unknowns: UNKNOWN. Current hosted authorization and outcomes of the model probes.
Decision-blocking questions: None.
Proposed behaviors: STATED. Implement the improvements accepted in chat.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Route by comparison or manual planning intent | REQ-FUNC-b4f70e7e | Skill descriptions and targeted probes |
| Read an exact saved report in the owning session | REQ-FUNC-13532c3c | Existing read tool with verified artifact namespace |
| Show actionable observations and separate case readiness | REQ-FUNC-850f8cc8 | Markdown procedure and template sections |
| Keep comparison limits explicit | REQ-FUNC-c0300003 | Existing comparison condition rules |
| Block overall readiness with unsupported cases | REQ-FUNC-c0400007 | Existing aggregate rule and per-case status |

## Design

**Approach.** Give the two skills distinct routing descriptions, keep the package ID, and retain
grounded comparison and planning. The planner reads an explicitly supplied session artifact
and reopens its cited workbench sources. Missing conditions limit conclusions.

**Interfaces and data.** Extend read's existing path to accept an exact artifact reference for the
current session, with the existing offset/limit and read output limits. Store lookup is scoped by
session and name and verifies bytes against persisted SHA-256. Return the exact ref and hash for
pagination; invalid, missing and changed artifacts fail without returning content. No stored format changes.

**Files and test seams.** The plugin owns descriptions, templates and help. Core tools/read and
ArtifactStore own verified artifact access. Use real replayed SessionService for access tests and a
synthetic comparable I2C fixture with both live gateways for the workflow.

**Risks and open decisions.** Hosted authorization is checked through the existing provider.
Only synthetic workbench evidence goes into model evaluations, and execution is outside the workflow.

**Requirement map.** REQ-FUNC-b4f70e7e maps to metadata/routing. REQ-FUNC-13532c3c maps to core
read, integrity and session isolation. REQ-FUNC-850f8cc8, REQ-FUNC-c0300003 and REQ-FUNC-c0400007
map to cited observations and explicit aggregate and case-level statuses.

## Log

- 2026-11-26 frame: journal opened
- 2026-11-26 frame: completed; next specify - User accepted the review proposals on local master (7 Done checklist item(s) left unticked)
- 2026-11-26 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-26 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-26 build: red: pinned Vitest plugins analysis-skills.test.ts exit 1 - installed skill metadata still advertises the old triggers (REQ-FUNC-b4f70e7e)
- 2026-11-26 build: red: pinned Vitest core-resources artifacts.test.ts exit 1 - current-session artifact ref is rejected as a file path (REQ-FUNC-13532c3c)
- 2026-11-26 build: green: pinned focused Vitest read/artifacts/analysis-skills 20 passed, 2 skipped; typecheck and CLI build exit 0, changed-file lint and i18n/help/release-notes exit 0. Both real gateways saved a comparison and entered the reopened-session planning turn.
- 2026-11-26 build: completed; next validate - Focused regression proof passes; real provider workflow and official-plugin suite in progress (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Round 1 found worker disposal and imprecise evaluator scoring; the local model narrowed citations and reused originals without opening them during the planning turn.
- 2026-11-26 build: Round 1 fixes: dispose the worker pool, score successful full-turn skill routing and exact artifact result fields, require source refs issued before save, parse explicit aggregate/per-case readiness and check execution acknowledgment. Six scoring tests and typecheck pass. Hosted GPT-6.1 Sol passes all eight checks on the repeated live run. Local Qwen reopens the report and rereads sources, but narrows some citations; preserve those receipts. Same fixture is running on local Inkling for comparison.
- 2026-11-26 build: completed; next validate - Applied round 1 review and refined the live evaluation without weakening the citation contract. (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Round 2 scorer could accept grep-only evidence, a comparison without baseline log provenance and an invented Unicode timing threshold.
- 2026-11-26 build: Round 2 fixes: score both parsed log citations, require read/read_doc or parse_log for fresh original evidence, reject unsupported Unicode or verbal numeric timing limits, and accept explicit status or criterion fields with ordinary Markdown wrapping. Nine scorer tests and pinned typecheck exit 0. Current rescoring of actual receipts: hosted GPT-6.1 Sol 8/8; local Qwen 6/8 with exact citation failures only after verified handoff and fresh reads; local Inkling did not finish the plan before its limit. All raw receipts retained.
- 2026-11-26 build: completed; next validate - Round 2 false-positive inputs are covered by negative tests and real receipts rescored. (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: DEVIATION validate: strict without --run, targeted VERA checks and the official plugin suite - the repository policy reserves the full app suite for milestones.
- 2026-11-26 validate: final: strict check exit 0 (111 layout and coverage warnings in the mixed checkout, no errors); focused product 20 passed with 2 skipped, evaluator 9 passed, typecheck/lint/locale/help/release checks exit 0. Official suite exit 1 (675 passed, 201 skipped and the unrelated Renode process test failed); isolated Renode rerun exit 0, matched coverage totals 676 passes.
- 2026-11-26 validate: completed; next done
- 2026-11-26 done: User authorized the local master commit for Analysis Skills without pushing. The direct follow-up brings the plugin to 0.4.1. The repeated LM Studio Qwen workflow passed 8/8 checks; focused citation, artifact and plugin validation passed 22 tests with one POSIX-only test skipped on Windows.

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e717a94b.md
changed: Analysis Skills 0.4.0, distinct skill routing, verified same-session handoff and per-case readiness
evidence: 29 focused tests, official suite plus successful Renode retry, hosted 8/8 and local Qwen 6/8 on the live synthetic workflow.
issues: Qwen narrowed exact reference ranges; Inkling reached its planning turn limit before saving.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-26)

- stage: validate; type: change; branch: master
- requirements:
  - REQ-FUNC-b4f70e7e - Advertise the analysis skill by the requested outcome
  - REQ-FUNC-13532c3c - Read named artifacts from the current agent session
  - REQ-FUNC-850f8cc8 - Expose grounded observations and individual test readiness
  - REQ-FUNC-c0300003 - Qualify run comparability
  - REQ-FUNC-c0400007 - Block unsourced readiness
- deviations: 1 recorded
  - validate: strict without --run, targeted VERA checks and the official plugin suite - the repository policy reserves the full app suite for milestones.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base bdd1fd5: 119 file(s) changed, 3516 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=111 notes=44
- checklist: 9/9 done
