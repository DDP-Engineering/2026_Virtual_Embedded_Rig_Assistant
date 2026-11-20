# TASK-8dc13a53 - Accept line citations inside an issued line window

stage: done
type: change
interaction: autopilot
requirements: REQ-FUNC-2e1261c2
parent:
branch: master
base: bb1f1f033001fe4ceedeba6ab08f96d81617818a
opened: 2026-11-20

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: OBSERVED (user screenshot, 2026-11-20): in a Desktop chat, chips such as `runtime.ts L188-213` and
`context.ts L93-126` show the warning icon and do nothing when clicked. OBSERVED `core/src/agent/citations.ts:75`:
a citation is valid only when a successful tool result issued that exact ref string. OBSERVED
`core/src/tools/read.ts:26-29`: `read` issues one ref for the whole window it returned (`path#L<offset>-L<last>`).
INFERRED: the model read a larger window and cited the lines it used, so the narrower ref matched nothing and the
renderer drew an inert invalid chip (`renderer/components/session/markdown.tsx:56-68`).
Desired outcome: A line citation whose lines lie inside a line window that a successful tool result issued for the
same file is valid, opens like an issued citation, and is still refused when invented, out of range, outside the
workbench, binary or missing.
Actors: The engineer reading an assistant reply and clicking its citation chips. The session engine (desktop and
CLI) checking citations after each assistant message and again when a citation is opened.
Primary scenario: The agent reads `runtime.ts` lines 1-400, answers citing `[[runtime.ts#L188-L213]]`; the chip is
valid and opens runtime.ts at line 188.
Examples: STATED (user, 2026-11-20): "cand dau click pe trimiterile runtime.ts sau context.ts - nu mi se deschide
tab ... In mod normal ar fi trebuit ca user-ul sa poata sa deschida fisierul". Issued `board.txt#L1-L2`: cited
`board.txt#L2-L2` is valid.
Counterexamples: Issued `a.txt#L1-L10`: cited `a.txt#L5-L12` (extends past the window) and `b.txt#L5-L6` (other
file) stay invalid. Page, heading, artifact and help refs keep exact matching.
In scope: Containment for line refs in `validateCitations` and in `SessionService.openCitation` (log provenance for
the UTF8 control-byte read). The line-citation requirement and its tests.
Out of scope: Changing the agent prompt or how tools issue refs (INFERRED: containment fixes the user-visible defect
without them). Non-line citation kinds (OBSERVED: their bounds are checked against indexed extraction, not windows).
Making invalid chips clickable (INFERRED: invalid chips stay inert by REQ-UX-4bea0002 design).
Constraints: On `master`, the default branch, after commits c3a835ef and bb1f1f03. Pre-release: no compatibility
code. The file must still exist, be confined and text, and have the cited lines at check time.
Success signals: Focused citations tests show a sub-range of an issued window valid and the counterexamples invalid;
a session test opens a sub-range citation; typecheck and lint pass.
Evidence: OBSERVED files above; `.agentic/requirements/functional/REQ-FUNC-2e1261c2.toml` ("valid only when it came
from a successful tool result"); `citations.test.ts:84-120` asserts an unissued `board.txt#L2-L2` invalid.
Assumptions: none.
Unknowns: none blocking.
Decision-blocking questions: none. STATED (user, 2026-11-20): accepted the proposal "a lines citation is valid when
it lies inside an issued lines ref for the same file" with "Da, fa-l aici".
Proposed behaviors (not accepted): none beyond the accepted proposal.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| A line ref inside an issued line window of the same file is valid at message end and on open; other refs keep their rules | REQ-FUNC-2e1261c2 (revised) | containment helper in citations.ts used by validateCitations and openCitation |

## Design

**Approach.** Add an exported `withinIssued(ref, issued)` in `core/src/agent/citations.ts`: true when `issued`
holds `ref`, or when `ref` parses as a line ref and some issued ref parses as a line ref of the same canonical
path with `start <= ref.start` and `ref.end <= end`. `validateCitations` uses it for provenance and for the
parse_log UTF8 flag; `SessionService.openCitation` uses it for the same flag. Every other check stays: the file
is read through PathGuard and must have `ref.end` lines. Rejected: changing the prompt or making `read` issue
per-line refs, because models already narrow ranges and per-line refs would flood the tool results.

**Interfaces and data.** `withinIssued(ref: string, issued: ReadonlySet<string>): boolean`, pure, no I/O.
Paths compare as the parsed ref paths (both come from `formatLineRef`/`parseRef`, so equal strings mean the same
file). Non-line refs keep exact matching. No stored data or event format changes.

**Files and test seams.** `core/src/agent/citations.ts` (helper and use), `core/src/sessions/service.ts`
(`openCitation` log flag). Tests: `agent/citations.test.ts` (sub-range valid; other file, extending, unissued
invalid; parse_log sub-range keeps the UTF8 read), `sessions/service.test.ts` or the existing citation open test
(a sub-range citation opens).

**Risks and open decisions.** A model may cite a sub-range of a large window that does not support its claim;
the issued window still proves the lines were read, which is the guarantee the check gives today.

**Requirement map.** REQ-FUNC-2e1261c2: `withinIssued` in validateCitations and openCitation.


## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify - scope accepted by user (7 Done checklist item(s) left unticked)
- 2026-11-20 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-20 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-20 build: red: vitest run core/agent/citations.test.ts exit 1 - sub-ranges board.txt#L2-L2, a.txt#L5-L6, a.txt#L10-L10 and parse_log log.txt#L2-L2 invalid; vitest service.test.ts -t 'cited line range' exit 1 - board.txt#L2-L2 invalid (REQ-FUNC-2e1261c2)
- 2026-11-20 build: green: vitest run citations.test.ts service.test.ts search.test.ts exit 0, 61 passed; vitest run core/src exit 1 - 1690 passed, 1 failed: workbench pinned-save closing, which also fails on HEAD (TASK-e5612dfd log); npm run typecheck exit 0; biome: 2 older findings only (REQ-FUNC-2e1261c2)
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: spec and quality review round 1 approved; quality notes: O(citations x issued) parse cost acceptable vs readWindow; spec notes: verification text named the wrong test for other-file/extending, openCitation log flag has no direct test, paths compare as strings
- 2026-11-20 validate: DEVIATION validate: REQ-FUNC-2e1261c2 verification text corrected after the round-1 approval to name the a.txt window test, per the spec reviewer's note - text only, no code or test change
- 2026-11-20 validate: knowledge sessions.md updated (withinIssued containment, no snippet for a contained sub-range); project/environment context have no citation-provenance claims; requirement re-read matches the build
- 2026-11-20 validate: final: python .agentic/aegis.py check --task TASK-8dc13a53 --strict --run exit 0; ran lint, typecheck, i18n, help (test not in [check] run); then vitest core agent+sessions+knowledge exit 0, 472 passed 2 skipped; 27 warnings are older journals and ticket refs, none from this task; e2e citations.spec not rerun - reviewer confirmed fixture outcomes unchanged
- 2026-11-20 validate: DEVIATION validate: strict check --run does not run tests in this repo's [check] config - covered by focused vitest after the last edit; e2e not rerun
- 2026-11-20 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-8dc13a53.md
changed: 0 created, 1 revised
evidence: aegis check --task TASK-8dc13a53 --strict --run exit 0; vitest core agent/sessions/knowledge 472 passed
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-20)

- stage: validate; type: change; branch: master
- requirements:
  - REQ-FUNC-2e1261c2 - Check line citations from tool results
- deviations: 2 recorded
  - validate: REQ-FUNC-2e1261c2 verification text corrected after the round-1 approval to name the a.txt window test, per the spec reviewer's note - text only, no code or test change
  - validate: strict check --run does not run tests in this repo's [check] config - covered by focused vitest after the last edit; e2e not rerun
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base bb1f1f0: 9 file(s) changed, 300 line(s) added
- checks: errors=0 warnings=27 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
