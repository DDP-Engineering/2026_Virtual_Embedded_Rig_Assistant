# TASK-4f522ea5 - PLG-25 #88 Workbench plugin activation and integrated acceptance

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-e07790cb, REQ-UX-840fad9c, REQ-UX-e5d617d7, REQ-UX-69b54580
parent:
branch: ddp/plugins-discovery-ui
base: bbc7a0f757b131f7c7b9df79d7b98111edeb5d3c
opened: 2026-11-11

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



Problem: OBSERVED workbench Plugins is an unfiltered list and Editor actions are footer-only; dirty comparison treats reordered plugin ids as a change.

Desired outcome: STATED PLG-25 and user corrections require current-workbench activation with top Save/Cancel, scalable discovery and passive readiness, preserving existing draft ownership and isolation.

Actors: STATED engineer editing or creating a workbench; read-only observer.

Primary scenario: Select a plugin, filter it out, select another, save the entire draft only for that workbench; reopen/restart restores saved choices.

Examples: STATED no workbench selector/Add button; Save inactive initially and after reverting selection; readonly can browse every page without changing configuration.

Counterexamples: STATED installation does not enable; browsing does not probe programs; filtering does not remove hidden choices; same-id scoped packages do not inherit global trust.

In scope: STATED PLG-25 renderer editor/config form/plugin selection, related translations/styles/tests and final focused integration/planning reconciliation.

Out of scope: STATED no second enablement store/API, no migration/version bump, no trust relaxation, no hardware commands, no full-suite gate; root handles commits/publication.

Constraints: STATED latest user overrides generic master rule: one ddp/plugins-discovery-ui branch from origin/master5aa0234; local ticket commits authorized and coordinator-owned. All stored versions stay1. OBSERVED base bbc7a0f and zero open tasks. Verification policy applies.

Success signals: Top actions, semantic dirty restoration, readonly usable filters, hidden selection preservation, trust/errors retained, explicit setup only, two-workbench/restart native proof and both independent reviews.

Evidence: OBSERVED WorkbenchEditor/WorkbenchConfigForm/WorkbenchPlugins and existing component/native tests; PLG-24 helpers and Query cache retention fixes; ui-redesign.md §2/5–8.

Assumptions: INFERRED reuse the established owner Save(close)/Cancel(close) lifecycle and data schemas.

Unknowns: Native Ubuntu not available in this Windows session; hardware not needed by this UI scope.

Decision-blocking questions: None; accepted plan and latest user instructions settle behavior.

Proposed behaviors: None outside accepted plan.

Path and reason:

| Criterion | Holds? | Evidence |

|---|---|---|

| no new externally observable behavior | no | scalable WB selection/top actions |

| no new interface/data format | yes | existing IPC/config shape |

| no new dependency | yes | existing Query/React helpers |

| existing requirement fully covers behavior | no | new top actions/discovery contracts |

| no security/data-handling change | yes | trust/store policy preserved |

Full path. No independent implementation children; independent review roles only.



## Requirement coverage

| Behavior | Requirement | Design/test |
|---|---|---|
| Draft/isolation/trust | REQ-UX-e07790cb | Existing owner and component/native fixtures |
| Top actions/semantic dirty | REQ-UX-840fad9c | Editor header and set-aware comparison |
| Discovery/readonly/retention | REQ-UX-e5d617d7 | Shared library controls, private per-WB state |
| Passive readiness/explicit configuration | REQ-UX-69b54580 | Disabled observers and explicit checked actions |





## Design

### Approach
Reuse WorkbenchEditor owner (REQ-UX-e07790cb): move its existing action buttons to header; compare enabled sets for dirty state (REQ-UX-840fad9c). WorkbenchPlugins derives visible rows from unchanged enabled prop and never stores selection locally (REQ-UX-e5d617d7).
### Interfaces and data
Reuse PLG-24 LibraryState, filters/sorting/paging and activity labels. A private per-workbench UI key gets gcTime Infinity, no persisted setting; clamp only after installed data and catalog metadata settle (REQ-UX-e5d617d7). Extend reusable controls with optional custom status choices for Enabled/Needs, leaving global defaults unchanged. Disabled program observers read last explicit-check data; a small WB-only configuration disclosure uses existing check/provision/archive channels on explicit actions (REQ-UX-69b54580). Readonly inputs/configuration mutations disabled, presentation filters usable.
### Files and test seams
workbench-editor.tsx, workbench-config-form.tsx, workbench-plugins.tsx, shared library controls optional status override, locales/styles. Component tests cover32 entries, dirty restoration, filtered hidden saves, readonly pages, scopes/trust/error/retry and passive setup. Focused native workbench case covers header ordering, Save/Cancel, twoWB/restart; focused browser proof covers supported display combinations.
Global Plugins detour: App hides/inerts the same WorkbenchEditor, retaining owner config/instructions and ConfigForm section; only plugin presentation unmounts to prevent hidden duplicate controls, restoring its per-WB cached view and fresh data on return. Same-workbench navigation resumes; other departures retain discard guards.
### Risks and open decisions
No new storage/schema/API or trust policy. Existing config/instruction save error and ownership guards remain. Setup only invokes user-requested probes/provisioning; no new automatic program calls. Native Ubuntu unavailable, report limitation; reuse #86/#87 proof for unchanged paths. No open product decision.
### Requirement map
REQ-UX-e07790cb owner draft/trust; REQ-UX-840fad9c header/dirty; REQ-UX-e5d617d7 controls/retention/readonly; REQ-UX-69b54580 passive observations/explicit setup.
Diagrams: [diagram_TASK-4f522ea5.md](diagram_TASK-4f522ea5.md)

