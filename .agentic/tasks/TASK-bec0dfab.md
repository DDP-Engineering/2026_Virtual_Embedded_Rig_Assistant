<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-bec0dfab - Fix native ESM loading of the demo inventory and Playwright discovery

stage: done
type: fix
path: quick
interaction: autopilot
requirements: REQ-FUNC-66b6fda6
parent:
branch: master
base: 891a699b934bd9b20af441f06a13834c69aec5c1
opened: 2026-10-23

## Done checklist (current stage)

- [x] Frame, native failing import, anchor and minimal correction recorded
- [x] Focused demo tests and complete Playwright discovery pass
- [x] Current requirement paths and component invariant reconciled
- [x] Review complete current candidate against specification and implementation quality
- [x] Strict/static proof and delivery evidence recorded

## Frame

Problem: OBSERVED compiled @vera/shared cannot load in native Node ESM because demo.ts imports JSON without its type attribute.
Desired outcome: STATED fix demo.json import and list every Playwright test in tests_e2e.
Actors: Developer; Node ESM loader; Playwright discovery.
Primary scenario: Import @vera/shared -> load demo inventory -> Playwright collects all test files.
Examples: Native import currently exits 1 with ERR_IMPORT_ATTRIBUTE_MISSING.
Counterexamples: Browser-only selected test discovery already succeeds; it does not prove native shared import.
In scope: Shared JSON import attribute, regenerated ignored output, focused checks and task records.
Out of scope: Running the complete e2e suite, real providers, demo behavioral redesign, publication, unrelated untracked planning document.
Constraints: master; preserve earlier authorized tests_e2e rename and existing historical journals. Prior rename is part of the complete current candidate for review, not a new implementation in this task.
Success signals: Native ESM import succeeds; full Playwright --list exits 0; focused demo checks and required static checks succeed.
Evidence: STATED user request; OBSERVED shared/src/demo.ts, package exports, pinned Node 24.21.0 and pre-fix native ERR_IMPORT_ATTRIBUTE_MISSING.
Assumptions: Existing ESM target preserves import attributes; verify emitted code.
Unknowns: Native Ubuntu is not available as an established route for this task.
Decision-blocking questions: None.
Proposed behaviors: Explicit JSON module type preserves the existing inventory and export.
Path and reason: quick; no new observable product behavior, interface/data format, dependency or security/data handling; existing REQ-FUNC-66b6fda6 covers the inventory.
Quick-path audit: all five criteria satisfied by the one import-metadata correction and existing requirement.

## Requirement coverage

REQ-FUNC-66b6fda6: preserve demoWorkbench JSON identity/inventory under native ESM.

## Design

Quick path: add standard JSON import attribute; keep asset and public export unchanged.

## Log

- 2026-10-23 frame: User scope accepted in configured autopilot; quick path on master under repository instruction. Existing rename candidate retained; unrelated optional-companions.md excluded. Standing user authorization permits local implementation commits; no remote publication authorized.
- 2026-10-23 build red: REQ-FUNC-66b6fda6; from 05_Software, `python ../02_Tools/npmw.py node --input-type=module -e "await import('@vera/shared'); console.log('Native ESM shared import: OK')"`; exit=1; missing JSON type attribute prevents the intended native ESM demo inventory import. This is the requested import defect, not an incidental test-fixture failure. Earlier complete Playwright listing failed for the same reason.

- 2026-10-23 build green: shared TypeScript build exit=0; native ESM @vera/shared import exit=0; emitted demo.js retains `with { type: "json" }`; complete Playwright --list exit=0, 48 tests in 21 files under tests_e2e; focused shared/demo and main/demo-workbench Vitest exit=0, 5 tests across 2 files. Existing requirement already lists the changed source and focused tests.
- 2026-10-23 build -> validate: no asset/API/dependency changes; requirement date and current component invariant reconciled. Earlier rename remains authorized existing work.

- 2026-10-23 validate review round 1: two separately scoped coordinator review passes, no delegated reviewers. Specification compliance=approved: one import-metadata correction preserves REQ-FUNC-66b6fda6 inventory/API, existing rename remains authorized, historical journals and unrelated planning remain unchanged. Implementation quality=approved: emitted native ESM retains type metadata; native import, all 48-test discovery and 5 focused tests pass; JSON bytes/export unchanged, no dependency/security/platform-specific logic introduced. Compared all 154 prior rename paths to original bytes plus exact path substitutions; source/doc/date diff reviewed separately. Component architecture and project/environment responsibilities remain unchanged.

- 2026-10-23 validate: `python .agentic/aegis.py check --task TASK-bec0dfab --strict --run --json` exit=0; lint/typecheck/i18n exit=0; full tests intentionally excluded by project verification policy. Static lint reports 25 existing warnings and 9 infos. AEGIS 0 errors, 43 warnings, 3 notes: unrelated historical metadata/requirements and prior rename deletion/layout coverage; task-only Handoff status typo corrected to ready afterward. Native Ubuntu and full runtime e2e not executed; discovery and focused Windows proof cover this import-only change. No accepted relevant runtime failure.
- 2026-10-23 deliver: standing AGENTS.md local-commit authorization applies; commit only import correction, demo knowledge invariant, requirement date and this new task journal. Preserve all earlier rename changes and optional-companions.md in the working tree; no push/PR/release. No child tasks.

- 2026-10-23 local delivery: close-out included in the authorized local commit; no remote action. Prior rename candidate and unrelated untracked planning file excluded from commit.

## Rulings


## Handoff


current: done
status: ready
next: None; requested import fix and discovery verified
must_read: 05_Software/packages/shared/src/demo.ts
blockers: none

## Stage report

stage: deliver
result: completed
current: done
changed: JSON ESM import corrected
evidence: Native import OK; Playwright lists 48 tests in 21 files; 5 focused tests pass; strict static checks pass
issues: Existing advisory/lint warnings; full E2E and Ubuntu not run
next: Continue application walkthrough
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-10-23)

- stage: deliver; type: fix; path: quick; branch: master
- requirements:
  - REQ-FUNC-66b6fda6 - Deliver the fictional demo workbench
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 891a699: 181 file(s) changed, 5391 line(s) added
- checks: errors=0 warnings=42 notes=3
- checklist: 5/5 done
