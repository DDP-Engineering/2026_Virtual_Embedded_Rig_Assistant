# TASK-13cdba36 - IMG-04 Images in the transcript (Gitea #296)

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-9c6aa149, REQ-UX-482d2ced, REQ-UX-16e08c34
parent:
branch: ddp/epic-292
base: 8c11cb69d14a6d48667ab455ba5b51745d7a9608
opened: 2026-11-19

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

Problem: STATED Gitea #296 says sent images must stay visible in the conversation.
Desired outcome: STATED User-message images appear as thumbnails that open in the workbench file viewer. A missing file shows its persisted path.
Actors: STATED A VERA user reading a workbench conversation.
Primary scenario: STATED Send an image, restart VERA, open the conversation and select the restored thumbnail, then revisit after deleting the file.
Examples: STATED The IMG-04-A restart and deletion case from issue #296. INFERRED Exercise both an imported screenshot and an existing workbench image.
Counterexamples: STATED When the file is missing, show its path in place of its thumbnail.
In scope: STATED User-message thumbnails, image viewer activation, missing-file paths, native proof and localized Chat Help and release copy.
Out of scope: STATED IMG-05 agent tool and changes to message persistence or model requests from preceding work packages.
Constraints: STATED Use ddp/epic-292 in the existing sibling checkout. The user authorized one local commit by the coordinator after validation. Use the focused verification policy and preserve workbench confinement and Display privacy.
Success signals: STATED IMG-04-A. The viewer opens the selected thumbnail and the text of a missing attachment remains visible alongside any surviving thumbnails.
Evidence: OBSERVED IMG-02 persists paths in session events and projects them onto user items. The pinned base already provides the windowed image viewer and IMG-03's bounded raster thumbnail transform.
Assumptions: INFERRED The renderer can use a transient preview derived from the current workbench file. Persisted attachment paths remain authoritative.
Unknowns: UNKNOWN No outstanding product decisions identified.
Decision-blocking questions: None.
Proposed behaviors: None outside the recorded scope.

## Requirement coverage

| Requirement | Behavior | Design | Proof |
| --- | --- | --- | --- |
| REQ-UX-9c6aa149 | STATED Show thumbnails on user messages | Near-viewport row and bounded Display IPC | Send an imported PNG and a workbench JPEG, observe each decoded thumbnail, restart Electron with the same workbench and profile, and observe both again. |
| REQ-UX-482d2ced | STATED Open transcript images in the file viewer | Existing Rendered image viewer | Activate the restored thumbnails by keyboard and pointer and verify the viewer decodes each selected source at its original dimensions. |
| REQ-UX-16e08c34 | STATED Show unavailable transcript image paths | Display path returned for unavailable previews | Delete the imported file after observing it following a restart, revisit the chat, and verify its original path appears while the surviving image still decodes. Repeat for a missing path subject to Display masking. |


## Design

**Approach.** REQ-UX-9c6aa149 derives bounded thumbnails from the durable user-message image paths when their rows are near the viewport. The thumbnail loader reuses the composer raster transform. The viewer receives the ordinary document path and selected raster format, and opens its existing Rendered view (REQ-UX-482d2ced).

**Interfaces and data.** Renderer-only message event and snapshot projection uses existing Display document identities for image paths. An opaque alias token preserves the saved spelling for the label and for resend, while document reads and viewer opening use the normalized path. The new docs.imageThumbnail IPC reads workbench-confined byte windows for an unchanged raster up to the chat image byte limit, applies Display byte masking and returns only the public path, display label and optional small PNG with the original raster format. REQ-UX-16e08c34 shows the display label when preview is unavailable. The labels and previews refresh on workbench Display changes and at shell focus or chat revisit.

**Files and test seams.** Add the transcript image row component, wire it to user items and the existing file viewer, and add the thumbnail IPC contract, DisplayDocuments handler, renderer projections and browser mock. A focused native test covers the imported and pre-existing file paths, restart, viewer rendering, deletion and Display masking. Focused source and contract tests cover read bounds and access.

**Risks and open decisions.** Bytes remain transient and bounded. Workbench identity, path guards and per-read revisions prevent cross-workbench and changed-file content. Thumbnail URL ownership stays in the visible row. Preview bytes remain outside React state, and offscreen rows revoke their resources without changing placeholder geometry. Stale requests cannot publish after cleanup. The existing CSP and persisted formats apply.

**Requirement map.** REQ-UX-9c6aa149 maps to the lazy row and bounded IPC. REQ-UX-482d2ced maps to the existing view tab in Rendered mode. REQ-UX-16e08c34 maps to the unavailable thumbnail reply and its masked path label.

Diagrams: [diagram_TASK-13cdba36.md](diagram_TASK-13cdba36.md)


## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: The user authorized one local commit by the coordinator after validation. The implementer hands back the unstaged candidate against base 8c11cb69d14a6d48667ab455ba5b51745d7a9608 on ddp/epic-292.
- 2026-11-19 frame: completed; next specify
- 2026-11-19 specify: completed; next design
- 2026-11-19 design: completed; next build
- 2026-11-19 build: red: pinned npm run test:e2e -- --serial-only transcript-images.spec.ts exit 1. Native paste and send completed, and the first user-message thumbnail was absent as expected (REQ-UX-9c6aa149, REQ-UX-482d2ced, REQ-UX-16e08c34).
- 2026-11-19 build: green: pinned Windows Vitest (11 focused files including Display, transcripts, IPC, composer and boundaries) exit 0, 116 passed. Browser composer-images.spec.ts exit 0, one test verifies the sent thumbnail and file viewer. Windows native transcript-images.spec.ts exit 0, IMG-04-A passed with imported PNG and opaque-path JPEG, full restart, keyboard activation and focus return, full-size viewing, deletion on return to Chat and a masked missing path. The native composer regression also passed.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: WSL2 Ubuntu 24.04: pinned setup and Node 24.21.0; Vitest Display documents, image source/viewer and composer image files exit 0 with 33 passing. Focused sandboxed Electron transcript-images.spec.ts exit 0, covering IMG-04-A on Linux. The task-owned Linux mirror was removed after testing.
- 2026-11-19 validate: Both independent reviewers found that valid lexical image aliases were passed unchanged to Docs, which denies dot or empty path segments; a sensitive component could also prevent decoding the alias. Quality review found that visited offscreen rows retained base64 thumbnail payloads.
- 2026-11-19 validate: returned to build - Preserve exact persisted image labels while resolving lexical aliases for confined viewer reads, and release thumbnail bytes when rows leave the viewport.
- 2026-11-19 build: Round 1 red: the focused Vitest viewport test exited 1 because an old preview was reconstructed while the new read was pending. Native transcript-images.spec.ts exited 1 because the accepted, secret-bearing aliased JPEG had no thumbnail.
- 2026-11-19 build: Round 1 fixes green: pinned Windows Vitest 118 cases across 12 focused files passed (exit 0). The new renderer regression confirms an offscreen URL is released and a fresh read is required on return. Scoped Windows Electron ran transcript-images.spec.ts and composer-images.spec.ts (2 passed; exit 0). IMG-04-A now proves a secret-bearing dot/repeated-separator alias opens after full restart and its saved spelling is shown after deletion, with and without Display masking. Focused Chromium composer and sent-thumbnail viewer passed (exit 0).
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Round 2 WSL2: pinned Vitest for Display documents and transcript-image lifecycle passed 16 cases (exit 0), and the scoped sandboxed Electron transcript-images.spec.ts passed the revised IMG-04-A check (exit 0). The owned mirror and transfer archive were removed.
- 2026-11-19 validate: Independent round 2 specification and implementation-quality reviews approved the complete unstaged candidate against 8c11cb69d14a6d48667ab455ba5b51745d7a9608. Both confirmed alias handling and the quality review confirmed offscreen resource release.
- 2026-11-19 validate: Round 2 strict AEGIS exited 1 because the new viewport test mock subclass lacked the TypeScript override modifiers on its URL statics. Lint, i18n and Help passed. Correct the test type declarations and keep the renderer-specific identity notes in the IPC knowledge page to preserve the session knowledge size budget.
- 2026-11-19 validate: returned to build - Correct test-only TypeScript override modifiers and move renderer identity documentation to the IPC page.
- 2026-11-19 build: Windows pinned Vitest for transcript-images.test.ts passed after the test-only override correction (exit 0). JavaScript and all acceptance inputs are unchanged. Prior Windows and WSL2 focused and native receipts still cover the shipped behavior.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Independent round 3 specification and quality reviews approved the complete candidate after the test type and knowledge-page corrections.
- 2026-11-19 validate: Final: python .agentic/aegis.py check --task TASK-13cdba36 --strict --run --full exited 0. Lint, typecheck, i18n and Help passed. The 42 advisory warnings and 38 notes cover historical records, mandated Help/release paths outside the generic globs, support-file traceability and the synthetic path-masking test credential. Pinned check:release-notes and git diff --check exited 0. Original proof logs are under 05_Software/evaluation-outputs/img04.
- 2026-11-19 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-13cdba36.md
changed: Transcript thumbnails, file viewer activation, and saved-path fallback with four-language Help and release notes
evidence: IMG-04-A passed on Windows and WSL2 Electron. Windows Vitest 118, Chromium 1 and Electron 2 passed. WSL2 affected Vitest 16 passed. Strict AEGIS, release notes and diff checks passed.
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-19)

- stage: validate; type: feature; branch: ddp/epic-292
- requirements:
  - REQ-UX-9c6aa149 - Show thumbnails on user messages
  - REQ-UX-482d2ced - Open transcript images in the file viewer
  - REQ-UX-16e08c34 - Show unavailable transcript image paths
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 8c11cb6: 40 file(s) changed, 947 line(s) added
- checks: errors=0 warnings=42 notes=38
- checklist: 9/9 done
