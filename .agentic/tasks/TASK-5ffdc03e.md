# TASK-5ffdc03e - DICT-01 Dictation Settings and local Whisper model downloads

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-f01e59f6, REQ-SEC-563f025d, REQ-FUNC-8ed9892f, REQ-REL-3dbf3b83, REQ-REL-454e181b, REQ-SEC-111d8bb0, REQ-REL-fe7e398d, REQ-REL-844c26da, REQ-SEC-89fe1282, REQ-DATA-7b7bacd2, REQ-DATA-a4ee70a4, REQ-FUNC-e74a09bb, REQ-DATA-dfe09857, REQ-FUNC-907c9538, REQ-UX-67d8cc7b, REQ-REL-593c0785
parent:
branch: ddp/epic-338
base: bb55180dc737f7d8fdba52b51acc0c9dcac3b36e
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

Problem: STATED (#339) users need to provision local dictation models and choose the spoken language.
Desired outcome: STATED (#339) Settings exposes two pinned multilingual models, with verified install, selection, removal and retry.
Actors: STATED (#339) desktop user and future local transcription service.
Primary scenario: STATED (#339) download Small, select it, choose a language, restart and resolve a verified local model.
Examples: STATED (#339) cancel a Base transfer and retry it. Remove the selected model to clear selection.
Counterexamples: STATED (#338) microphone capture, shortcuts and draft insertion belong to #340/#341.
In scope: STATED (#339) desktop model management, app data, settings and typed service seam, four-language UI/help, focused tests.
Out of scope: STATED (#338, #339) capture, inference workflow, chat integration, recording settings, benchmarks and publication.
Constraints: STATED (delegation) use ddp/epic-338 at bb55180dc737f7d8fdba52b51acc0c9dcac3b36e. User authorized one local commit by the coordinator after validation. Implementer hands back the complete worktree. STATED (system architecture) keep the renderer sandboxed and I/O in main.
Success signals: STATED (#339) localized accurate state and sizes, atomic verification, cancel/retry, durable language/selection, clear active removal.
Evidence: OBSERVED Gitea #338/#339, git status and rev-parse, system architecture §8, UI architecture §9, settings service and Settings sections.
Assumptions: INFERRED (#338/#339 and current runtime) use compact q8 CPU ONNX assets, fixed anonymous HTTPS downloads and local paths in the main process.
Unknowns: None blocking.
Decision-blocking questions: None.
Proposed behaviors: None beyond ticket scope.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Show dictation model choices | REQ-UX-f01e59f6 | panel |
| Pin Whisper artifacts | REQ-SEC-563f025d | catalog |
| Install verified dictation models | REQ-FUNC-8ed9892f | store |
| Cancel dictation transfer | REQ-REL-3dbf3b83 | store |
| Recover interrupted model staging | REQ-REL-454e181b | store |
| Reject mismatched model bytes | REQ-SEC-111d8bb0 | store |
| Report insufficient model space | REQ-REL-fe7e398d | store |
| Report failed model transfer | REQ-REL-844c26da | store |
| Withhold corrupt installed models | REQ-SEC-89fe1282 | store |
| Persist installed model selection | REQ-DATA-7b7bacd2 | store |
| Persist spoken language | REQ-DATA-a4ee70a4 | store |
| Remove local model files | REQ-FUNC-e74a09bb | store |
| Clear removed selection | REQ-DATA-dfe09857 | store |
| Resolve verified transcription input | REQ-FUNC-907c9538 | store |
| Document dictation model management | REQ-UX-67d8cc7b | help |
| Retry locked dictation model removal | REQ-REL-593c0785 | store, panel |

## Design

### Approach

- OBSERVED: Transformers.js 4.3.1 loads configuration, tokenizer, feature extractor, encoder and merged decoder. Use the verified Xenova multilingual q8 revisions for both choices (REQ-SEC-563f025d).
- Keep the catalog and model store in main, with bounded streaming and anonymous HTTPS on a fixed origin/CDN allowlist. Verify sizes and hashes before publishing a staging directory by rename (REQ-FUNC-8ed9892f, REQ-SEC-111d8bb0).
- Use app-owned data with an exact directory inventory, rejecting links and unpinned files. Revalidate the selected model before returning a runtime directory (REQ-SEC-89fe1282, REQ-FUNC-907c9538).

### Interfaces and data

- A typed get/change IPC contract carries model summaries, progress and effective settings; local paths remain in the trusted main service for #340.
- A single transfer admits cancel until publication. Clean abandoned staging on first access, distinguish space, network, integrity and storage errors, and allow retry (REQ-REL-3dbf3b83, REQ-REL-454e181b, REQ-REL-fe7e398d, REQ-REL-844c26da).
- Persist an optional dictation patch in SettingsService, with null selection and auto detection defaults. Serialize model decisions and keep read-time availability separate from persisted selection (REQ-DATA-7b7bacd2, REQ-DATA-a4ee70a4).
- Move removals out of the installed namespace, clear active selection atomically through SettingsService, restore the directory on settings-save failure and keep locked cleanup retryable (REQ-FUNC-e74a09bb, REQ-DATA-dfe09857, REQ-REL-593c0785).

### Files and test seams

- Catalog, transfer and store live under desktop main/dictation. Tests use a small synthetic model tree and existing SettingsService on isolated storage.
- Shared dictation and settings schemas supply the IPC types. Settings query, mock, four catalogs and help support the new tab (REQ-UX-f01e59f6, REQ-UX-67d8cc7b).

### Risks and open decisions

- Match local CPU q8 loader inputs and permit only the verified artifact hosts. Capture and inference are downstream. The app singleton owns its model directory.
- Keep full file verification off the renderer, avoid repeated hashing on progress polls, and verify again at the runtime boundary.

### Requirement map

- The coverage table maps UX to panel/help proof, pins to catalog proof and storage/runtime requirements to the focused model lifecycle suite.


## Log

- 2026-11-20 frame: journal opened
- 2026-11-20 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-20 specify: completed; next design
- 2026-11-20 design: completed; next build
- 2026-11-20 build: red: focused desktop Vitest models.test.ts and dictation-settings.test.ts exit 1; implementation missing as expected
- 2026-11-20 build: green: focused Windows Vitest 8 files, 127 tests passed; subsequent model lifecycle and localized Settings action tests 2 files, 20 passed. No complete suite.
- 2026-11-20 build: Inspection: authoritative Hugging Face revision and file tree metadata, independent streamed digest of all 14 assets, live Windows store installation, 99 Whisper language tokens in both configs, offline settings reopen and removal all passed. Receipts: 05_Software/evaluation-outputs/dict-01/verified.json and live-win.txt.
- 2026-11-20 build: completed; next validate
- 2026-11-20 validate: Review 1: specification requires retaining all Bypass note semantics; quality requires retryable cleanup when a removal directory stays locked after deselection.
- 2026-11-20 validate: returned to build - Restore Bypass note details and keep pending deletion retryable after a storage fault.
- 2026-11-20 build: red: Vitest model lifecycle selector keeps a locked removal exit 1 with EPERM before exposing retry state.
- 2026-11-20 build: Review 1 fixes: Win32 model removal EPERM remains visible and retryable, with the model unavailable and redownload blocked. Both Workbench notes preserved verbatim, and merged Permissions copy preserves every Bypass rule. Focused Windows Vitest 3 files/31 passed; WSL2 Ubuntu 24.04 pinned-Node synthetic install, reopen and remove passed; release notes check passed.
- 2026-11-20 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-20 validate: Inspection: Read the four Settings help sections against the localized controls including retryable deletion; each documents both models, download progress and cancellation, selection and removal, and automatic/explicit language.
- 2026-11-20 validate: final: python .agentic/aegis.py check --task TASK-5ffdc03e --strict --run exit 0. Lint, TypeScript, i18n and help passed. 39 advisory warnings cover legacy records, generic layout globs for help/notes/CHANGELOG and requirement-path classification of linked tests, the browser mock and public barrel. Release-notes audit and git diff --check exit 0. Independent specification and quality approved at round 2.
- 2026-11-20 validate: Downstream #340: use DictationModels.resolveSelected for verified local directory, dtype q8 and Whisper language code or auto. Transformers.js 4.3.1 defaults to English for omitted language and auto detection belongs to the transcription runtime. Both pinned multilingual configs expose all 99 expected language tokens.
- 2026-11-20 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-5ffdc03e.md
changed: DICT-01 validated for coordinator commit on ddp/epic-338
evidence: Strict AEGIS exit 0; focused Windows, live pinned assets, WSL2 lifecycle and release notes passed; both reviews approved.
issues: Advisory repository warnings recorded; native Ubuntu and packaged acceptance remain at the epic gate.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-20)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-UX-f01e59f6 - Show dictation model choices
  - REQ-SEC-563f025d - Pin Whisper artifacts
  - REQ-FUNC-8ed9892f - Install verified dictation models
  - REQ-REL-3dbf3b83 - Cancel dictation transfer
  - REQ-REL-454e181b - Recover interrupted model staging
  - REQ-SEC-111d8bb0 - Reject mismatched model bytes
  - REQ-REL-fe7e398d - Report insufficient model space
  - REQ-REL-844c26da - Report failed model transfer
  - REQ-SEC-89fe1282 - Withhold corrupt installed models
  - REQ-DATA-7b7bacd2 - Persist installed model selection
  - REQ-DATA-a4ee70a4 - Persist spoken language
  - REQ-FUNC-e74a09bb - Remove local model files
  - REQ-DATA-dfe09857 - Clear removed selection
  - REQ-FUNC-907c9538 - Resolve verified transcription input
  - REQ-UX-67d8cc7b - Document dictation model management
  - REQ-REL-593c0785 - Retry locked dictation model removal
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base bb55180: 56 file(s) changed, 2073 line(s) added
- checks: errors=0 warnings=39 notes=41
- checklist: 9/9 done