## Log



- 2026-11-11 frame: journal opened
- 2026-11-11 frame: completed; next specify - accepted PLG-25 scope recorded in autopilot
- 2026-11-11 specify: completed; next design
- 2026-11-11 design: completed; next build
- 2026-11-11 build: red: pinned workbench-plugins14 cases: missing top/dirty, discovery/paging and explicit configuration tests fail as expected (REQ-UX-840fad9c REQ-UX-e5d617d7 REQ-UX-69b54580); ten existing cases pass
- 2026-11-11 build: green: pinned six-file focused Vitest exit0,122 cases (WorkbenchPlugins16 plus immediate workbench-chat/workspace and unchanged global library/plugins/catalog consumers). New per-workbench private-filter regression subsequently passes17/17; total123 focused cases. Typecheck exit0. Header actions, enabled-set restoration,32-entry hidden selection/readonly paging, trust/unresolved errors, refresh/retry and passive explicit-check failures covered.
- 2026-11-11 build: green: VERA_TEST=1 pinned test:e2e targeted plugins-ui/plugins-mock/chat-detail grep installs.*review screen|workbench plugin draft|chat detail exit0,5 flows. Native imports/review/keyboard Save-state restoration, two-workbench Save/Cancel/restart and dirty-navigation dismissal; Chromium workbench Plugins en/ro/de xlight/dark xall6scales at1024x640 no overflow. Immediate chat native/browser consumers pass. First non-instrumented native command timed out at disabled folder/name; corrected build settles the setup issue. Native explicit workbench check extension separately running. No real hardware/network/model spend.
- 2026-11-11 build: DEVIATION validate: no native Ubuntu execution in this Windows session - renderer-only scope uses pinned Windows Electron/Chromium focused proof; backend contracts unchanged and verification-policy forbids an extra full-suite gate. Reuse validated#86a67012a/#87bbc7a0f proof for unchanged paths.
- 2026-11-11 build: Inspection: candidate diff reviewed against accepted scope and design, source/trust boundaries, pending/mount/error/partial-save owner guards and readonly controls. Knowledge plugins/workbench and project/environment reconciled; plan/spec/overview outcomes now distinguish #86a67012a/#87bbc7a0f from coordinator-pending #88 candidate. All new requirements active with focused links; evolution22files reviewed with no unrelated changes.
- 2026-11-11 build: Inspection: native explicit-check extension initially expected Ready but the deliberate find-only fixture has no VERA_TEST_NODE environment entry. Correct expected observation is Needs configuration/missing with provisioning disabled; component tests separately prove Ready then failed recheck becomes Unavailable. Test corrected to assert real vendor-managed setup rather than injecting an executable.
- 2026-11-11 build: green: final workbench explicit dependency native extension npx playwright test plugins-ui.spec.ts -g workbench plugin draft exit0,1/1, real Missing/Needs plus find-only provision disabled, selection and Save still inactive until checkbox edit, then Cancel/twoWB/restart/dirty guard. All five focused integrated flows remain green. Latest formatted component proof17/17 exit0 (vitest-wb.log); total123 with five unchanged files from combined122case run. Advisory strict has0errors/48existingwarnings/20notes; no uncovered current paths; git diff --check clean. Evolution reviewed.
- 2026-11-11 build: completed; next validate
- 2026-11-11 validate: Review round1: quality APPROVED; spec CHANGES_REQUIRED: spec6 global Plugins install detour must preserve still-valid owner draft, but App.showPlugins discarded/unmounted it. Fix existing App navigation/mount ownership, preserve same-WB return, retain guards for true departures; add real-navigation draft+install acceptance. No product ambiguity: explicit accepted requirement.
- 2026-11-11 validate: returned to build - Spec review: global Plugins detour currently discards owner draft; preserve mounted owner and prove roundtrip after install
- 2026-11-11 build: red: new actual App global-Plugins detour component regression failed before fix (detour-red.log): guard prevented Plugins page. green after preserving same hidden/inert editor owner: targeted4 navigation cases and strengthened real install roundtrip1/1 pass. No second draft store; plugin presentation alone unmounts to avoid duplicate hidden library controls; same section/privatefilters restore, hidden selection/name preserved; true departure guards unchanged. Coordinator explicitly confirmed fix within accepted section6 scope.
- 2026-11-11 build: green: round1 fix focused consumers Vitest74/74 exit0 (WorkbenchPlugins17, workbench-chat6, App workspace51) plus final exact-App guard four-case navigation rerun4/4; unchanged global library/plugins/catalog50 cases reuse initial proof =>124 focused cases. e2e-detour.log5/5 Windows/Chromium flows includes actual global folder review/install then same-owner return with hidden selection, name, instructions and plugin section intact; no config writes or auto-enable, dirty Settings departure still guarded. Final exact guard build/native rerun pending. Knowledge renderer-foundation also reconciled; evolution23non-agentic files reviewed.
- 2026-11-11 build: completed; next validate
- 2026-11-11 validate: Review round2: independent spec and quality both APPROVED on complete current candidate, including owner-preserving install detour and real navigation/install assertions. Exact-final-guard native build/run e2e-detour-final.log exit0,1/1: hidden/inert owner, single global search, explicit setup, folder review/install, restored hidden choice/name/instructions/section/filter without writes; real departure guard and twoWB/restart. No product/test/doc edits remain; focused124 cases and5 integration flows proven, nativeUbuntu limitation retained.
- 2026-11-11 validate: final attempt: check --strict --run exit1 after round2 approvals; lint exit0 4.0s, typecheck exit0 9.0s, i18n exit1 unregistered dynamic translation call. New WB tier interpolation is the introduced cause; replace with explicit existing tier keys, rerun affected17component cases/i18n and both reviews before fresh final proof. Baseline48warnings unchanged.
- 2026-11-11 validate: returned to build - Final i18n check rejects new dynamic tier label; use explicit existing keys with unchanged translations
- 2026-11-11 build: green: tier-label static correction uses the same four existing translation keys via an explicit map. Targeted Biome exit0, check:i18n exit0 (English usage +en/ro/de complete), WorkbenchPlugins17/17 exit0 (vitest-tier.log). All124 focused cases/5 integrated flows unchanged behavior/layout; reuse native/display proof. No other product/test/doc edit.
- 2026-11-11 build: completed; next validate
- 2026-11-11 validate: Review round3: both independent roles APPROVED exact current candidate after explicit tier-label correction; complete round2 scope approval retained, no additional findings. Current failed-proof and correction evidence retained in strict-final.log/vitest-tier.log. Proceed to fresh final proof with no candidate edits afterward.
- 2026-11-11 validate: final: python .agentic/aegis.py check --task TASK-4f522ea5 --strict --run exit0 after both round3 approvals and last candidate edit; lint4.1s/typecheck3.4s/i18n1.2s all0. Complete suites skipped per verification-policy;124 focused component cases and5 Windows native/Chromium flows proven, final exact detour native1/1. errors0/warnings48/notes20: unchanged stale historical requirement paths, unlinked tests, ticket heuristics and older journal headers; no current-task uncovered paths or review findings. Native Ubuntu unavailable (recorded deviation); no real hardware/network/model spend. Finalpass log strict-final-pass.log retained, failed earlier i18n proof retained separately. Owned E2E profiles/output cleaned by existing finally/reporter; useful logs only under task cache. No product/test/doc edits after proof.
- 2026-11-11 validate: completed; next done



