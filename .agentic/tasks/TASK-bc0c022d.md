# TASK-bc0c022d - Resolve applicable findings from the VERA implementation review

stage: validate
type: fix
interaction: autopilot
requirements: REQ-NFR-910ee3cb, REQ-REL-f11465da, REQ-SEC-3ce12132, REQ-REL-d4a9df9a, REQ-REL-bcb6fb23, REQ-SEC-c370e45b, REQ-SEC-aaeae5cb
parent:
branch: master
base: 6617fd4be1609378e4d219abbc2e20cc7b9f9085
opened: 2026-11-25

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

Problem: OBSERVED the updated review mixes already corrected, partly corrected
and open findings. The integrated fixes also need regression review at host boundaries.
Desired outcome: STATED verify the remote corrections, finish applicable findings,
update the supplied report and run the complete suite.
Actors: STATED VERA users and agents, Windows Desktop, Ubuntu under WSL2, LAN LM Studio.
Primary scenario: OBSERVED commits 6f2400fa, 1796caec and 6617fd4b are integrated in
local master. The remaining behavior is evaluated through normal entry points.
Examples: OBSERVED compaction renumbers candidate prefixes repeatedly, direct log
reads use a shared path exemption, and a failed index row has no scoped retry action.
Counterexamples: INFERRED a request to relax permissions does not require a change when
the current explicit approval contract is the desired behavior.
In scope: STATED F-01 through F-62, verified residual defects, and regressions
introduced by the integrated corrections. Preserve the original report and append results.
Out of scope: STATED unrelated release, plugin and product work; remote publication requires
separate authorization under the repository policy.
Constraints: OBSERVED shared master, reviewed base in the header, existing untracked work
preserved. STATED run the complete gate at the end, Linux proof on Ubuntu WSL2 and use
the existing private LM Studio service for applicable model checks.
Success signals: Each numbered finding has a supported disposition, applicable
changes have focused proof, and the complete gate reports its actual result per host.
Evidence: OBSERVED fast-forward, source diff, current report, Windows and WSL2 setup,
and the live read-only LM Studio model catalog. Existing review timings are historical.
Assumptions: INFERRED group the residual fixes by subsystem while keeping a single
integration candidate and final gate.
Unknowns: UNKNOWN remaining measurement-dependent behavior and native-only acceptance.
Decision-blocking questions: STATED user selected all F-01 through F-62.
Proposed behaviors: Preserve deliberate policies, restore verified behavior and add
only the minimal handling required for distinct residual user-facing failures.

## Requirement coverage

| Behavior | Requirement | Design | Verification |
| --- | --- | --- | --- |
| Bound the cost of prefix selection (F-08) | REQ-NFR-910ee3cb | Prepare eligible prefixes once and bound full context counts | Compaction tests |
| Avoid repeated failed summaries (F-19) | REQ-REL-f11465da | Track failed automatic compaction for the current turn | Runtime tests |
| Restrict managed log access (F-12) | REQ-SEC-3ce12132 | Opt in from read, grep, parse_log and verified line citations with ordinary files | File tool and viewer tests |
| Retain usable indexed results during failure retry (F-15) | REQ-REL-d4a9df9a | Retry failed records through the existing ingest queue | Ingest tests |
| Reclaim stale workbench locks after PID reuse (F-50) | REQ-REL-bcb6fb23 | Hold the existing native IPC guard for the ownership lifetime | Workbench lifecycle tests |

## Design

**Approach.** Reuse context policy, ingest queue and file guard. Keep the public
report as the source for each remaining disposition, with descriptions and proof.

**Interfaces and data.** Candidate selection uses the existing summary context
budget and keeps complete tool exchanges. Automatic fallback is turn-local.
Explicit reads of owned log files use an opt-in guard; existing file write
permissions remain in force. Retry retains unchanged successful index rows.

**Files and test seams.** The runtime, compactor, file tools and ingester tests
exercise their public entry points; Windows, WSL2 and local model checks provide
separate integration evidence at the final gate.

**Risks and open decisions.** Preserve current approval and redaction contracts.
Use measured evidence before changing initial context estimation or cache policy.

