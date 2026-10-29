<!--
Copyright (c) 2026 DDP Engineering
This software is licensed under the PolyForm Noncommercial License 1.0.0.
Commercial use requires a separate commercial license.
See the LICENSE.txt in the .agentic folder for full license details.
SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
-->


# TASK-8bc2b436 - Workbench navigation registry and project editor

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-44db3c60, REQ-FUNC-0c165902, REQ-FUNC-bf4bad89, REQ-UX-e36a4ca6, REQ-FUNC-deb7eac8, REQ-DATA-dfbfac7c, REQ-FUNC-e78b18ad
parent:
branch: master
base: 1529117599e3d2a1a41348b756f74cd985cfc798
opened: 2026-10-28

## Done checklist (current stage)

- [x] Reproduce missing behavior with tests.
- [x] Implement and validate requirements.
- [x] Update current documentation.
- [x] Complete two independent reviews and strict proof.
- [x] Deliver the validated working tree without staging, commit or push.

## Frame

Problem: STATED workbench navigation needs a project/session hierarchy and project settings.
Desired outcome: STATED New/Open Workbench, Plugins, persistent pin/unpin, grouped collapsible sessions, editor and Explorer.
Actors: local desktop user.
Primary scenario: choose a workbench -> open its overview or session -> edit settings without mixing session ownership.
Examples: ESP32 and STM32 workbenches, each with diagnostic conversations.
Counterexamples: removing a sidebar entry never deletes project files; plugin placeholders never execute unimplemented commands.
In scope: registry, grouped navigation, project editor over implemented config, Plugins landing page, localization, native Explorer, focused tests.
Out of scope: plugin runtime/authoring and vendor integrations; migration/backward compatibility; commits or push. Per-workbench chunking/overlap controls and automatic index rebuilding are included; multiple independent roots are excluded by explicit user response.
Constraints: STATED autopilot; no commit/push. OBSERVED shared master checkout and current .vera ownership, one active backend workbench.
Success signals: persistent pin/order; New available while another bench is active; scoped session switching; editable project config; translated dialog and navigation.
Evidence: OBSERVED renderer/App.tsx, components/workbench.tsx, core/workbench/service.ts and shared/workbench.ts under 05_Software/src.
Assumptions: installing/executing plugins remains future; current project settings are editable while engine extensions are separate unless user requests them.
Unknowns: none blocking. Current installed BGE is the supported embedding model; adding remote/other models is future work.
Decision-blocking questions: none for navigation and current editor.
Proposed behaviors: stable actions, expandable registry, menu actions, large centered tabbed editor, honest Plugins availability.
Path and reason: full. New behavior/interface/data fields: yes; existing requirement equivalent: no; no new dependency: yes; security boundary Explorer: changed. Independent child implementation is unnecessary; two independent validation reviews required by AEGIS.

## Requirement coverage

Navigation/groups -> REQ-UX-44db3c60 -> browser session switching/collapse.
Registry/pins -> REQ-FUNC-0c165902 -> core persistence/no ten-entry eviction.
Editor -> REQ-FUNC-bf4bad89 -> core config and browser save/cancel/read-only.
Plugins -> REQ-UX-e36a4ca6 -> browser localized section with no fake install actions.

Embeddings engine -> REQ-FUNC-deb7eac8 -> ingest rebuild and chunk boundaries/progress.

## Design

Keep one active backend workbench; expansion opens the selected workbench and the existing SessionList is nested under its active entry. Previously loaded session lists may be cached but never executed under another workbench. Global registry remains in settings.recentWorkbenches with optional pinned metadata and no automatic ten-entry eviction. Pin/order is app preference; workbench config stays in .vera. A registry-aware reveal option uses workbench.recent without changing active workbench. Editor loads current config and saves through existing strict APIs, with identity checked before save. Source selection uses existing project-relative includes/excludes; embeddings expose supported local model and mutable character chunk/overlap controls; index fingerprint invalidates derived content when settings change. Plugins page explicitly describes future availability. Main routes add no unrestricted filesystem reveal. No old journals changed.

### Architecture

Shell -> App navigation -> registry/current WorkbenchService -> .vera config/session SQLite.
Project editor -> existing config.update/pinned.update; registry pin/reveal -> settings/native Explorer.