## Rulings

- RULING-001 | date=2026-11-11 | decision=Implement #88 on single ddp/plugins-discovery-ui branch; coordinator makes authorized local ticket commit | reason=Latest explicit user instruction overrides generic master rule; base bbc7a0f follows validated #86 and #87 | source=user | supersedes=none





## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-4f522ea5.md
changed: Owner-draft/filter/readiness design and three diagrams recorded
evidence: Final strict--run exit0;124focused cases/5E2E flows incl exactnative install detour passed; both independent reviews APPROVED round3; validate checklist9/9 and report complete
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-11)

- stage: validate; type: feature; path: full; branch: ddp/plugins-discovery-ui
- requirements:
  - REQ-UX-e07790cb - Select plugins in the workbench configuration
  - REQ-UX-840fad9c - Place workbench draft actions before configuration
  - REQ-UX-e5d617d7 - Filter workbench plugins without losing draft selection
  - REQ-UX-69b54580 - Observe and explicitly configure workbench plugin readiness
- deviations: 1 recorded
  - validate: no native Ubuntu execution in this Windows session - renderer-only scope uses pinned Windows Electron/Chromium focused proof; backend contracts unchanged and verification-policy forbids an extra full-suite gate. Reuse validated#86a67012a/#87bbc7a0f proof for unchanged paths.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base bbc7a0f: 33 file(s) changed, 927 line(s) added
- checks: errors=0 warnings=48 notes=20
- checklist: 9/9 done
