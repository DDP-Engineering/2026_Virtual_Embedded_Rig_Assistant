# TASK-5fda967d - Stabilize plugin dependencies and reorganize plugin management

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-PLAT-2ab2eb65, REQ-REL-21eeae69, REQ-FUNC-ed2e8564, REQ-SEC-7a5afebb, REQ-REL-22ef3dca, REQ-UX-27a41e3d, REQ-UX-35b1e6b5, REQ-NFR-2b7fe7ab
parent:
branch: master
base: d377c699eb4b0636aac620be204d01984624d0d2
opened: 2026-11-05

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

Problem: STATED: the engineer observed intermittent unresponsive navigation and failing plugin dependency installs. OBSERVED: the live Windows audit confirmed a broken uv managed-Python minor junction, omission of PATHEXT from the process environment, dependency cache not invalidated by Refresh plugins, unreachable sigrok hosted delivery, and a long fully expanded installed/catalog page. Initial isolated package listing took 7603ms; warm listing 997ms. UNKNOWN: the exact cause of the reported tens-of-seconds freeze and late chat display; it was not reproduced.
Desired outcome: STATED: resolve the confirmed problems and implement the accepted plugin-page organization; validate in the real application with AEGIS and subsessions and make one local commit without remote publication.
Actors: STATED: embedded engineer managing global plugin packages and selecting plugin enablement separately per workbench.
Primary scenario: STATED: open Plugins, see compact installed rows and grouped global actions, expand a package, explicitly check/install its dependencies with actionable progress/errors, and select enabled packages in the workbench editor.
Examples: OBSERVED: eim run idf.py --version returns SDK5.5.2; exact production probe fails with the minimal environment and succeeds when only PATHEXT is added. Serial/esptool/efuse installs failed at the minor alias until its removal. Sigrok0.8.0 works from the manifest-SHA-verified local Windows archive while its HTTPS URL timed out. UI Refresh leaves program inspection caches intact.
Counterexamples: STATED: installing a package does not enable it in a workbench. Existing hardware acceptance and remote hosting publication are not established by a successful software installation.
In scope: STATED: confirmed provisioning/recheck/Windows-environment defects, actionable offline delivery for the verified local archive, grouped top management/catalog actions, compact expandable installed rows, stable dependency-action states, clear external SDK handling, per-workbench selection preserved; observed expensive plugin/session paths and responsive loading during these operations. Tests, immediate-consumer regressions, knowledge and requirements belong to this task.
Out of scope: STATED: new plugins, remote push/code/assets/releases, hardware flash/burn/reset/instrument output. Root AGENTS.md excludes migrations and old-format compatibility. INFERRED: unrelated visual polish and refactoring do not serve this request.
Constraints: STATED: shared master checkout, recorded base d377c699eb4b0636aac620be204d01984624d0d2 and entire uncommitted candidate, one implementation writer, both independent reviews, verification-policy focused checks/statics/strict and real native-app validation. Preserve execution-time integrity, trust, typed approvals, minimal environment and schema versions1. Keep user workbench selections and credentials unchanged.
Success signals: STATED: real Windows EIM/SDK probe succeeds through the actual application; real fresh/repair Python provisioning succeeds; explicit dependency recheck observes external changes; verified local archive install supports sigrok without remote publication and rejects wrong content; find-only SDK dependencies do not promise automatic installs; compact accessible en/ro/de UI groups controls at top with expand/collapse and installed/working/error states. INFERRED: focused pending-operation navigation and stale-result tests protect responsive behavior without pretending the original unexplained freeze was reproduced.
Evidence: OBSERVED: 02_Tools/cache/plugin-audit-20261105/{findings.json,functional-checks.json,notes.md,plugin-list-timing*.json,ui-timings.json,idf-probe*.json}; original native screenshots01..13 and actual SDK installer/version receipts. Source: plugins/provisioning.ts, runner.ts, store.ts; desktop main/sessions.ts and index.ts; renderer plugins.tsx, plugin-catalog.tsx and workbench-plugins.tsx.
Assumptions: INFERRED: nine developed source packages are the installed plugin inventory; original audit checked both folder inventory and live list. Operational diagnostics are reusable for unchanged observations, not proof of future fixes.
Unknowns: UNKNOWN: exact original hang mechanism, native Ubuntu/ARM64/physical bench acceptance and hosted release reachability after any future authorized publication. Implementation chooses the smallest evidence-backed performance changes and reports remaining limits.
Decision-blocking questions: None. STATED: user explicitly approved the prior proposal and requested implementation and local commit.
Proposed behaviors: STATED accepted: top Catalog / install folder-or-ZIP / check dependencies / refresh actions; expandable package rows with name/version/source/dependency summary, stable check/install-or-disabled-installed actions, secondary export/uninstall, expanded per-program versions/progress/friendly error and technical detail, explicit external SDK action, workbench-only enablement with empty defaults. INFERRED implementation detail: local verified archive ingestion is the concrete route for offline sigrok delivery under the no-publication constraint.
Path and reason: Full path; requirements/interfaces and observable UI behavior change.

