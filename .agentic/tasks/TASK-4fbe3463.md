# TASK-4fbe3463 - TERM-02 Command approvals and allowed command prefixes (#313)

stage: done
type: feature
interaction: autopilot
requirements: REQ-SEC-f0170103, REQ-SEC-f0170201, REQ-SEC-f0170202, REQ-DATA-f0170203, REQ-UX-f0170204, REQ-SEC-f0170205
parent:
branch: master
base: 8d2cd008e262eb213b42307fbf057c5af1ceb574
opened: 2026-11-16

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

Problem: STATED #313: routine commands need saved-prefix approval in Auto-edit.
Desired outcome: STATED #313/#311: Read-only hides, Ask always asks, Auto-edit honors safe saved prefixes, Bypass never asks; destructive commands always ask outside Bypass.
Actors: STATED agent requests shell execution; user explicitly grants/removes workbench prefixes.
Primary scenario: STATED Always allow on npm test persists the chosen prefix, then Auto-edit runs npm test -- --watch=false without asking.
Examples: STATED #313 A-C: Ask still asks; git push --force asks despite git; removal restores prompting.
Counterexamples: STATED delegation: composition/substitution/newline, executable spelling tricks and destructive flags cannot inherit prefix approval; agent arguments cannot grant prefixes.
In scope: STATED #313: conservative prefix policy, format-1 persistence via validated user IPC, approval and Agent editor UI in four languages; live consumption rechecks, exact grants and protected cwd retained.
Out of scope: STATED delegation: TERM-03+ folders, Runs and terminal improvements; no shell sandbox, full suites, branch/worktree/push/commit or issue closure by this chat.
Constraints: OBSERVED master/default master at base 8d2cd008e262eb213b42307fbf057c5af1ceb574. STATED coordinator owns local commit and issue closure; preserve external workflow payload, bundled-plugins and PERF task. Autopilot authorized. No format changes above1, dependencies or compatibility code.
Success signals: STATED actual UI persistence/restart and real session mode proof for A-C; hostile parser tests; smallest native/browser filters, required statics/strict and independent spec/quality reviews.
Evidence: OBSERVED tea issues 313 and311 using ddp login; terminal.md; TERM01 journal TASK-002d804f; command-tools.ts and ApprovalGate currently ask for all Auto-edit commands.
Assumptions: INFERRED conservative unsupported syntax falls back to user approval per delegation, rather than parsing arbitrary shells.
Unknowns: Native Ubuntu is unavailable; reuse unchanged TERM01 runner/shell platform proof and label WSL separately.
Decision-blocking questions: None; product behavior and authorization supplied.
Proposed behaviors: None awaiting acceptance.

## Requirement coverage

| Requirement | Behavior | Design | Proof |
|---|---|---|---|
| REQ-SEC-f0170103 | Mode matrix with safe Auto-edit prefixes | Gate live policy | gate/session tests |
| REQ-SEC-f0170201 | Refuse composed command prefix authorization | shared policy / gate / user configuration | 05_Software/src/libraries/shared/src/command-prefix.test.ts |
| REQ-SEC-f0170202 | Reject unsafe saved command prefixes | shared policy / gate / user configuration | 05_Software/src/libraries/shared/src/command-prefix.test.ts |
| REQ-DATA-f0170203 | Persist explicitly approved command prefixes | shared policy / gate / user configuration | 05_Software/src/libraries/core/src/sessions/programs.test.ts |
| REQ-UX-f0170204 | Remove saved command prefixes in Agent settings | shared policy / gate / user configuration | 05_Software/tests/e2e/command-prefixes.spec.ts |
| REQ-SEC-f0170205 | Recheck live command authority at consumption | shared policy / gate / user configuration | 05_Software/src/libraries/core/src/agent/program-approvals.test.ts |


## Design

### Approach
REQ-SEC-f0170103/f0170201: shared pure command-prefix policy accepts only plain ASCII executable names and literal space-separated arguments. Quotes, escapes, control characters, expansion, composition, redirection, executable paths/extensions and shell/interpreter dispatch require explicit approval. Block destructive tool families and dangerous flags/refspecs before boundary matching. This is approval policy, not a shell sandbox.

