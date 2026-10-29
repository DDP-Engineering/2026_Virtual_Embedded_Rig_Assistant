# TASK-5b907d0b - Make workbench session disclosure visibly actionable

stage: done
type: fix
path: quick
interaction: autopilot
requirements: REQ-UX-44db3c60
parent:
branch: master
base: bfaef7fc08f7be4d079df3b97d5e2b0df705fbf5
opened: 2026-10-29

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

Problem: STATED user cannot readily recognize the tiny workbench triangle as a session expand/collapse button; attached screenshot confirms small glyph.
Desired outcome: existing group disclosure is visibly actionable, with clear chevron direction and translated tooltip while preserving workbench-name navigation.
Actors/scenario: engineer clicks or keyboards workbench disclosure to show/hide sessions.
Examples: collapsed chevron-right / expanded chevron-down, 2rem hit surface.
Counterexamples: workbench name still opens overview; missing/disabled workbench remains disabled; disclosure persists existing state.
In scope: existing disclosure icon/class/title and focused unit/browser assertions.
Out of scope: reasoning-selector implementation, data contracts, grouping logic, historic journals (standing preservation policy).
Constraints: OBSERVED master after validated prior UI commit bfaef7f, pinned Lucide library, existing translated projects.expand/collapse strings; STATED local commits/autopilot authorized by AGENTS.
Success signals: native SVG chevron in distinct keyboard-focusable button; localized title/aria label; stable aria-controls/expanded; existing toggle/name actions unchanged.
Evidence: OBSERVED workbench-navigation.tsx renders tiny text glyph, generic 0.3rem padding; user screenshot and explicit request.
Assumptions/unknowns: no new semantics, data, dependencies, filters or reasoning policy.
Decision-blocking questions: none.
Proposed behaviors: existing behavior retained, clearer affordance requested by user.
Path and reason:
| Criterion | Holds? | Evidence |
| no new externally observable behavior | yes | existing toggle only presentation |
| no new interface/data format | yes | same props/state/aria |
| no new dependency | yes | existing Lucide |
| existing requirement covers behavior | yes | REQ-UX-44db3c60 expandable groups |
| no security/data handling change | yes | same guards and storage |
Quick path restores existing navigation discoverability.

## Requirement coverage

REQ-UX-44db3c60 -> existing disclosure + distinct button/chevron/translated tooltip -> focused workspace and browser workbench-navigation acceptance.

## Design

Quick path; bounded presentation correction, no new interface or dependency. Keep existing state/action implementation.

## Log

- 2026-10-29 frame: journal opened
- 2026-10-29 frame: User requested stronger session-toggle affordance. Existing UX expandable-group requirement applies. Autopilot/local commit authorized under repository AGENTS; previous session workspace/date task delivered as bfaef7f. Reasoning-level question answered from local provider/model code; per-session selector not included in this UI fix.
- 2026-10-29 frame: completed; next build
- 2026-10-29 build: Red: focused workbench disclosure test exit1 because no explicit icon-button class/tooltip exists. Existing group remains expandable but tiny text triangle lacks actionable affordance.
- 2026-10-29 build: Green: focused disclosure test passed1 (SVG button, title/aria expanded/collapsed, controlled panel hidden and retained workbench-name action). Added2rem hit target, border/background, strong Lucide chevron and hover. Existing labels supply en/ro/de tooltip. No runtime/data behavior change.
- 2026-10-29 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-29 validate: Final proof: focused component1 passed; complete browser workbench navigation1 passed (including28px target, SVG and keyboard), existing pin/editor/plugins intact. Headless screenshot inspected at1280x800: distinct bordered28px control, clear chevron, aligned workbench name; evidence Temp/vera-workbench-disclosure-5b907d0b.png. No desktop input used. check --strict --run exit0: lint0,typecheck0,i18n0;24 historical advisories retained. Both independent reviews approved round1. Focused Windows/Chromium coverage; prior Ubuntu environment limitation unchanged. Historical journals/optional-companions.md excluded.
- 2026-10-29 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-5b907d0b.md
changed: Clear workbench sessions chevron button and localized tooltip
evidence: Component1 +browser navigation1 passed; visual inspected; lint,typecheck,i18n,strict exit0; both reviews approved
issues: 24 pre-existing advisories preserved; Ubuntu not exercised
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-10-29)

- stage: validate; type: fix; path: quick; branch: master
- requirements:
  - REQ-UX-44db3c60 - When navigating VERA, the application shall provide New/Open Work
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base bfaef7f: 7 file(s) changed, 380 line(s) added
- checks: errors=0 warnings=24 notes=3
- checklist: 9/9 done