| Criterion | Holds | Evidence |
|---|---|---|
| no new externally observable behavior | no | STATED accepted page organization and explicit recheck |
| no new interface or data format | no | INFERRED explicit dependency recheck/local archive IPC needed |
| no new dependency | unknown | OBSERVED uv pin may require a targeted remedy |
| an existing requirement already covers behavior | no | OBSERVED current UI spec describes the catalog below expanded installed rows |
| no security or data-handling change | no | STATED keep exact archive hashes and minimal allowlisted process environment |

## Requirement coverage

| Requirement | Behavior | Design | Verification |
|---|---|---|---|
| REQ-PLAT-2ab2eb65 | Preserve Windows executable discovery for plugin launchers | See design | Focused tests and native proof |
| REQ-REL-21eeae69 | Recover managed Python provisioning from a broken minor alias | See design | Focused tests and native proof |
| REQ-FUNC-ed2e8564 | Explicit plugin dependency recheck | See design | Focused tests and native proof |
| REQ-SEC-7a5afebb | Provision pinned dependencies from a verified local archive | See design | Focused tests and native proof |
| REQ-REL-22ef3dca | Refuse invalid local dependency archives without installation | See design | Focused tests and native proof |
| REQ-UX-27a41e3d | Compact plugin management with grouped controls | See design | Focused tests and native proof |
| REQ-UX-35b1e6b5 | Explain externally managed plugin dependencies | See design | Focused tests and native proof |
| REQ-NFR-2b7fe7ab | Keep plugin navigation and session listing responsive | See design | Focused tests and native proof |


## Design

### Approach

Use explicit fresh checks and verified local delivery on the existing provisioning path (REQ-FUNC-ed2e8564, REQ-SEC-7a5afebb), retain minimal Windows environment plus PATHEXT (REQ-PLAT-2ab2eb65), and retry only a validated runtime-owned broken alias after a failed user install (REQ-REL-21eeae69). Pin a verified uv update and prove real fresh Windows provisioning.

Move the existing full PluginStore listing to a dedicated desktop worker, coalescing only identical pending reads; preserve all load/trust/approval checks. Read-only session polling uses the current recovered SessionService/DB without program initialization (REQ-NFR-2b7fe7ab). No claim is made that the original unknown hang is reproduced or fully diagnosed.

### Interfaces and data

Add plugins.check and native-picker plugins.installArchive bound to package SHA, program and workbench. Retain status shape and schema versions1; add bounded useful diagnostics where probes fail. Explicit check actually probes recorded managed programs. Local files stream to staging and match manifest SHA before cache reuse, extraction, probe and record. Wrong identity refuses CONFLICT; unsafe inputs leave no published install (REQ-REL-22ef3dca).

Compact expandable rows, stable dependency controls, top toolbar/catalog toggle and external-install guidance in en/ro/de replace the long expanded page. Workbench selection remains its unsaved opt-in draft (REQ-UX-27a41e3d, REQ-UX-35b1e6b5). Cancel/late-result handling cannot apply to another page/workbench.

### Files and test seams

Core plugins/{runner,provisioning,store}.ts and focused tests; shared plugins/ipc schemas and mocks; desktop main/index, sessions and dedicated plugin-list host/worker; electron-vite worker entry; renderer plugins, catalog, workbench-plugins, styles/locales and focused tests. Coordinator-owned real fresh-runtime process proof supplements the focused provisioning/process-host seams. Normal native app acceptance is coordinator-owned.

### Risks and open decisions

Archive identity and opened-byte TOCTOU are checked before cache reuse. Concurrent checks/install share ordering; old UI queries are cancelled before action results publish. Worker shutdown/lifecycle and synchronous current-DB session projection prevent stale workbench access. No full environment inheritance, stale integrity cache, remote release, migration or physical operation. Native Ubuntu/ARM64/hardware remain distinct unknowns. New uv binary is downloaded and verified only into the existing pinned payload scheme.

### Requirement map

Each coverage row maps to the identically named decision above and the spec REQ-FUNC-ed2e8564; focused automated and native verification cover success and refusal/pending cases. Diagrams: [diagram_TASK-5fda967d.md](diagram_TASK-5fda967d.md).