**Requirement map.** Each applicable design and verification seam is recorded in
the requirement coverage table. Other original findings are audited in the review
document against their existing explicit repository requirements.

## Log

- 2026-11-25 frame: journal opened
- 2026-11-25 frame: completed; next specify - Scope accepted; local master fast-forwarded to reviewed remote base (7 Done checklist item(s) left unticked)
- 2026-11-25 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-25 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-25 build: red: focused compaction and write-edit tests exit 1 - 132 full prefix counts and protected write prepared against a scoped read-only log (REQ-NFR-910ee3cb, REQ-SEC-3ce12132)
- 2026-11-25 build: green: focused compaction, read, grep and write-edit tests exit 0; 52 passed, 2 skipped
- 2026-11-25 build: red: focused automatic summary and retry tests exit 1; a single turn sent two automatic summaries and retry reprocessed a good document (REQ-REL-f11465da, REQ-REL-d4a9df9a)
- 2026-11-26 build: green: focused core workbench, ingest, compaction, refs and prefix tests exit 0 (263 passed, 2 skipped); renderer approval, workspace, documents and large text exit 0 (107 passed); file tools and large-text proof exit 0 (53 passed, 2 skipped)
- 2026-11-26 build: Imported corrections passed 350 focused assertions (2 skips). The base release-note check had length and count errors; corrected just the blocking metadata and check:release-notes passed.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Address round-one citation, encoding, compaction, draft and lock rollback findings
- 2026-11-26 build: Round 1 red: targeted Vitest exit 1 - tool-heavy summary used 116 complete probes, failed second pass was hidden, late legacy bytes disagreed with edit, and legacy viewer rejected a valid ref.
- 2026-11-26 build: Review corrections: guarded direct log citations including positional bytes; whole-stream legacy decoding; measured detailed and minimum prefix search; second-pass status retained; same-session sends remain editable across remount; replacement indexer rollback; embedding specification aligned.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Preserve the maximal complete summary prefix and bind legacy fallback to the initial file revision
- 2026-11-26 build: Round 2 red: targeted Vitest exit 1 - bounded one-pass tool history left a view that did not fit, and legacy replay admitted a changed file.
- 2026-11-26 build: Focused proof: Windows aggregate round 2 exit 0 (234 pass, 3 skips). Round 3 exit 0 (55 pass, 2 skips), including a 2900-token one-pass compacted history, detail restoration within budget, and rejection of a changed file between encoding scans.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: Milestone owner: coordinating chat. Candidate based on origin/master 6617fd4b, with Windows and Ubuntu WSL2 verify:all plus complete Electron/Browser E2E. Static checks supplied once per host by verify:all and structural check by AEGIS strict; native Ubuntu is distinct.
- 2026-11-26 validate: Final candidate real-model evidence: LM Studio qwen/qwen3.8-27b local-32k passed in 38.1 seconds; all planted decisions and open items retained, no invented value or planted instruction followed, estimated context ratio 0.7195. See 05_Software/evaluation-outputs/compaction/20261126-003612-qwen-qwen3.8-27b-low/run.json.
- 2026-11-26 validate: Milestone verification exposed F-35 consumer contracts for native POSIX versus Windows paths, a manual TextDecoder alias regression, and missing text processor binary admission. Initial runs are retained as evidence.
- 2026-11-26 validate: returned to build - Repair confirmed F-35 and F-48 failures from complete verification and rerun affected checks
- 2026-11-26 build: Milestone fallbacks: 13 focused Windows files exit 0, 169 pass and 8 platform skips. Verified restored portable plugin binding and drive refusal, Windows alias coverage, legacy rendering, binary admission and direct text/citation paths.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Use slash-normalized portable name validation for POSIX program inputs
- 2026-11-26 build: Resolved round-four portable spelling issue and added native POSIX coverage. Windows program suite 26 passed, 1 skip. WSL2 changed code suites 152 passed with one fixture assertion corrected; POSIX selection then 9 passed, 1 skip. The CLI read-only integration fixture now holds a real guard rather than only advertising a PID; recovery run in progress.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Align existing native and browser assertions with F-20 editable draft contract
- 2026-11-26 build: E2E failure exposed old required-disabled-textarea assertions. Updated approval fixtures verify editable text, disabled Send and draft retention. Product source unchanged. Targeted E2E is queued after current serial runs to avoid sharing native desktop focus.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Wait for approval settlement and assert blocked Send with a nonempty draft
- 2026-11-26 build: Approval follow-up uses a nonempty draft and waits for enabled Send after the decision before checking its retention.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Keep the synthetic loopback sender alive through the native Dumpcap capture
- 2026-11-26 build: Native Windows capture fixture red: inventory worked and valid pcapng held zero packets while setup took longer than the preexisting UDP burst. Green: fixture keeps the bounded synthetic sender alive until short capture completes, 3/3 passed with Npcap and Dumpcap 4.6.10; short 25 packets, rolling 2 retained segments, 3 rotated out, readable by TShark.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Use the real IPC guard in the native E2E read-only workbench fixture
- 2026-11-26 build: Initial native E2E live-owner fixture only wrote an owner PID so it exercised stale recovery. Updated the fixture to hold the canonical native guard through the child app, close it on all paths and assert unchanged lock and absent database. Windows targeted and late WSL E2E exercise it.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: returned to build - Align the browser feel test with F-24 and the published send/follow contract
- 2026-11-26 build: Windows browser report showed the old scroll test expected no follow after a sent message. Updated the fixture to verify typing keeps reading position and submitting follows newest, matching F-24 and the already published implementation.
- 2026-11-26 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: Final focused native positives: five Windows approval cases passed, Windows and WSL2 UI read-only with real IPC guard passed, and the standalone WSL2 CLI read-only replay passed after the host load cleared. F24 browser follow recheck passed on Windows.
- 2026-11-26 validate: Final milestone: app suites exited 1 on Windows (4197 pass/106 fail/41 skip) and WSL2 (4148/155/41). Official plugin suites ran separately, both exit 1 (Windows 686/7/183, WSL2 685/7/185). All 58 browser and 137 serial E2E selected per host finished: browser Windows 37/21, WSL2 45/13; serial Windows 106/24/7, WSL2 107/23/7. Retests passed for approvals, read-only workbench, send/follow, Npcap and real LM Studio. Exact clean baseline reproduces three CLI and two Replay compaction failures. Strict AEGIS exit 0 with advisory warnings. Logs in 05_Software/test-outputs/vera-review-6617.
- 2026-11-26 validate: Validation confirmed an F-20 regression: the draft became editable during active Plan review and hidden privacy projections. The current task restores those draft locks while preserving Stop and the intended approval/send draft behavior.