## Log

- 2026-10-28 frame: full path accepted in explicit autopilot; master retained per repository policy; user prohibits commits and pushes.
- 2026-10-28 specify: four requirements cover navigation, registry, editor and plugin section.
- 2026-10-28 design: preserve single active backend lifecycle; extend app registry, not project metadata for pinning.

- 2026-10-28 build: red registry pin test reproduced missing persistent pin; original returned undefined.
- 2026-10-28 design: user explicitly includes embeddings and declines multiple independent roots. Implement character chunk/overlap settings with current installed model, not arbitrary unsupported models.

- 2026-10-28 build: 101 focused tests initially passed; PDF thread startup exceeded default 5s, rerun 16 processor tests with 20s deadline passed. Further 66 focused tests passed, one platform skip; 3 native workbench create/restart/readonly tests passed.
- 2026-10-28 validate: independent initial specification and quality reviews requested corrections to multiline drafts, view restoration, scoped session polling, overlap and partial-save reporting. Corrections implemented; final reviews pending.

- 2026-10-28 validate: updated current registry/extraction requirements and shared spec to match explicitly authorized retention and character-overlap behavior; historical journals remain unchanged. Anchor captured final candidate; complete original candidate reviewed with git diff against recorded base 1529117.
- 2026-10-28 validate: browser two-workbench and multiline test passed; legacy workspace tests updated to new navigation and passed with embedding-ingest (23 tests). Shell and scoped IPC/preload/event tests passed; strict static run passed with pre-existing historical warnings.

- 2026-10-28 validate: independent spec_review and quality_review approved current source/test/contracts in round 4. Original review corrections are resolved. Final source unchanged since passing focused proof.

- 2026-10-28 validate: final check --task TASK-8bc2b436 --strict --run exited 0; lint, typecheck and i18n passed; strict ok with 25 pre-existing historical warnings and zero errors. Focused tests were run separately under verification-policy.md; no full-suite substitution.
- 2026-10-28 deliver: requested outcome is the validated uncommitted candidate. HEAD remains 1529117; no staging/commit/push. VERA restarted in normal development mode on 127.0.0.1:5173. Existing journals and unrelated 00_Planning/optional-companions.md were untouched.

## Rulings


## Handoff

current: done
status: ready
next: user inspection in the running development application
must_read: 05_Software/README.md
blockers: none

## Stage report

stage: deliver
result: completed
current: done
changed: navigation, workbench editor, Plugins, embeddings
evidence: focused tests, native/browser acceptance and strict checks passed
issues: 25 pre-existing historical warnings
next: user inspection; no commit or push
needs_user: no
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-10-28)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-44db3c60 - When navigating VERA, the application shall provide New/Open Work
  - REQ-FUNC-0c165902 - When a registered workbench is pinned or unpinned, VERA shall per
  - REQ-FUNC-bf4bad89 - When editing a workbench, VERA shall present a centered project s
  - REQ-UX-e36a4ca6 - When opening Plugins, VERA shall present a localized library sect
  - REQ-FUNC-deb7eac8 - Per-workbench embedding chunk policy
  - REQ-DATA-dfbfac7c - Persist registered workbenches
  - REQ-FUNC-e78b18ad - Document extraction and precise chunks
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 1529117: 38 file(s) changed, 1755 line(s) added
- checks: errors=0 warnings=25 notes=3
- checklist: 3/4 done; open: Complete two independent reviews and strict proof.

## Delivery report (2026-10-28)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-44db3c60 - When navigating VERA, the application shall provide New/Open Work
  - REQ-FUNC-0c165902 - When a registered workbench is pinned or unpinned, VERA shall per
  - REQ-FUNC-bf4bad89 - When editing a workbench, VERA shall present a centered project s
  - REQ-UX-e36a4ca6 - When opening Plugins, VERA shall present a localized library sect
  - REQ-FUNC-deb7eac8 - Per-workbench embedding chunk policy
  - REQ-DATA-dfbfac7c - Persist registered workbenches
  - REQ-FUNC-e78b18ad - Document extraction and precise chunks
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 1529117: 38 file(s) changed, 1775 line(s) added
- checks: errors=0 warnings=25 notes=3
- checklist: 5/5 done