## Log

- 2026-11-05 frame: journal opened
- 2026-11-05 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-05 specify: completed; next design
- 2026-11-05 design: completed; next build
- 2026-11-05 build: Frame checklist reconciliation: all seven frame conditions were satisfied by recorded Frame/base/RULING001 when coordinator advanced; unchecked template flags were bookkeeping only. Specify/design conditions were ticked before advancing.
- 2026-11-05 build: red: pinned vitest runner.test.ts -t preserves only Windows PATHEXT exit1 - PATHEXT absent from minimal environment (REQ-PLAT-2ab2eb65); anchor recorded before first production edit.
- 2026-11-05 build: green: pinned runner PATHEXT regression exit0; Windows-only case-insensitive allowlist preserves PATHEXT and excludes secret host variables (REQ-PLAT-2ab2eb65).
- 2026-11-05 build: red: pinned provisioning regressions exit1 - no public fresh dependency check or local archive installer exists (REQ-FUNC-ed2e8564, REQ-SEC-7a5afebb, REQ-REL-22ef3dca).
- 2026-11-05 build: green: pinned provisioning focused regressions exit0 (2 tests) - explicit actual recheck/shared concurrent work and manifest-SHA local archive install/refusal before existing-cache reuse (REQ-FUNC-ed2e8564, REQ-SEC-7a5afebb, REQ-REL-22ef3dca).
- 2026-11-05 build: red: managed-Python alias regression exit1 reports missing rather than ready; bounded alias-only retry implemented after validated root/target checks (REQ-REL-21eeae69). Pinned uv0.13.7 archive/binary hashes sourced and verified by coordinator; original clean Windows proof passed.
- 2026-11-05 build: red: pinned desktop sessions focused test exit1 - no lightweight list method exists; real DB fixture requires interrupted-status recovery before first listing and a later list independent of held metadata preparation (REQ-NFR-2b7fe7ab).
- 2026-11-05 build: red/green: packaging prepareUv pin-change regression first failed on older same-filename cache; SHA-addressed current archive cache added. Source manifests pin verified uv0.13.7; no legacy fallback or migration.
- 2026-11-05 build: red: renderer groups-top-actions regression exit1 - Catalog toggle/compact rows/explicit check controls absent; implementing accessible localized management (REQ-UX-27a41e3d, REQ-UX-35b1e6b5).
- 2026-11-05 build: green: development checks passed for core provisioning + renderer compact actions (52 tests/one POSIX-only skip), actual bundled worker freshness/equivalence/coalescing/shutdown regression, and incremental TypeScript build. Original interrupted-status recovery list test passed. Intermediate normal application build in progress for coordinator native acceptance; no final strict/static proof yet.
- 2026-11-05 build: green: 10 focused files passed (149 tests, one POSIX-only skip), plus post-staging package-change refusal and scoped worker collision/untrusted equivalence passed. Evolution compared against pre-edit anchor and reviewed: changed production/test/docs files match plugin stabilization scope. Native intermediate build exit0; coordinator fresh normal-app C: profile serial dependency installation and concurrent row expansion passed. Native QA found two mojibake UI glyphs; corrected UTF-8 source/docs and added glyph regression, affected visual proof pending later rebuild.
- 2026-11-05 build: DEVIATION build: final strict/static proof deferred until both independent reviews and native corrections are complete - coordinator owns prove-last order. Advisory check exit0: errors0/warnings63/notes20, unrelated existing stale-path/ticket/test-link/manual records; no historical audit. Focused new-workbench light-first captured-program-host regression passed; glyph regression passed after explicit UTF-8 repair. Native wrong archive SHA refusal observed; source-neutral en/ro/de checksum wording corrected.
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: R1 both changes_required: propagate fresh scoped negative checks to singleton session resolver; retry managed unavailable version/range; invalidate same-hash reinstall dependency UI; bound scrubbed diagnostics; local-archive refusal boundary tests; restore UTF-8 arrows; compact workbench label CSS. Native fresh serial and wrong/correct sigrok local archive passed; credentials/workbench YAML preservation hashes unchanged. Actual-profile EIM idf.py timed out at30s; eight other packages Ready. Investigation continues without claiming SDK acceptance.
- 2026-11-05 validate: returned to build - Both independent R1 reviews require targeted same-candidate corrections; user-authorized autopilot fix loop
- 2026-11-05 build: R1 green: affected provisioning/UI/status set66passed/1POSIXskip; managed retry, same-hash reinstall, bounded redaction and local-file boundary assertions pass. Runtime check propagation publishes inside its scoped queue and guards singleton invalidation generations; older checks refuse CONFLICT. Activation fake-time check survives30s and terminates120s. Coordinator actual EIM repeat with120s limit passed5.5.2 in21.3s; prior30s native failure retained as intermittent startup boundary, exact cause unknown. Native UI output temporarily instrumented for targeted immediate-consumer e2e; normal restore follows R2 candidate freeze.
- 2026-11-05 build: R1 green: affected3-file set66passed/1POSIXskip, incremental typecheck exit0; native plugins-ui immediate-consumer4/4 passed (install/run, scoped trust+changed helper, pending-probe quit, workbench defaultnone/save/cancel); browser keyboard/en-ro-de/light-dark/all5fontscales/catalog/managed dependency flow passed1/1. Browser first attempt reached final click behind existing<1280px absolute Runs drawer; test now closes completed Runs drawer before global management, no forcedclick/product workaround. Encoding review: all29 remaining flagged lines are legitimate Romanian â locale text; source/docs corruption restored. Evolution after R1 corrections reviewed; changes remain scoped. Native intermediate credentials/workbench YAML preservation matches original hashes (manual/preservation-after-intermediate.json).
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: R2 both changes_required: checked negative runtime observation is lost on later unrelated toggle/invalidate, resurrecting an old managed recorded Ready version. Read-only reproduction confirmed. Preserve latest identity-bound checked authority separately from disposable resolution cache; actual fresh check, installation and changed installation identity supersede it. Other R1 fixes reviewed successfully; native4/browser1 proof remains reusable.
- 2026-11-05 validate: returned to build - R2 remaining authority lifecycle defect; same-scope autopilot fix loop
- 2026-11-05 build: R2 red: negativecheck→invalidate→resolve regression reproduced recorded5.6Ready after known99unsupported (windows/r2-authority-red.log). Green: complete Provisioner file40passed/1POSIXskip, actual newer-install-vs-held-check focused regression passed, incremental typecheck0. Identity-bound checked failures now survive unrelated invalidation, while Ready clears old failure and retains ordinary disposable file/discovery checks. Fresh check, scoped/global actual provisioning and successful archive version probes replace authority; same-hash reinstallation timestamp excludes old observations. Wrong archive integrity refusal preserves prior healthy runtime. Existing fallback file-deletion regression passed unchanged. Formatting/import organization applied with linter disabled, no final statics. Evolution reviewed; native4/browser1 proof reused because UI unchanged.
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: R3 spec changes_required, quality approved. A newly created scoped passive status host can show recorded Ready after singleton observed an unsupported version. Bind scoped passive display to the same verified identity and checked runtime authority.
- 2026-11-05 validate: returned to build - R3 scoped passive dependency status can diverge from runtime authority
- 2026-11-05 build: R3 red: focused scoped negative test exit1. New passive scope returned recorded Ready while the singleton refused the checked unsupported executable. Original windows/r3-passive-red.log.
- 2026-11-05 build: R3 green: two focused Provisioner cases pass and native Electron scoped-program-status quit cancellation passes 1/1. Fresh scoped store lookup and package verification remain, passive inspection shares the runtime authority, and the scope aborts its own wait. The runtime host drains its shared probes on app quit. Same-version repair and changed installation identity supersede old failure. Existing unchanged normal Windows positive flow confirmed all9 packages, IDF3/3 SDK5.5.2 with both toolchains2.43.1, glyphs and compact workbench labels; YAML/credentials hashes unchanged. Receipts manual/normal-all-nine-results.json and preservation-after-r3.json. Evolution scoped; normal R4 restore running.
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: Manual acceptance: normal Windows fresh C profile installed serial and real CPython 3.13.18; wrong sigrok archive SHA rejected; exact pinned local archive installed sigrok-cli 0.8.0. Actual profile Check All passed nine packages (analysis skills no programs), ESP-IDF idf.py 5.5.2 and both addr2line 2.43.1. Navigated Overview/Edit/Plugins during pending SDK probe without late chat redirect. Compact rows and corrected glyphs inspected; existing Git selection preserved via Cancel; original workbench YAML and credentials SHA unchanged. R4 normal testBuild:false passive smoke in active workbench: ESP32 esptool Ready 5.6.0, 1/1. Original receipts: task cache manual/intermediate-live-results.json, normal-all-nine-results.json, final-r4-passive-smoke.json, preservation-after-r4.json and screenshots02-09. Reused unchanged positive/native/browser evidence; affected R4 quit case passed.
- 2026-11-05 validate: DEVIATION validate: no native Ubuntu/ARM64 acceptance - Windows normal and instrumented native proofs cover this task; Linux uv binary version checked only in WSL2. Original intermittent freeze not reproduced, and hardware/hosted release remain out of scope. Automatic review rejected cleanup of the closed owned QA profile with blocked by policy; left profile in place, no retry.
- 2026-11-05 validate: R4 final strict --run exit1 (windows/final-strict.log). Lint rejected introduced evolving-any rows and aria-label on generic div. Typecheck exit0 in94.8s. i18n exit1 found dynamic collapse/expand keys and unused installPrograms strings. Normal R4 passive esptool5.6.0 manual smoke passed. R4 review approvals recorded before proof. Return build for static-only correction and R5 review.
- 2026-11-05 validate: returned to build - R4 final strict failed introduced lint and i18n diagnostics
- 2026-11-05 build: R5 focused diagnostics exit0. Session summaries use the existing return type. Plugin actions use a named native section with existing classes. Plugin expansion and workbench badge use literal translation calls, and the unused installPrograms entries were removed across en/ro/de. Full i18n catalog audit passes. Changed-file Biome checks pass; existing redundant-fragment info remains advisory. Product behavior and prior native proof reused. Evolution remains in scope.
- 2026-11-05 build: completed; next validate
- 2026-11-05 validate: Final normal R5 build exit 0, testBuild:false; main SHA256 a55a685ce518689098275aa140420902b023a09d16034b88d61629c2ea452c4b. Real existing profile opens Plugins with accessible named management region and all nine installed rows; manual/10-final-r5-toolbar.png. No changed runtime behavior from R4. Both R5 independent reviewers approved. Session row typing, named toolbar and locale changes only.
- 2026-11-05 validate: final: python .agentic/aegis.py check --task TASK-5fda967d --strict --run exit 0; lint, typecheck and i18n all passed. Original windows/final-strict-r5.log: errors 0, warnings 60, notes 20, no promoted warnings. Remaining AEGIS warnings concern existing traceability and historical journals, test-file classification and uv-manifest layout; actual linked tests and pinned binary hashes inspected. No full suites between milestones, per verification-policy. Local commit authorized by RULING-001; no remote publication.
- 2026-11-05 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-05 | decision=Implement accepted plugin stabilization and organization in autopilot on master; coordinator makes one local commit after validation and two independent reviews; no remote publication. | reason=Explicit user request in this chat on 2026-11-05. | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-5fda967d.md
changed: Stabilized dependency checks/installations, compact Plugins and workbench selection, and responsive listing.
evidence: Strict AEGIS exit 0; both R5 reviews approved; focused tests, real Windows app all nine packages and ESP-IDF 5.5.2 Ready.
issues: Original intermittent freeze not reproduced; no native Ubuntu/ARM64 or hardware acceptance.
spec_compliance: approved
implementation_quality: approved
review_round: 5