## Rulings

- RULING-001 | date=2026-11-25 | decision=Audit and implement applicable findings across F-01 through F-62 | reason=The user explicitly selected the complete numbered review | source=user | supersedes=none


## State

status: blocked
reported: validate - blocked
next: Clear remaining full milestone failures before accepting the candidate
must_read: .agentic/tasks/TASK-bc0c022d.md, .agentic/steps/5_validate.md
changed: Review audit and targeted product corrections in the checked-out master candidate
evidence: Both hosts ran the app, official plugins and both E2E lanes. Focused rechecks passed and both independent reviews approved.
issues: Full suite remains red on Windows and WSL2, including reproduced base Replay/CLI context limits and other plugin/UI failures. Product candidate remains local on master.
spec_compliance: approved
implementation_quality: approved
review_round: 11

## Delivery report (2026-11-26)

- stage: validate; type: fix; branch: master
- requirements:
  - REQ-NFR-910ee3cb - Bound candidate selection work during context compaction
  - REQ-REL-f11465da - Skip repeated failed automatic summaries within a turn
  - REQ-SEC-3ce12132 - Confine agent access to run logs to read operations
  - REQ-REL-d4a9df9a - Preserve indexed documents during failed-document retry
  - REQ-REL-bcb6fb23 - Workbench lock lifecycle
  - REQ-SEC-c370e45b - Confine tool paths
  - REQ-SEC-aaeae5cb - Refuse workbench files the path guard cannot bind
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=10
- diff vs task base 6617fd4: 106 file(s) changed, 2390 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=111 notes=44
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
