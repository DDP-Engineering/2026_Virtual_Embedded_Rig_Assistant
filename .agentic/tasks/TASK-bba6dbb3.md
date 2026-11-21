# TASK-bba6dbb3 - DICT-03: Add composer dictation controls, shortcuts and draft insertion

stage: done
type: feature
interaction: autopilot
requirements: REQ-REL-4bea0004, REQ-UX-91e43161, REQ-FUNC-91e43162, REQ-UX-91e43163, REQ-REL-91e43164, REQ-UX-91e43165, REQ-REL-91e43166, REQ-DATA-91e43167, REQ-REL-91e43168
parent:
branch: ddp/epic-338
base: f651183faff2bdc2c689a896a72705f5696a1f1c
opened: 2026-11-20

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

Problem: STATED (#341): wire the existing local capture service into the chat composer.
Desired outcome: STATED (#341): a configurable hold or toggle gesture produces editable text in the initiating draft; explicit Send remains the existing action.
Actors: STATED (#338/#341): VERA Desktop users on Windows and Ubuntu, including keyboard-only users.
Primary scenario: STATED (#338/#341): download a model, select a mode and optional shortcut, dictate offline, review the draft and send.
Examples: STATED (#341): release a held shortcut to transcribe; editing during inference still preserves typed text and attachments.
Counterexamples: STATED (#341): Escape during dictation cancels it without stopping the agent; a late result cannot write into a different session.
In scope: STATED (#341): mode and shortcut settings, composer microphone and status, capture lifetime and draft insertion, four locales and help, user-visible release notes and focused acceptance.
Out of scope: STATED (coordinator): changes to model/download or capture contracts, branch creation, stage/commit/push, Gitea edits, full-suite gate.
Constraints: OBSERVED: clean ddp/epic-338 base f651183faff2bdc2c689a896a72705f5696a1f1c. STATED: the coordinator is authorized to make one local commit; this session hands back the unstaged candidate. WSL2 fixture testing uses the coordinator's owned checkout path.
Success signals: STATED (#341): both modes work by button and shortcut; conflicts, repeat, missed release, Escape and draft identity are exercised; Windows and Ubuntu packaged download/capture/offline insertion/cancel are exercised where accessible; keyboard-only and en/ro/de/fr checks pass.
Evidence: OBSERVED: capture.ts tags completions with their originating session and cancels on invalidation; App.tsx keys the workspace by workbench and session; shared keyboard-shortcuts.ts validates command conflicts; #340 proof is TASK-91f2fb57.
Assumptions: INFERRED: use the current renderer draft and attachment ownership; no new draft storage is required by #341.
Unknowns: UNKNOWN: physical microphone/native Ubuntu acceptance on this machine; WSL2 is available.
Decision-blocking questions: None.
Proposed behaviors: No scope additions.

## Requirement coverage

| Behavior | Requirement | Design seam |
|---|---|---|
| STATED (#341): Operate the composer microphone | REQ-UX-91e43161 | `dictation-button.tsx` |
| STATED (#341): Apply the configured dictation recording mode | REQ-FUNC-91e43162 | `settings.ts` |
| STATED (#341): Dispatch the configured local shortcut | REQ-UX-91e43163 | `keyboard-shortcuts.ts` |
| STATED (#341): Reject conflicting dictation shortcuts | REQ-REL-91e43164 | `keyboard-shortcuts.ts` |
| STATED (#341): Announce dictation progress and outcomes | REQ-UX-91e43165 | `dictation-button.tsx` |
| STATED (#341): Cancel dictation ahead of turn stop | REQ-REL-91e43166 | `use-composer-dictation.ts` |
| OBSERVED (existing Stop rule): Confirm Escape when the workspace owns the key | REQ-REL-4bea0004 | `workspace.tsx` |
| STATED (#341): Insert dictation into its initiating draft | REQ-DATA-91e43167 | `composer.tsx` |
| STATED (#341): Discard dictation after leaving a draft | REQ-REL-91e43168 | `composer.tsx` |

## Design

**Approach**

- Persist the input gesture as an app setting and register Dictate as an unassigned app-local command. The Dictation page reuses the shortcut row and modal from the Keyboard shortcuts page (REQ-FUNC-91e43162, REQ-REL-91e43164).
- The composer owns the existing capture controller through a React hook and offers a microphone plus an active Cancel button. The hook handles the app shortcut and tracks one held pointer or key. Capture-phase Escape cancels before the workspace's Stop handler (REQ-UX-91e43161, REQ-UX-91e43163, REQ-UX-91e43165, REQ-REL-91e43166).

**Interfaces and data**

- The confirmed settings snapshot supplies the mode. Hold-to-talk is the default and the microphone works with no assigned shortcut. A keyboard activation on the focused microphone follows the same configured mode (REQ-FUNC-91e43162, REQ-UX-91e43161).
- The hook snapshots the textarea's selection end and draft revision before a gesture. Results must match the live capture and its session; when text changed, insertion appends to the current draft. Insert spacing only at word boundaries that would otherwise run together. Preserve the attachment state, and invalidate on composer departure or explicit submission (REQ-DATA-91e43167, REQ-REL-91e43168).
- Window blur and visibility changes cancel capture. A held chord also ends on its key or a participating modifier release; pointer cancellation or lost pointer capture discards the active hold (REQ-UX-91e43161, REQ-UX-91e43163).

**Files and test seams**

- Shared settings/shortcuts, Settings and App supply confirmed preferences. Workspace supplies chat-tab availability; composer, microphone view, hook and draft helper own the interaction. Locale catalogs, generated shortcuts, Settings/Chat help and release notes document it.
- Shared settings tests, draft insertion tests and focused Playwright cases prove the gesture, draft and Settings behavior. Run the integrated packaged flow against cached verified Whisper fixture bytes and sandboxed Electron on Windows and WSL2 Ubuntu where available.

**Risks and open decisions**

- Late success can race cancellation or a new draft. A renderer attempt token and the returned session id must both match, and draft revision tracks edits even when the visible text returns to its original value.
- Reuse the existing capture, model and IPC contract. Physical microphone and native Ubuntu availability remain open.

**Requirement map**

- REQ-UX-91e43161, REQ-UX-91e43163, REQ-REL-91e43166: microphone and hook event ownership.
- REQ-FUNC-91e43162, REQ-REL-91e43164: settings renderer, confirmed snapshot and registry validation.
- REQ-UX-91e43165: localized status and Cancel controls.
- REQ-DATA-91e43167, REQ-REL-91e43168: revision-aware draft insertion and cancellation.

Diagrams: [diagram_TASK-bba6dbb3.md](diagram_TASK-bba6dbb3.md).

## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-20 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-20 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-20 build: red: focused Vitest keyboard-shortcuts.test.ts exit 1; current settings reject the dictation mode and command (REQ-FUNC-91e43162, REQ-REL-91e43164)
- 2026-11-20 build: red: focused Playwright keyboard-only hold test exit 1 after rendering a writable chat, because the current composer has no microphone (REQ-UX-91e43161, REQ-UX-91e43163, REQ-UX-91e43165, REQ-REL-91e43166, REQ-DATA-91e43167, REQ-REL-91e43168)
- 2026-11-20 build: green: Windows focused Vitest (mode/bindings, draft insertion, capture, Settings, workspace, shortcut dispatch, import boundaries and generated help) exit 0, 87 passed. The Settings inventory regression now includes the Dictation tab introduced in this epic.
- 2026-11-20 build: green: Windows Playwright passed eight browser cases, and a three-case focused retest including outside pointer release and hidden-chat invalidation exited 0. The only initial browser failure was an incorrect mock document path. Localized phases and errors passed en/ro/de/fr.
- 2026-11-20 build: green: Windows and WSL2 packaged composer checks passed initial package with local responses for pinned Whisper Base, restart, sandboxed fixture capture, offline text and attachment preservation, cancellation and explicit send. Final package proof follows the reviewed status-row revision.
- 2026-11-20 build: Advisory check has zero errors. Existing historical journal, ticket-reference and context-size warnings are outside #341. Layout globs classify shipped help, CHANGELOG, release notes and some colocated tests generically; focused help, release notes and test checks cover those files.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 1 specification: keep active dictation cancellation when a native modal owns Escape, reconcile the existing Stop requirement, exercise chord key-up/blur and repeat, use the actual shortcut in packaged capture, and correct Romanian shortcut wording. Quality: restore keyboard focus when a shortcut dialog closes while its triggering UI is disabled or replaced.
- 2026-11-20 validate: returned to build - Address both independent reviews: modal Escape precedence, shortcut focus restoration and focused regression coverage
- 2026-11-20 build: red: Windows Playwright modal Escape and shortcut-save focus cases exited 1 for the expected reasons: recording persisted after modal dismissal, and saving moved keyboard focus out of the Settings row.
- 2026-11-20 build: green: Windows Playwright round-1 correction coverage passed the modal Escape, assigned chord release/repeat/blur and locale scenarios. The focused follow-up passed keyboard Add and Edit focus while the settings update was held pending. Romanian shortcut help was regenerated.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 2 independent specification and implementation-quality reviewers both approved the corrected candidate. Earlier round-1 native packages also passed the persisted shortcut through trusted Electron capture on Windows and WSL2. A final package proof checks the exact reviewed focus correction.
- 2026-11-20 validate: final: python .agentic/aegis.py check --task TASK-bba6dbb3 --strict --run exit 0. Lint, TypeScript, i18n and help passed. Release notes audit and git diff --check also passed. The report has zero errors and retains historical metadata and generic layout warnings for help, release notes and colocated tests covered by focused checks.
- 2026-11-20 validate: DEVIATION validate: native Ubuntu and physical microphone acceptance remain unverified - available Linux proof uses Ubuntu under WSL2 with Xvfb/openbox, and both platforms use a controlled audio fixture and cached pinned HTTPS responses for model download.
- 2026-11-20 validate: Reviewed Windows test package: wrapped npm run package:test with --windows-runtime=the verified #340 runtime cache, --output-root and --reuse-bundled-plugins exited 0 with NSIS and portable ZIP. Packaged-composer Playwright passed 1/1 against the reviewed unpacked executable using an isolated installed-mode profile. The post-ZIP unpacked tree had the portable marker; the smoke temporarily moved it and restored it. Pinned download responses, restart, trusted button/shortcut capture, offline insertion, cancellation, attachment and explicit Send passed.
- 2026-11-20 validate: Reviewed Ubuntu 24.04.4 under WSL2: pinned wrapper npm run package:test with owned --output-root and --reuse-bundled-plugins exited 0 with AppImage and deb. Playwright dictation-packaged-composer.spec.ts passed 1/1 from the reviewed linux-unpacked executable under Xvfb/openbox. The staged verified download, persisted settings/shortcut across restart, offline microphone fixture transcription, cancellation, attachment and explicit Send passed.
- 2026-11-20 validate: Handover: HEAD remains f651183faff2bdc2c689a896a72705f5696a1f1c on ddp/epic-338 and the index is empty. Removed temporary package/staging trees and retained receipts under 05_Software/evaluation-outputs/dict-03. The WSL2 execution checkout and pinned tools/node_modules remain under /home/dpasare/vera-epic338-gate.7P5LVo/checkout for the coordinator. Coordinator owns the authorized local commit and epic full-suite gate.
- 2026-11-20 validate: completed; next done
- 2026-11-20 done: Epic #338 gate owned by the coordinator. Integrated source commit 2321a19e97c2b558f17c42a61ebddf1aa2c6662d tested once on Windows and Ubuntu 24.04 under WSL2. Strict AEGIS exit 0. npm run verify:all exit 1 on both after static checks passed, with application and CLI totals Windows 3379 passed, 7 failed, 34 skipped and WSL2 3377 passed, 4 failed, 39 skipped. The separate plugin run completed on both with Windows 650 passed, 5 failed, 184 skipped and WSL2 647 passed, 7 failed, 186 skipped. Playwright finished on Windows with 39 browser passed and 2 failed, then 112 serial passed, 6 failed and 1 skipped. On WSL2 all 41 browser cases passed, then 113 serial passed, 5 failed and 1 skipped. Both dictation Electron cases and the four-locale composer browser cases passed on both platforms.
- 2026-11-20 done: Epic gate follow-up: reran failed cases selectively. Isolated reruns passed timing cases, Windows Bypass CLI, Windows folder and scroll Electron cases, Renode, WSL2 Freerouting and the WSL2 large-file timing case. Focused checks against fetched origin/master bb55180dc737f7d8fdba52b51acc0c9dcac3b36e reproduced the workbench-close and scoped CLI failures, ESP32-IDF, Git and Probe-rs failures, four shared Electron failures, and both Windows browser failures. The Windows plugin-builder case still fails and its baseline comparison remains open. Full gate remains red. The Windows and WSL2 packaged dictation receipts use fixture audio. Native Ubuntu and physical microphone acceptance remain pending. Original gate and follow-up logs are retained in 05_Software/evaluation-outputs/epic-338-gate.

## Rulings

- RULING-001 | date=2026-11-20 | decision=Use the verified sibling branch in autopilot and hand back the unstaged candidate for one authorized local commit by the coordinator | reason=Implementation delegation for Gitea issue 341 names the checkout, base and commit owner | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-bba6dbb3.md
changed: DICT-03 complete and ready for the coordinator on ddp/epic-338
evidence: 87 focused Vitest tests, 11 browser checks, both packaged composer checks, strict AEGIS and both independent reviews passed.
issues: Native Ubuntu and physical microphone acceptance remain unverified. Packaged model download used pinned cached responses. Full-suite gate belongs to the coordinator.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-REL-4bea0004 - Stop active turns
  - REQ-UX-91e43161 - Operate the composer microphone
  - REQ-FUNC-91e43162 - Apply the configured dictation recording mode
  - REQ-UX-91e43163 - Dispatch the configured local shortcut
  - REQ-REL-91e43164 - Reject conflicting dictation shortcuts
  - REQ-UX-91e43165 - Announce dictation progress and outcomes
  - REQ-REL-91e43166 - Cancel dictation ahead of turn stop
  - REQ-DATA-91e43167 - Insert dictation into its initiating draft
  - REQ-REL-91e43168 - Discard dictation after leaving a draft
- deviations: 1 recorded
  - validate: native Ubuntu and physical microphone acceptance remain unverified - available Linux proof uses Ubuntu under WSL2 with Xvfb/openbox, and both platforms use a controlled audio fixture and cached pinned HTTPS responses for model download.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base f651183: 56 file(s) changed, 1549 line(s) added
- checks: errors=0 warnings=42 notes=42
- checklist: 9/9 done