## Delivery report (2026-11-05)

- stage: validate; type: change; path: full; branch: master
- requirements:
  - REQ-PLAT-2ab2eb65 - Preserve Windows executable discovery for plugin launchers
  - REQ-REL-21eeae69 - Recover managed Python provisioning from a broken minor alias
  - REQ-FUNC-ed2e8564 - Explicit plugin dependency recheck
  - REQ-SEC-7a5afebb - Provision pinned dependencies from a verified local archive
  - REQ-REL-22ef3dca - Refuse invalid local dependency archives without installation
  - REQ-UX-27a41e3d - Compact plugin management with grouped controls
  - REQ-UX-35b1e6b5 - Explain externally managed plugin dependencies
  - REQ-NFR-2b7fe7ab - Keep plugin navigation and session listing responsive
- deviations: 2 recorded
  - build: final strict/static proof deferred until both independent reviews and native corrections are complete - coordinator owns prove-last order. Advisory check exit0: errors0/warnings63/notes20, unrelated existing stale-path/ticket/test-link/manual records; no historical audit. Focused new-workbench light-first captured-program-host regression passed; glyph regression passed after explicit UTF-8 repair. Native wrong archive SHA refusal observed; source-neutral en/ro/de checksum wording corrected.
  - validate: no native Ubuntu/ARM64 acceptance - Windows normal and instrumented native proofs cover this task; Linux uv binary version checked only in WSL2. Original intermittent freeze not reproduced, and hardware/hosted release remain out of scope. Automatic review rejected cleanup of the closed owned QA profile with blocked by policy; left profile in place, no retry.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=5
- diff vs task base d377c69: 52 file(s) changed, 2446 line(s) added
- checks: errors=0 warnings=60 notes=20
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
