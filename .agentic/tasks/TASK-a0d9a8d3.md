<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-a0d9a8d3 - Single workbench edit entry

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-UX-57299a1a, REQ-UX-1d6c940b
parent:
branch: master
base: 1529117599e3d2a1a41348b756f74cd985cfc798
opened: 2026-10-29

## Done checklist (current stage)

- [x] single overview Edit; Instructions and Skills in editor
- [x] contextual Settings navigation and Back
- [x] real visual user-flow inspection completed
- [x] focused regressions and final static/strict proof
- [x] both independent final reviews
- [x] deliver uncommitted candidate

## Frame

Problem: STATED duplicate overview actions for Skills and WORKBENCH.md.
Desired outcome: overview has one Edit action; tools/skills and instructions belong to project editor.
Actors: local user.
Primary scenario: overview -> Edit -> Instructions or Tools/skills -> save/manage.
Examples: edit WORKBENCH.md through existing instructions draft; manage skill bodies in the skills manager inside editor.
Counterexamples: Save in project editor must not undo live skill enable/disable changes; read-only inspection remains possible.
In scope: single overview toolbar, editor integration, Close moved to sidebar menu, contextual Settings navigation, localization, visual user-flow testing and affected acceptance tests.
Out of scope: new backend/schema behavior, commits, push, historical journal edits.
Constraints: carry AEGIS autopilot; preserve preceding uncommitted candidate.
Success signals: exactly one Edit toolbar button; instructions save/reopen; skills manager accessible inside editor and skill toggles persist through project Save.
Evidence: STATED current user; OBSERVED components/workbench.tsx, workbench-editor.tsx and skills.tsx.
Assumptions: Close remains available in the workbench sidebar menu.
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: project Save handles instructions; skills manager retains its existing explicit save/live-toggle semantics with a clear note.
Path and reason: full for changed UI entry paths. Shared master retained; user prohibits commit/push.

## Requirement coverage

Single Edit entry / editor integration -> REQ-UX-57299a1a -> browser and native workbench/skills tests.

## Design

Remove duplicate overview actions and obsolete PinnedEditor. Reuse current project editor Instructions textarea, add existing SkillSettings launcher within Tools section. Remove the duplicate disabled-skills textarea and omit skills from project Save so current skill toggle configuration is preserved by merge. Skill edits save independently and are labelled as such. Close workbench moves to active sidebar menu. Preserve focused loading, readonly context, oversized warning and retry for instructions.

## Log

- 2026-10-29 frame/specify/design: explicit user scope accepted, carried autopilot, no commit/push. Full path selected.

- 2026-10-29 build: red browser assertion demonstrated four toolbar buttons instead of one. Focused browser scenario now passes including Skills create/toggle/Save preservation, nested Escape and Settings primary-navigation hiding/Back.
- 2026-10-29 scope: user additionally requests hiding New/Open in Settings and real visual app testing. Implemented contextual navigation with Back.
- 2026-10-29 validate: CUA tested the actual running VERA Test1 profile read-only: overview, Edit, Instructions content, Tools/skills, Skills popup, Escape, Settings and Back. Found and fixed top-left dialog placement and nested Escape propagation; visually reverified. No user content or settings were saved.

- 2026-10-29 validate/build: independent spec review approved; quality review identified readonly Instructions focus blocked by disabled fieldset and absent visible loading status. Corrected both; native readonly regression now asserts enabled/focused readonly content and disabled Save. Updated obsolete save hooks in immediate E2E consumers. Workspace/shell units passed (22); i18n passed.

- 2026-10-29 validate: anchor created for the current final candidate; it is not an implementation-start snapshot. Semantic review uses the recorded base commit and complete uncommitted diff, including preceding validated tasks. Evolution from this late anchor cannot attribute the earlier edits to this task.

- 2026-10-29 validate: native workbench lifecycle/readonly (3) and native/browser Skills (2) passed. Mock stale-read acceptance harness now explicitly blocks reopening reads and releases all StrictMode mount requests, retaining the fresh-content/unsaved-draft invariant. Independent final reviews round 2: spec_compliance approved; implementation_quality approved.

- 2026-10-29 validate: focused mock browser acceptance passed after replacing an incomplete metadata-error stub with the complete bridge and the intended getAppInfo failure. Strict translated-error assertions retained. Workbench-navigation passed. Both final reviews round 3 approved.

- 2026-10-29 validate: final strict --run exited 0; lint/typecheck/i18n passed; zero errors, 37 inherited advisory warnings (historical records/requirements and preceding validated uncommitted source outside this requirement). Focused proof: 22 workspace/shell units, native workbench 3, native/browser Skills 2, mock 1, navigation 1; no full suite required under repository verification policy. Context/project and environment routing remain accurate. Both reviews approved round 3.
- 2026-10-29 DEVIATION validate: late anchor snapshots final candidate only; complete diff against recorded base supplies review scope, without claiming task-specific initial attribution.
- 2026-10-29 deliver: agreed outcome is the validated uncommitted working tree and running development app. Explicit user no-commit/no-push overrides default delivery publication. No publication approval needed for this authorized local outcome.

- 2026-10-29 validate: final real-window pass observed the loading label referred to application information while the editor was reading instructions. Replaced it with a dedicated en/ro/de instructions-loading label; returning to validation for this concrete visual finding.

- 2026-10-29 deliver: dedicated loading-label change approved by both reviewers round 4. Final strict --run exited 0 with lint/typecheck/i18n passed; functional proof reused for the text-only correction. Actual VERA restarted normally and visually rechecked Settings hiding/Back, overview one Edit, centered editor and Instructions content; escaped without saving user content. Dev session remains running. Agreed uncommitted outcome delivered; no staging/commit/push and historical journals unchanged.

## Rulings


## Handoff


current: done
status: ready
next: inspect running VERA
must_read: 05_Software/README.md
blockers: none

## Stage report


stage: deliver
result: completed
current: done
changed: unified editor and contextual Settings navigation
evidence: 7 focused E2E, 22 units, real visual flows, strict static proof
issues: late anchor; inherited advisories, zero errors
next: inspect running VERA
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-10-29)

- stage: done; type: change; path: full; branch: master
- requirements:
  - REQ-UX-57299a1a - Single workbench settings entry
  - REQ-UX-1d6c940b - Edit pinned context through project Instructions
- deviations: 1 recorded
  - validate: late anchor snapshots final candidate only; complete diff against recorded base supplies review scope, without claiming task-specific initial attribution.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 1529117: 58 file(s) changed, 2532 line(s) added
- checks: errors=0 warnings=37 notes=3
- checklist: 6/6 done