### Interfaces and data
REQ-DATA-f0170203: agent.allowed_commands is a bounded unique array in workbench format1, default empty. Shared schema validates eligible prefixes. Existing user approval IPC adds optional commandPrefix and routes that explicit action to async SessionService.allowCommandApproval; ordinary decideApproval remains synchronous. Core validates pending exact request and eligible matching prefix before calling a host-only asynchronous save callback. No model parameter accepts grants. Persistence failure leaves approval pending. Revalidate pending identity and mode after await before deciding.
REQ-UX-f0170204: approval card offers a chosen prefix (default complete eligible command); Agent editor lists/removes with normal Save/Cancel. Save uses existing serialized config mutation. Masked grant presentation uses complete workbench.commandPrefixes.list entries with SHA256 identity and scrubbed label; Editor tracks only removal IDs, passed atomically with workbench.config.update, and never echoes redacted grant strings. Unknown/stale IDs conflict; grant replacement and removal cannot be mixed. English/Romanian/German/French help and release notes describe conservative limits.
REQ-SEC-f0170205: ApprovalGate reads live host-owned prefixes both on admission and consumption. Automatic decisions remain durable, exact and single-use; removed grants or Ask downgrade invalidate mode decisions. User-approved arbitrary syntax remains executable as authorized, without confinement claims. Existing Bypass epochs, runner checks, cwd and masking remain unchanged.

### Files and test seams
Shared command-prefix.ts/test, workbench schemas/IPC; core ApprovalGate, SessionService, WorkbenchService grant addition; desktop SessionsHost composes the explicit user save callback; desktop and CLI both compose live prefix reads. UI approval card and separate workbench prefix list; translations/help/inventories. Gate hostile/mode tests, real session persistence/removal tests, localized components and smallest native/browser acceptance.

### Risks and open decisions
Prefix matching authorizes argument suffixes, not the effects of scripts or executables. Unsupported syntax is explicitly approved each time. Concurrent removal takes effect through current workbench state at consumption; asynchronous save rechecks request ownership after disk write. No dependencies or format version changes. Native Ubuntu remains unavailable; unchanged TERM01 process proof reused.

### Requirement map
All six requirements map to the shared eligibility/schema, gate live policy, explicit persistence and user UI seams above. Full suites and official-plugin suite are deferred by explicit delegation; coordinator owns final epic gate.

Diagrams: [diagram_TASK-4fbe3463.md](diagram_TASK-4fbe3463.md)


## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: completed; next specify - TERM-02 scope recorded in authorized autopilot (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: focused command-prefix.test.ts exit1 (2 expected failures): format1 default grant list and explicit prefix IPC absent (REQ-SEC-f0170202, REQ-DATA-f0170203); original evaluation-outputs/term02/red-schema.log. Anchor completed before product edits.
- 2026-11-16 build: red: program-approvals.test.ts -t honors live exit1: matching Auto-edit prefix still pending (REQ-SEC-f0170103, REQ-SEC-f0170205); original evaluation-outputs/term02/red-gate.log. Shared hostile parser tests now cover composition and destructive families.
- 2026-11-16 build: red: approval-card.test.ts explicit chosen filter exit1, four locales lack Always allow UI (REQ-DATA-f0170203, REQ-UX-f0170204); original evaluation-outputs/term02/red-ui.log.
- 2026-11-16 build: green: focused Vitest 9 files exit0, 193 tests; real SessionService explicit-save/failure/Ask/removal and agent-grant rejection pass. WorkbenchService restart/removal exact filter exit0, 1/43 selected. Originals evaluation-outputs/term02/focused.log, session.log, persistence.log. Browser four-locale Save/Cancel passed; native acceptance ongoing.
- 2026-11-16 build: DEVIATION build: full official-plugin suite and full app/E2E suites deferred by explicit delegation; smallest affected approval/session/command consumers and native/browser cases run instead. Later behavior tests followed the initial schema/gate/UI red tests, so per-requirement preimplementation red proof is incomplete.
- 2026-11-16 build: Native UI debug acceptance exit0 (1 case): exact card npm test, format1 saved prefix and full app restart; suffix execution returns exitCode0 by mode; Ask waits; git push --force waits with git grant and offers no Always allow; Agent removal+Save restores prompting. Original native-debug2.log/native.json/native.png. Final candidate E2E build/filter rerun in progress after parser hardening.
- 2026-11-16 build: green: actual final instrumented build (e2e.log) completed; initial E2E attempt refused a custom output folder under the cleanup reporter policy before tests. Corrected direct pinned playwright exact file exit0: native acceptance and four-language browser Save/Cancel 2/2 (e2e-final.log). The build has all current product source; only test helper casts changed afterward. Native screenshot inspected and receipt retained in native.json/native.png. No product regression found.
- 2026-11-16 build: Focused proof reconciliation: focused-final.log ran11 files/215 tests,214 passed and one stale workbench default assertion failed. Corrected only the affected schema expectation and added secret-prefix event assertion; consumers-corrected.log reran shared workbench + desktop events exit0,21/21. All215 distinct cases now have passing proof, plus persistence.log1 selected WorkbenchService restart case. No broad rerun required. i18n/help/release-notes exit0; candidate Biome28 files exit0. Initial typecheck exposed only two E2E helper typing errors, now corrected; final strict will prove typecheck.
- 2026-11-16 build: Evolution reviewed: owned product/tests/docs/context/requirements match TERM02; workflow payload/config/root instruction edits and user bundled-plugins predate anchor and remain excluded. Existing context-size warnings on chat-ui/plugins and global requirement/advisory warnings are outside focused implementation; no unrelated restructuring. TERM01 native Windows/WSL2 process proof reused unchanged; native Ubuntu remains unavailable.
- 2026-11-16 build: completed; next validate (1 Done checklist item(s) left unticked)
- 2026-11-16 validate: Round1 reviews both changes_required: wrapper/path-spelled destructive tools bypass eligibility (nice /bin/rm -rv; time/nohup /bin/dd); masked event prefixes disappear from effective-grant editor. Fix conservative wrapper/basename/cluster detection and authoritative masked grant list with opaque removal identity, preserving existing configuration grants on unrelated Save. Also type 101st-grant rejection as INVALID.
- 2026-11-16 validate: returned to build - Fix round1 destructive wrapper bypass and masked-grant removal identity
- 2026-11-16 build: red: review1 command-prefix.test.ts exit1,5 wrapper/path destructive cases fail as reviewers reported (58 pass), original review1-red.log. Fix now rejects known dispatch wrappers and destructive basenames through paths/executable suffixes. Masked grant correction adds complete SHA256 identities with scrubbed display labels; editor sends removal IDs atomically with normal config Save and never echoes sanitized grants.
- 2026-11-16 build: Review corrections remain authorized by original autopilot delegation and review fix loop; no new product scope. Shared/gate/mock/router focused proof exit0,144/144 (review1-focused.log). Updated WorkbenchService identity/removal and typed max100 proof exit0,2/44 selected (review1-persistence-final.log). Reusing prior unchanged session/card/runner proof.
- 2026-11-16 build: Masked-grant native correction passed in review1-native.log: secret test masks npm test label, complete list still shows two grants, unrelated chat-detail Save preserves exact grants, chosen masked grant removal updates YAML, retained-secret policy is preserved and app restart restores command prompting. Previous review1-e2e.log browser4-locale case passed; native earlier failure was expected retained credential protection, now test restarts after removing test credential. Final rebuilt-native filter running after last parser spelling hardening.
- 2026-11-16 build: Review1 final focused command: pinned npx vitest run shared/command-prefix.test.ts core/agent/program-approvals.test.ts desktop/main/ipc-router.test.ts desktop/renderer/mocks/mockApi.test.ts desktop/preload/bridge.test.ts exit0,153/153; workbench/service.test.ts -t user command|101st exit0,2/44. Candidate Biome31 files exit0 (one unchanged preload non-null warning); standalone service Biome0 supersedes one transient mixed-run callback warning. No unrelated code changes.
- 2026-11-16 build: green: final rebuilt native command filter exit0,1/1 with current parser/product source (review1-native-final.log). Browser editor4-locale case from review1-e2e.log remains valid (same UI/mock source). No owned live child processes remain after app finally-close; temporary native workbenches/profiles cleaned, original logs/receipt/screenshot retained. Read-only source shell process proofs remain reused from TERM01.
- 2026-11-16 build: completed; next validate (1 Done checklist item(s) left unticked)
- 2026-11-16 validate: Round2 spec approved, quality requests one remaining recognizable recursive-delete form: git clean victim / git clean -dq can delete directories without -f when clean.requireForce=false. Conservatively exclude entire git clean family; no other findings.
- 2026-11-16 validate: returned to build - Exclude git clean recursive deletion family from saved-prefix eligibility
- 2026-11-16 build: Review2 red: command-prefix.test.ts exit1 with2 git clean forms accepted (66 pass), original review2-red.log. Green: exact shared parser + core gate filters exit0,109/109 (review2-focused.log); changed3-file Biome0 (review2-biome.log). Entire git clean family now requires explicit approval; no UI/persistence/other policy edits. Reuse prior native/browser proof for unchanged exercised behavior; no routine handover retest.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Round3 independent spec_review and quality_review both approved complete current candidate. Source/tests/docs remain frozen after these approvals; final strict proof now runs. Earlier native/browser/persistence and focused proofs reused for unchanged behavior, with review2 parser/gate109/109 covering final git clean guard.
- 2026-11-16 validate: Initial strict exit1: typecheck/i18n/help0, lint26errors. Expanded lint diagnostic confirms24 introduced noFloatingPromises in unchanged synchronous decideApproval consumers, plus2 known format baselines. Correct by keeping ordinary decideApproval synchronous and exposing explicit async allowCommandApproval only for user prefix persistence; do not modify unrelated plugin/tests. Original strict.log and lint-errors.log retained.
- 2026-11-16 validate: returned to build - Preserve synchronous ordinary approval API; isolate explicit async user prefix grant path
- 2026-11-16 build: Async API correction green: ordinary decideApproval remains void; only allowCommandApproval persists user prefixes asynchronously. sessions/programs.test.ts + sessions/approvals.test.ts exit0,42/42 (review3-focused.log). Pinned typecheck0 refreshes workspace declarations; final expanded global Biome now exactly2 known baseline format errors (review3-lint-final.log), changed4-file Biome0 (review3-biome-final.log). No plugin source/test edits. Rebuilt native IPC acceptance running before round4 approvals.
- 2026-11-16 build: Final API-correction native acceptance rebuilt current app and passed1/1 (review3-native.log), including user prefix save/restart, Ask/force refusal, masked identity editing, unrelated-save preservation and postremoval prompting. All scope source/tests/docs frozen for round4 review.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Round4 independent spec_review and quality_review both approved complete corrected candidate; no remaining findings. Final source/tests/docs frozen. Final strict will rerun only previously failed lint and configured static checks, with workspace declarations current.
- 2026-11-16 validate: final: python .agentic/aegis.py check --task TASK-4fbe3463 --strict --run exit1; lint only2known format errors, typecheck0/i18n0/help0, tests skipped under static-only policy. Original strict-final.log. Independent round4 approvals precede this final proof; no source/tests/docs edits afterward. check:release-notes0 earlier unchanged; candidate Biome31files0 plus final changed4files0 and parser3files0.
- 2026-11-16 validate: DEVIATION validate: final strict retains2 unchanged global lint baseline errors (user bundled-plugins/index.json and shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b). Delegation explicitly excludes/fixes neither. Expanded diagnostics review3-lint-final.log identify only these2. Advisory context-size/layout/coverage warnings are existing limits or heuristics; source assertions/focused logs cover changed behavior. No full/plugin suites or native Ubuntu proof; unchanged TERM01 Windows/WSL2 process evidence reused. Coordinator owns commit/issue closure, no staging/commit/push by this chat.
- 2026-11-16 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-16 | decision=User authorizes one local commit per ticket; coordinator owns staging, commit and issue closure after validated candidate handover. This chat will not stage or commit. | reason=Root AGENTS.md and delegated TERM-02 scope | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-4fbe3463.md
changed: TERM02 complete candidate: safe prefixes, explicit grants/removal with masking, four locales and docs
evidence: Parser/gate109, session42, persistence2 and native/browser pass; both reviews approved round4; candidate statics0; strict-final exit1 only known lint baseline
issues: Two unchanged global format errors; native Ubuntu unavailable; full suites deferred; initial per-requirement red proof incomplete. Coordinator owns stage/commit/issue closure.
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-16)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-SEC-f0170103 - Approve shell commands by permission mode
  - REQ-SEC-f0170201 - Refuse composed command prefix authorization
  - REQ-SEC-f0170202 - Reject unsafe saved command prefixes
  - REQ-DATA-f0170203 - Persist explicitly approved command prefixes
  - REQ-UX-f0170204 - Remove saved command prefixes in Agent settings
  - REQ-SEC-f0170205 - Recheck live command authority at consumption
- deviations: 2 recorded
  - build: full official-plugin suite and full app/E2E suites deferred by explicit delegation; smallest affected approval/session/command consumers and native/browser cases run instead. Later behavior tests followed the initial schema/gate/UI red tests, so per-requirement preimplementation red proof is incomplete.
  - validate: final strict retains2 unchanged global lint baseline errors (user bundled-plugins/index.json and shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b). Delegation explicitly excludes/fixes neither. Expanded diagnostics review3-lint-final.log identify only these2. Advisory context-size/layout/coverage warnings are existing limits or heuristics; source assertions/focused logs cover changed behavior. No full/plugin suites or native Ubuntu proof; unchanged TERM01 Windows/WSL2 process evidence reused. Coordinator owns commit/issue closure, no staging/commit/push by this chat.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 8d2cd00: 90 file(s) changed, 2484 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=75 notes=38
- checklist: 8/9 done; open: `report` appended
