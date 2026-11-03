# TASK-bb6f2f0e - PLG-20 binutils plugin (Gitea #82)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-e6056763, REQ-DATA-4d4471f9, REQ-FUNC-20b10001, REQ-FUNC-20b10002, REQ-FUNC-20b10003, REQ-SEC-20b10004, REQ-UX-20b10005, REQ-UX-20b10006, REQ-UX-20b10007, REQ-TEST-20b10008
parent:
branch: master
base: 27ecf718fc5ce461bebaed5c9d698efa18050a51
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

Problem: STATED (PLG-20, Gitea #82 delegation): VERA needs local ARM/RISC-V ELF analysis through an official binutils plugin.
Desired outcome: STATED: five GNU utilities per architecture, find-first provisioning with pinned xPack fallback, three skills and genuine ELF/replay evidence on Windows and Linux.
Actors: STATED: embedded engineer explicitly installs/enables/provisions; agent loads skills and runs declared programs.
Primary scenario: STATED: compare two builds, rank growing symbols, decode PC/LR with the matching ELF and disassemble a selected function.
Examples: STATED: arm-none-eabi-size -A before.elf; addr2line -e after.elf -f -C -i PC LR; objdump --disassemble=crash_site after.elf.
Counterexamples: STATED: Espressif decoders remain in esp32-idf; discovery must never download a toolchain.
In scope: STATED: PLG-20 package/catalog, find+download extension in format 1, ordered known roots, real pinned downloads, skills, sources and committed ARM/RISC-V ELF fixtures, focused tests and both independent reviews.
Out of scope: STATED: other tickets, ESP32 hardware acceptance, migrations, staging/commits/publication/Gitea writes, branches/worktrees and coordinator tracker edits.
Constraints: STATED: shared master; base 27ecf718fc5ce461bebaed5c9d698efa18050a51; coordinator exclusively performs the authorized local commit after handover. OBSERVED: clean index/checkout at base. STATED: verification-policy.md overrides per-ticket full suites; runtime pinned per host; offline tests; all stored versions remain 1.
Success signals: STATED: Done criteria in plugins/plan.md PLG-20, found/downloaded real toolchains on Windows x64 and native Ubuntu; no hardware or live model needed; linux-arm64 pins inspected but execution requires a host.
Evidence: OBSERVED: plugins/binutils.md and architecture.md, ADR-0016..0019; shared/plugins.ts uses exclusive install variants; provisioning.ts already shares extracted archives by SHA-256 and probes found programs.
Assumptions: INFERRED: current lifecycle, statuses, runner limits and minimal environment remain the contract for combined provisioning.
Unknowns: UNKNOWN until preparation: current official release versions, SHA-256, archive member roots and native host availability.
Decision-blocking questions: None; user explicitly authorizes the required format-1 extension and sequential implementation.
Proposed behaviors: None beyond accepted planning and delegated scope.
Path and reason: Full; new plugin and manifest interface.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | official binutils tools/skills |
| no new interface or data format | no | combined find/download |
| no new dependency | yes | existing provisioner and host ports |
| existing requirement covers behavior | no | new plugin |
| no security/data handling change | no | new pinned executable downloads |

## Requirement coverage

| Behavior | Requirement | Design | Verification |
|---|---|---|---|
| Combined sources in plugin review | REQ-UX-e6056763 | existing install review lists both | plugins.test.ts combined source case |
| Combined format-1 validation | REQ-DATA-4d4471f9 | optional validated download on find; launcher stays find-only | shared plugin-provisioning tests |
| Prefer discovered tools before downloads | REQ-FUNC-20b10001 | existing ports and content package | 05_Software/src/libraries/core/src/plugins/provisioning.test.ts |
| Install the fallback after discovery misses | REQ-FUNC-20b10002 | existing ports and content package | 05_Software/src/libraries/core/src/plugins/provisioning.test.ts |
| Ship ARM and RISC-V ELF utilities | REQ-FUNC-20b10003 | existing ports and content package | 05_Software/tests/integration/binutils.test.ts |
| Classify local ELF analysis as safe | REQ-SEC-20b10004 | existing ports and content package | 05_Software/tests/integration/binutils.test.ts |
| Guide firmware size comparisons | REQ-UX-20b10005 | existing ports and content package | 05_Software/tests/integration/binutils.test.ts |
| Guide matching-ELF crash decoding | REQ-UX-20b10006 | existing ports and content package | 05_Software/tests/integration/binutils.test.ts |
| Guide bounded ELF inspection | REQ-UX-20b10007 | existing ports and content package | 05_Software/tests/integration/binutils.test.ts |
| Retain reproducible cross-architecture ELF fixtures | REQ-TEST-20b10008 | existing ports and content package | 05_Software/tests/integration/binutils.test.ts |


## Design

### Approach
STATED: PLG-20 requires find-first and explicit user-triggered fallback. REQ-FUNC-20b10001/02 use the existing Provisioner, adding optional download to the strict find variant; no shell, new service or dependency. Found binaries are version-probed as today; an unusable probe remains unavailable, never triggers replacement. Missing files fall through to the download entry. Archive folders remain keyed by SHA-256 for the five tools.

### Interfaces and data
REQ-DATA-4d4471f9 extends format 1 in place. A combined program reports kind download so existing UI/CLI can provision it. Launcher programs stay find-only because fallback executables do not supply a launcher. Resolve/statuses are read-only; install retains serialization, cancellation, deadlines, staging, hash verification and atomic version recording. Missing find platform lists may use an available fallback; no available download yields the existing platform status. Existing version/range/download/archive failures remain unchanged.

### Files and test seams
REQ-FUNC-20b10003 / REQ-SEC-20b10004: plugin.yaml, catalog official entry and general pack; ten names, per-tool version probes, safe rules. Shared schema/provisioner tests cover combination, absence, invalid pin, failed probe, cache sharing and consumer regressions. REQ-UX-20b10005/06/07: three installed skills through SkillCatalog. REQ-TEST-20b10008: committed source/linker/ELF corpus and offline real-archive replay (optional local archive directory, no network).

### Risks and open decisions
OBSERVED: Arduino's generic three-wildcard path exceeds existing two-segment limit; use fixed known tool names with package/version wildcards. Zephyr tool names differ; use explicit per-program file patterns as existing find supports. Download pins and archive structure come from official release assets, never inference. Linux arm64 archive inspection establishes pins/member architecture, not executable acceptance. Native Ubuntu uses an owned source mirror with separate dependencies and pinned runtime.

### Requirement map
REQ-DATA-4d4471f9: combined strict schema. REQ-FUNC-20b10001/02: examine find before download and reuse existing installer. REQ-FUNC-20b10003: declarative package and catalog. REQ-SEC-20b10004: safe manifest rules and runner unchanged. REQ-UX-20b10005/06/07: skills content. REQ-TEST-20b10008: small deterministic fixture builds and measured replay expectations.

Diagrams: [diagram_TASK-bb6f2f0e.md](diagram_TASK-bb6f2f0e.md)


## Log

- 2026-11-03 frame: journal opened
- 2026-11-03 frame: User authorizes one local commit per ticket; coordinator alone verifies and commits this candidate. Implementation handover without staging, commit or push. Base confirmed clean: 27ecf718fc5ce461bebaed5c9d698efa18050a51 on master.
- 2026-11-03 frame: completed; next specify - Autopilot: delegated PLG-20 scope recorded (7 Done checklist item(s) left unticked)
- 2026-11-03 specify: completed; next design - Autopilot: planning and delegated scope specify the contracts (7 Done checklist item(s) left unticked)
- 2026-11-03 design: completed; next build - Autopilot design complete (6 Done checklist item(s) left unticked)
- 2026-11-03 build: red: pinned node vitest plugin-provisioning.test.ts -t strict find exit 1: combined find/download rejected at install (REQ-DATA-4d4471f9).
- 2026-11-03 build: red: Windows red-core.log exit 1: find miss returns notFound instead of entering download lifecycle (REQ-FUNC-20b10001/02); unsupported discovered version test passes. Stable owned TEMP avoids sandbox ephemeral temp files.
- 2026-11-03 build: green: provisioning.log Windows exit 0 (35 passed, one native-Linux-only skip). red: red-package.log exit 1: binutils package absent (REQ-FUNC-20b10003, REQ-SEC-20b10004, REQ-UX-20b10005/06/07). Official six archives hashed against API digest and vendor .sha; members and arm64 host ELF headers verified in archive-inspection.log.
- 2026-11-03 build: Immediate affected consumer: Plugins review InstallSource must display both find roots and downloads for combined declarations. Existing plugins knowledge routes it. red-ui.log exit 1 confirms roots hidden; update only that consumer and focused UI test. package-native.log Windows native exit 0 confirms declarations, catalog, safe rules and three installed skills.
- 2026-11-03 build: green: windows-focused.log exit 0: 55 tests plus native-only/opt-in skips; windows-real.log native exit 0: real official archives downloaded via local offline transport, ten utilities probed, both architectures, downloaded then PATH-found resolution, 28 CLI runs in read-only replay and original logs/events retained. No hardware or paid model. Synthetic fixture PC/LR and build dimensions independently checked against actual command output.
- 2026-11-03 build: Ubuntu ubuntu-focused.log exit 0: 59 tests, including native real-archive acceptance and all find roots. Windows windows-affected-final.log: 29 passed, two platform/opt-in skips, one existing zip test transient BUSY; isolated windows-failed-rerun.log exit 0. windows-consumers.log: 109 passed and one catalog expected-list failure; correct immediate consumer to current four official plugins including binutils and existing esp32-idf.
- 2026-11-03 build: green: package-native.log and focused host proof cover package/rules/skills; manual fixture generation with pinned Windows xPack GCC produced four genuine ELF32 DWARF4 images. Reproduction --check retains byte identity and original hashes in fixture-reproduction.log (REQ-TEST-20b10008). Source edits and evolution map reviewed against scope; no AEGIS payload or coordinator tracker edited. Two independent read-only reviewers are explicitly authorized by the delegation and review.md.
- 2026-11-03 build: completed; next validate
- 2026-11-03 validate: green: ubuntu-consumers.log exit 0: 120 direct consumer/import-boundary tests. Windows consumers resolved: 109 original passing cases + one corrected catalog assertion passed in windows-catalog-rerun.log; windows-cli-consumers.log exit 0 (10). Fixture reproduction exit 0 confirms all four ELF byte hashes. Build advisory has 0 errors, existing unrelated stale-path/test/ticket-reference warnings and pending reviews; do not alter unrelated requirements. Known Ubuntu React act warnings in existing promotion case do not fail assertions.
- 2026-11-03 validate: Independent read-only round 1 reviews: spec_review approved, quality_review approved; no actionable findings in complete tracked/untracked candidate against recorded base. Both inspected original Windows/Ubuntu proof, fixture inputs, schema/provisioner/UI and package. Final strict proof follows with candidate frozen.
- 2026-11-03 validate: final: python .agentic/aegis.py check --task TASK-bb6f2f0e --strict --run exit 0; lint/typecheck/i18n all passed, full test intentionally skipped per verification-policy. windows-strict.log retains original proof. Advisory disposition: 56 warnings = 46 unrelated existing metadata warnings, 6 uncovered-source heuristics (catalog/packs governed by REQ-FUNC-20b10003 official package and integration catalog assertions; changed test files are in linked_tests rather than affected_paths), 4 binary secret-scan limitations for source-built ELFs. Binary bytes reproduced exactly from reviewed freestanding sources; no credentials/embedded secrets. Eight notes are existing manual verifications including deferred ESP-IDF hardware. Earlier build log shorthand about unrelated warnings did not distinguish these ten candidate heuristic/binary warnings; this line provides their explicit disposition. No remaining product defect.
- 2026-11-03 validate: Native final statics: ubuntu-lint.log exit 0 (existing warning/info diagnostics, no errors); ubuntu-typecheck-final.log exit 0; ubuntu-i18n.log exit 0. Frozen reviewed source/test/config proof reused; no full suite per ticket. Windows strict exit 0 already recorded. Final branch master, HEAD 27ecf718fc5ce461bebaed5c9d698efa18050a51, empty index; no commit/staging/push/Gitea mutation. No product blocker. Linux-arm64 execution unverified by host availability as explicitly allowed; ESP-IDF hardware acceptance remains separate and deferred.
- 2026-11-03 validate: Owned scratch cleanup complete on Windows and Ubuntu (exit 0): removed six downloaded archives, extracted compiler pieces, temporary test/cache data and the isolated native mirror. Retained raw release JSON, vendor .sha, pins/member/header inspection, fixture reproduction, original test/static logs and four replay evidence directories. Common runtimes/caches and other tasks untouched. Coordinator next: inspect complete candidate/original proof and make the authorized local PLG-20 commit.
- 2026-11-03 validate: completed; next done
- 2026-11-03 done: Coordinator acceptance: inspected complete current 42-file tracked/untracked candidate, requirements/specs, genuine ELF source/reproduction records and original Windows/native Ubuntu focused/static evidence. Both independent round1 approvals confirmed from reviewer chats 01a1a282-9c54-77c3-9d34-5202c65b9140 and 01a1a282-d7af-7481-874a-95236b8e1ff2. Required x64 found/downloaded real-toolchain replay and Done criteria satisfied; linux-arm64 execution unclaimed. Existing advisory/binary-scan limitations explicitly dispositioned. Standing human instruction authorizes this coordinator one local PLG-20 commit on master, then PLG-19; no product edits, routine retesting, push or Gitea mutation.

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-bb6f2f0e.md
changed: PLG-20 complete: binutils package, find/download provisioning, UI sources, real ELF corpus and docs
evidence: Windows real replay and affected regressions; Ubuntu 59 focused + 120 consumers; strict lint/typecheck/i18n exit 0; both reviews approved round 1
issues: No product blockers. Linux-arm64 execution unclaimed; 56 advisory AEGIS warnings explicitly dispositioned in journal.
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-03)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-e6056763 - Review a plugin before installing it
  - REQ-DATA-4d4471f9 - Validate plugin manifest format 1
  - REQ-FUNC-20b10001 - Prefer discovered tools before downloads
  - REQ-FUNC-20b10002 - Install the fallback after discovery misses
  - REQ-FUNC-20b10003 - Ship ARM and RISC-V ELF utilities
  - REQ-SEC-20b10004 - Classify local ELF analysis as safe
  - REQ-UX-20b10005 - Guide firmware size comparisons
  - REQ-UX-20b10006 - Guide matching-ELF crash decoding
  - REQ-UX-20b10007 - Guide bounded ELF inspection
  - REQ-TEST-20b10008 - Retain reproducible cross-architecture ELF fixtures
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 27ecf71: 42 file(s) changed, 1450 line(s) added; 4 file(s) not content-scanned
- checks: errors=0 warnings=56 notes=8
- checklist: 9/9 done
