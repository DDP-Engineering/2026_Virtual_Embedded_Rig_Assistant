# TASK-91f2fb57 - DICT-02 Capture the microphone and transcribe with local Whisper

stage: done
type: feature
interaction: autopilot
requirements: REQ-SEC-250c645c, REQ-FUNC-907c9538, REQ-SEC-dc8304bd, REQ-FUNC-a5c31d08, REQ-FUNC-179d51e4, REQ-FUNC-af174598, REQ-REL-b6181cdf, REQ-FUNC-31029892, REQ-REL-152d1f1a, REQ-REL-c4f6b8d8, REQ-REL-5b35e39e, REQ-REL-7fc5b118, REQ-REL-6d0054e3, REQ-REL-ff7bba69, REQ-REL-4e42542c, REQ-REL-47f336ff, REQ-DATA-7c5ad4db
parent:
branch: ddp/epic-338
base: 127ab01efd4f9d93262eec1a4e881a3637db7daa
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

Problem: STATED (#340) desktop dictation needs microphone capture and local speech recognition.
Desired outcome: STATED (#340) a user gesture opens a short microphone capture, and stopping returns editable-transcript input to the calling session.
Actors: STATED (#340) desktop user, trusted renderer, preload, main, and isolated Whisper worker.
Primary scenario: STATED (#340) capture a short utterance using the installed model and the chosen automatic or explicit language.
Examples: STATED (#340) recognize fixture speech in Romanian, English, German and French on both models. Cancel before late inference finishes.
Counterexamples: STATED (#340) camera or unrelated renderers never receive media permission. A stale result never enters another session.
In scope: STATED (#340) typed capture and transcription seams, permission checks, audio limits, lifecycle, local inference and errors, focused platform and packaging tests.
Out of scope: STATED (#338, #340, #341 and delegation) composer, keyboard shortcuts, editable-draft insertion, CPU benchmarking, publication and full epic suites.
Constraints: STATED (delegation) work in ddp/epic-338 at 127ab01efd4f9d93262eec1a4e881a3637db7daa. The coordinator is authorized to make one local commit after validation. The implementation chat returns the uncommitted worktree. Preserve sandboxing and the verified #339 model contract.
Success signals: STATED (#340) both models exercise the real offline runtime; trusted capture works while video and unrelated requests are denied; bounded mono 16 kHz, silence, disconnect, stop/cancel and stale-result behavior have focused proof.
Evidence: OBSERVED Gitea #338 through #340, clean sibling base, existing permission handlers and verified local model resolver, existing Electron/ONNX worker build, pinned Transformers.js English default.
Assumptions: INFERRED (short recordings, Whisper feature extractor) limit a job to one 30-second window, with short connection and inference deadlines.
Unknowns: Native Ubuntu acceptance host and availability of a physical microphone on the Windows development host.
Decision-blocking questions: None.
Proposed behaviors: None beyond ticket scope.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Preserve default denial | REQ-SEC-250c645c | permission policy |
| Resolve verified model | REQ-FUNC-907c9538 | immutable job selection |
| Permit gesture-scoped microphone access | REQ-SEC-dc8304bd | security |
| Return local Whisper transcripts | REQ-FUNC-a5c31d08 | whisper-worker |
| Detect the spoken language offline | REQ-FUNC-179d51e4 | whisper |
| Honor the chosen spoken language | REQ-FUNC-af174598 | whisper |
| Hold one dictation job | REQ-REL-b6181cdf | capture-jobs |
| Normalize dictation audio | REQ-FUNC-31029892 | capture |
| Reject out-of-range dictation audio | REQ-REL-152d1f1a | dictation |
| Report empty dictation | REQ-REL-c4f6b8d8 | capture-jobs |
| Report an unavailable microphone | REQ-REL-5b35e39e | capture |
| Report denied microphone access | REQ-REL-7fc5b118 | capture |
| Report a disconnected microphone | REQ-REL-6d0054e3 | capture |
| Report an unavailable dictation model | REQ-REL-ff7bba69 | capture-jobs |
| Report a failed dictation worker | REQ-REL-4e42542c | capture-jobs |
| Invalidate ended dictation jobs | REQ-REL-47f336ff | capture-jobs |
| Keep dictated audio transient | REQ-DATA-7c5ad4db | worker-host |


## Design

### Approach

- OBSERVED: Electron's request and check details identify the audio type, frame and origin. The sandboxed preload checks trusted user activation before dispatching start. The desktop permission handlers grant one audio-only request for the focused renderer's exact URL while its job is opening (REQ-SEC-250c645c, REQ-SEC-dc8304bd).
- The renderer capture controller owns browser media. An audio worklet receives a mono downmix in a 16 kHz AudioContext and holds up to 30 seconds of PCM. Stop releases tracks before sending final PCM. Capture errors and changed ownership clear the resources and drop stale completion (REQ-FUNC-31029892, REQ-REL-47f336ff).
- Main resolves the selected model and language once at start and holds admission until completion, including worker termination. A dedicated Node worker loads the pinned local files on CPU and runs Whisper. Automatic language uses first-step scores restricted to the pinned multilingual language tokens (REQ-FUNC-907c9538, REQ-FUNC-a5c31d08, REQ-FUNC-179d51e4, REQ-FUNC-af174598, REQ-REL-b6181cdf).

### Interfaces and data

- Begin, acknowledge recording, submit, and cancel are strict IPC channels keyed by a fresh capture ID. The renderer binds the active session and its completion to the same controller; native blur, navigation, crash and shutdown invalidate the main lease (REQ-REL-47f336ff).
- Empty or silent inputs settle without model execution. Invalid, oversized or non-finite PCM fails before worker handoff. The bounded array is transferred to the worker in memory (REQ-REL-c4f6b8d8, REQ-REL-152d1f1a, REQ-DATA-7c5ad4db).
- Distinct outcomes report missing model, denied or unavailable microphone, disconnect, busy, cancellation, no speech and transcription failure. Permission expires during connection and worker execution has an absolute deadline (REQ-REL-ff7bba69, REQ-REL-7fc5b118, REQ-REL-5b35e39e, REQ-REL-6d0054e3, REQ-REL-4e42542c).

### Files and test seams

- Shared dictation and IPC schemas, preload bridge, main session security and jobs, renderer capture and PCM worklet, and a production desktop worker entry use the current package dependencies. Instrumented renderer builds exercise the pending composer seam.
- Focused unit tests exercise authorization, limits and invalidation. Built Electron exercises real browser media using controlled input. Functional runtime fixtures use the real local Base and Small models in all four languages.

### Risks and open decisions

- Block model removal while a dictation job owns verified runtime inputs. The lease and frame checks protect the trust boundary during asynchronous model verification and acquisition.
- Native Ubuntu and physical device availability depend on the verification hosts.

### Requirement map

- Each coverage row names the owning source boundary; its requirement links the corresponding focused proof.

Diagrams: [diagram_TASK-91f2fb57.md](diagram_TASK-91f2fb57.md).



## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify - Scope recorded in autopilot
- 2026-11-20 specify: completed; next design
- 2026-11-20 design: completed; next build
- 2026-11-20 build: red: Windows focused capture-jobs.test.ts exit 1 because the specified capture job module does not exist yet
- 2026-11-20 build: green: Windows focused capture-jobs.test.ts exit 0, five tests passed
- 2026-11-20 build: red: Windows focused renderer capture.test.ts exit 1 because the specified capture controller does not exist yet
- 2026-11-20 build: green: focused Windows unit and boundaries cases passed (79 runtime and boundary tests); focused packaging.test.ts --testTimeout 15000 exit 0, 20 tests passed.
- 2026-11-20 build: green: Windows built Whisper worker with synthetic speech and verified local assets passed 14 of 16 cases on initial Piper run. The remaining Base Romanian trials correctly identified Romanian in both modes and passed the distinctive normalized phrase on focused rerun. The Romanian rerun passed all four cases.
- 2026-11-20 build: green: WSL2 Ubuntu 24.04 sandboxed built Electron with Xvfb, openbox and a fake stereo microphone passed native browser capture, camera and unrelated contents denial, actual inference, focus/session invalidation and egress assertions. Physical device and native Ubuntu remain outside this host proof.
- 2026-11-20 build: Inspection: capture PCM passes by typed IPC and an in-memory transfer into a single-use worker. No dictation audio is written to files, chat storage or logs. Worker output is bounded, stderr/stdout are drained without recording, and remote loads are closed.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 1 specification: require measured mono 16 kHz duration/packing in native capture and shutdown with active inference. Round 1 quality: an unresolved getUserMedia blocks retry after cancellation; synchronous idle rebind can hand late completion to the next session. Move unrelated renderer permission probe into the actual grant.
- 2026-11-20 validate: returned to build - Fix stalled-acquisition retry and completed-result ownership, and add measured native PCM, in-grant unrelated renderer and active shutdown proof.
- 2026-11-20 build: red: Windows capture.test.ts and capture-jobs.test.ts exit 1. Four renderer regressions show missing session identity, stalled retries and stale rebind completion. Active inference shutdown already passes.
- 2026-11-20 build: green: round 1 corrections passed Windows focused Vitest 53 tests and WSL2 focused Vitest 16 tests. The renderer retries a stalled or cancelled acquisition and closes any late stream, tags success with the originating session, and suppresses a rebind during completion. The worklet cap and active inference shutdown passed on both platforms.
- 2026-11-20 build: green: WSL2 latest worker runtime exit 0, all 16 Whisper Base/Small automatic and explicit cases in en/ro/de/fr. This run uses env.fetch denial and the pinned local model assets.
- 2026-11-20 build: Windows recovered the exact Microsoft VC++ x64 14.51.36247.0 payload without executing its installer. All five DLLs matched the manifest hashes and Microsoft Authenticode. Retained validated cache: 05_Software/evaluation-outputs/dict-02/windows-runtime.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Round 2 independent specification and implementation-quality reviewers approved the corrected source, requirements, coverage and #341 handoff. Packaged proof runs separately against the reviewed candidate.
- 2026-11-20 validate: DEVIATION validate: native Ubuntu and physical microphone acceptance remain open - the available Linux host is WSL2 and both host checks use controlled fixture audio. The sandboxed Electron and package paths are exercised.
- 2026-11-20 validate: Final Windows package:test exit 0 (NSIS and portable ZIP), current unpacked ASAR smoke exit 0 with exact profile and 16 kHz mono packed PCM, in-grant unrelated renderer denial, device release and transcript ownership. Focused build-mode release/instrumented compile passed 2 tests. Release-notes audit passed with the expected CHANGELOG warning because composer UI is scoped to #341.
- 2026-11-20 validate: Final WSL2 package:test exit 0 (AppImage and deb), current unpacked ASAR smoke exit 0 with exact profile, mono 16 kHz packed PCM duration, in-grant authorization, track release and session-owned transcript. Native Windows and Ubuntu 24.04 under WSL2 package reports and smoke receipts retained in evaluation-outputs/dict-02.
- 2026-11-20 validate: final: python .agentic/aegis.py check --task TASK-91f2fb57 --strict --run exit 0. Lint, TypeScript, i18n and help passed; release notes audit and git diff --check also passed. Advisory warnings cover legacy metadata and context sizes, linked tests/mock and documentation classified by generic layout globs, and binary scanning limits for the four documented synthetic WAV inputs. The scope excludes native Ubuntu and physical microphone proof on these hosts.
- 2026-11-20 validate: Handover: verified HEAD and empty Git index. The coordinator has authority for one local commit. Removed the Windows staging, downloads and temporary runtime output and the owned Linux execution mirror. Retained proof, the verified Whisper model fixture cache and the signed Microsoft runtime cache for #341 and the epic gate.
- 2026-11-20 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-91f2fb57.md
changed: DICT-02 validated for coordinator commit on ddp/epic-338
evidence: Both reviews approved. Strict AEGIS, focused tests, real multilingual workers and current Windows/WSL2 packaged fixture smoke passed.
issues: Native Ubuntu and physical microphone acceptance remain open. Full suite reserved for the epic gate.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-SEC-250c645c - Deny renderer permissions
  - REQ-FUNC-907c9538 - Resolve verified transcription input
  - REQ-SEC-dc8304bd - Permit gesture-scoped microphone access
  - REQ-FUNC-a5c31d08 - Return local Whisper transcripts
  - REQ-FUNC-179d51e4 - Detect the spoken language offline
  - REQ-FUNC-af174598 - Honor the chosen spoken language
  - REQ-REL-b6181cdf - Hold one dictation job
  - REQ-FUNC-31029892 - Normalize dictation audio
  - REQ-REL-152d1f1a - Reject out-of-range dictation audio
  - REQ-REL-c4f6b8d8 - Report empty dictation
  - REQ-REL-5b35e39e - Report an unavailable microphone
  - REQ-REL-7fc5b118 - Report denied microphone access
  - REQ-REL-6d0054e3 - Report a disconnected microphone
  - REQ-REL-ff7bba69 - Report an unavailable dictation model
  - REQ-REL-4e42542c - Report a failed dictation worker
  - REQ-REL-47f336ff - Invalidate ended dictation jobs
  - REQ-DATA-7c5ad4db - Keep dictated audio transient
- deviations: 1 recorded
  - validate: native Ubuntu and physical microphone acceptance remain open - the available Linux host is WSL2 and both host checks use controlled fixture audio. The sandboxed Electron and package paths are exercised.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 127ab01: 65 file(s) changed, 2269 line(s) added; 4 file(s) not content-scanned
- checks: errors=0 warnings=41 notes=42
- checklist: 9/9 done
