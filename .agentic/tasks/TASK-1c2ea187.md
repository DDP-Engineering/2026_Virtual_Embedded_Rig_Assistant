# TASK-1c2ea187 - Show document sources in the right panel

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-712804c9, REQ-UX-aa068a49, REQ-UX-b3231a55, REQ-UX-d64f086f
parent:
branch: master
base: 33e72b8c7611d3c36c287ca49dae0b6474338c8f
opened: 2026-10-31

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

Problem:
- STATED (user, 2026-10-31): agreed proposal 2 - the document viewer moves from a modal dialog
  into the right panel as a "Source" tab beside Docs/Context/Changes, one source at a time with
  a short list of recent sources, so chat and source are visible together.
- OBSERVED: DocumentViewerProvider (renderer documents/viewer-context.tsx) opens every source
  (citation chips, Docs rows/results, downloads) in a modal <dialog>, blocking the chat.
- OBSERVED: the right panel (components/shell.tsx) is resizable 14..28 rem and capped at 35vw
  (45vw below 1280px, where it overlays); widths persist in localStorage (lib/layout.ts).
Desired outcome: opening a source shows it in the right panel's Source tab (panel expanded,
  tab selected) with the conversation visible; the tab lists recent sources; while it is
  selected the panel can be widened up to 60% of the window.
Actors: the desktop user (mouse and keyboard); renderer only, no main-process change.
Primary scenario: the user clicks a citation chip; the Source tab opens beside the chat at the
  cited page; the user reads, widens the panel, opens a second citation, and goes back to the
  first through Recent sources.
Examples: a PDF page citation, a heading citation, a Docs search result, a download PDF.
Counterexamples: an invalid citation chip stays inert (no source opens).
In scope: Source tab and panel rendering of the existing viewer bodies; recent list; Source
  width; focus, Escape and Ctrl+F behavior in the panel; updating tests and e2e that assumed a
  dialog; knowledge pages.
Out of scope: several sources open at once (tabs); new formats; main-process or IPC changes;
  the Open in default app action itself (TASK-32aa9015, reused here).
Constraints: on master; no commits unless asked; renderer only; layout storage keeps version 1
  (a missing source width falls back to its default); accessibility as REQ-UX-28ad0002.
Success signals: renderer tests open a citation into the Source tab without any dialog, list
  and reopen recent sources, clear them on scope change, and widen within the Source range;
  native and browser e2e open citations, Docs results and downloads in the panel.
Evidence: renderer viewer-context.tsx, shell.tsx, App.tsx, lib/layout.ts, styles.css;
  tests documents.test.ts, workspace.test.ts, e2e citations/documents/office-documents/artifacts.
Assumptions: none.
Unknowns: none decision-blocking.
Decision-blocking questions: none open. Answered by the user before framing (RULING-001..003).
Proposed behaviors (accepted by RULING-001..003 unless marked):
- The modal dialog is removed; every source opens in the Source tab (RULING-001).
- While Source is selected the panel can be widened up to 60vw with its own stored width;
  other tabs keep 14..28 rem and 35vw (RULING-002).
- Recent sources: the last 10 distinct sources of the current session, newest first, cleared
  with the session/workbench/settings scope, not persisted (RULING-003).
- Not accepted, design detail: opening a source focuses the Source panel; Escape or "Close
  source" returns focus to the opener; Ctrl+F in a PDF source focuses its search.
Path and reason: full.
  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | panel instead of dialog |
  | no new interface or data format | no | layout field, Source tab |
  | no new dependency | yes | none |
  | an existing requirement already covers the behavior | no | REQ-UX-28ad0002 covers the viewer body, not its placement |
  | no security or data-handling change | yes | renderer layout only |

## Requirement coverage

| Behavior | Requirement | Source in Frame | Design |
|---|---|---|---|
| sources open in the right panel Source tab, no dialog | REQ-UX-712804c9 | RULING-001, desired outcome | provider without dialog + SourcePanel + Shell revision effect |
| last 10 sources per session, reopen, cleared with scope | REQ-UX-aa068a49 | RULING-003 | provider `recent`, reset with scope |
| Source tab widens to 60vw with its own width | REQ-UX-b3231a55 | RULING-002 | layout.source 20-90 rem, data-tab CSS cap |
| focus into the panel, Escape/Close back to the opener, Ctrl+F to PDF search | REQ-UX-d64f086f | proposed behavior (design detail) | one-shot focus request, panel key handler |

Revised: spec REQ-UX-4a040001.md (layout record gains `source`), spec pdf-downloads.md (downloads
open in the Source tab). REQ-UX-28ad0002 (viewer body, focus restoration) and REQ-UX-28ad0003
(Docs panel) keep their wording; their tests move from the dialog to the panel.

## Design

**Approach.**
- `DocumentViewerProvider` keeps owning the source state it has today (scoped selection,
  content, error, retry attempt, opener focus) and stops rendering a `<dialog>` (RULING-001).
  It adds `recent` (last 10 distinct targets, newest first; RULING-003) and a `revision`
  counter bumped on every open, and exposes them through a second context next to the
  existing `useDocumentViewer()` opener, so citation chips, Docs and downloads keep calling
  `open(target)` unchanged (REQ-UX-712804c9).
- New exported `SourcePanel` renders that state: a header (path, Open in default app from
  TASK-32aa9015, Close source), the existing `DocumentBody`/PDF viewer, load/error/retry, and a
  Recent sources list. Escape inside it closes the source and returns focus to the opener;
  Ctrl+F focuses the PDF search; a one-shot focus request set by `open` moves focus into the
  panel on the next render, so switching tabs never steals focus (REQ-UX-d64f086f).
- `Shell` gets a `source` slot and a Source tab. An effect on `revision` expands the right
  panel and selects Source. While Source is selected the panel uses `layout.source`
  (20-90 rem) and `data-tab="source"`, which CSS caps at 60vw instead of 35vw/45vw; the
  resizer reports the Source range (REQ-UX-b3231a55, RULING-002). `App` passes
  `<SourcePanel />`.
- `lib/layout.ts` adds `source` with a default (36 rem); the stored version stays 1 and an
  older stored layout parses with the default.
  Rejected: reusing `layout.right` for both widths (a wide Source width would widen Docs).

- Added during build (logged as scope): Shell keeps the tab a source was opened from mounted while
  hidden and returns to it on close, re-collapsing a panel that was collapsed, so focus can
  reach the opener (REQ-UX-d64f086f); any tab change by mouse or keyboard ends that return
  path; a scope change closes an open source without moving focus; when the opener is gone,
  focus goes to the visible tab (or the main content). PDF Previous/Next hand focus to each
  other at the first/last page; SourcePanel keeps focus already placed on the cited unit;
  Escape ignores IME composition.

**Interfaces and data.**
- `useDocumentSource()` returns `{target, content, error, attempt, recent, revision, closed,
  open, retry, close, restoreFocus, focusRequest}`; `restoreFocus()` reports "none", "focused",
  "pending" (opener hidden) or "lost" (opener gone); `recent` items are ViewerTarget values keyed by path, ref, downloadId or
  session/message/ref.
- Locales en/ro/de: `panel.source`, `documents.closeSource`, `documents.recentSources`,
  `documents.noSource`.
- Markup hooks: `[data-source-panel]` (tab content), `[data-source-current]` (a source is
  shown), `[data-action="close-source"]`, `[data-recent-source]`.

**Files and test seams.**
- renderer documents/viewer-context.tsx, shell.tsx, App.tsx, lib/layout.ts (+ layout test),
  styles.css, locales; documents.test.ts and Shell/workspace tests (panel instead of dialog,
  recent list, width range, focus); e2e citations/documents/office-documents/artifacts move
  from `.document-dialog` to the panel hooks.

**Risks and open decisions.**
- PDF canvases in a narrow panel: the page fits the panel width via the existing zoom; the
  browser layout e2e keeps checking no outer horizontal overflow.
- Many tests assumed a dialog; they move to the panel hooks without weakening assertions.
- No open product decisions.

**Requirement map.** As in the coverage table's design column.

Diagrams: [diagram_TASK-1c2ea187.md](diagram_TASK-1c2ea187.md)

## Log

- 2026-10-31 frame: journal opened
- 2026-10-31 frame: completed; next specify - scope accepted with RULING-001..003 (7 Done checklist item(s) left unticked)
- 2026-10-31 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-31 design: red: npx vitest run preferences/documents/workspace tests exit 1 - layout has no source width; a citation still opens a <dialog>; SourcePanel (recent list, focus return) does not exist (REQ-UX-712804c9, REQ-UX-aa068a49, REQ-UX-b3231a55, REQ-UX-d64f086f)
- 2026-10-31 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-31 build: green (renderer): npx vitest run src/apps/desktop/src/renderer exit 0 except pre-existing ('bounds large text DOM', Settings tab count) - Source width layout default/round trip; citation opens the Source tab without a dialog, composer enabled; Source resize range 20-90 rem with its own width, Docs back to 22 rem/28 max; recent list 10 newest-first, reopen moves to top, cleared on scope change; focus into the panel, Escape/Close source back to the opener; a source opened from Docs returns to Docs (kept mounted while hidden) and refocuses the row (REQ-UX-712804c9, REQ-UX-aa068a49, REQ-UX-b3231a55, REQ-UX-d64f086f). Older viewer tests and e2e selectors moved from the dialog to [data-source-current]/[data-action=close-source]. typecheck exit 0, lint 0 errors. Design addition: Shell returns to the tab and collapsed state the source was opened from
- 2026-10-31 build: scope: (1) Shell keeps the tab a source was opened from mounted while hidden and returns to it, re-collapsing the panel when it was collapsed, so Escape/Close source can refocus a Docs row - needed for REQ-UX-d64f086f once the source moved out of a modal; (2) PDF Previous/Next hand focus to the other button when they become disabled, found by citations.spec (focus fell to <body> after Next on the last page, where the panel's Escape cannot reach); (3) SourcePanel does not steal focus when the body already focused its cited unit (child effects run first when the panel mounts after content loads); (4) e2e: .document-dialog -> [data-source-current]; artifacts/plan specs select tabs by id instead of position; pdf-download.spec checks the Source tab instead of a centered dialog (no requirement asked for centering; REQ-FUNC-4c3f4f0c only requires the existing viewer); mock.spec also visits the Source tab; .download-viewer CSS removed
- 2026-10-31 build: green: typecheck exit 0; lint 0 errors; npx vitest run src/apps/desktop src/libraries/shared: 378 passed, 2 pre-existing failures (bounds large text DOM, Settings tab count); VERA_TEST=1 e2e citations, documents, office-documents, artifacts (native+browser), plan (native+browser), mock, keyboard-shortcuts, pdf-download all passed; full e2e suite running
- 2026-10-31 build: full e2e (VERA_TEST=1 npm run test:e2e): 67 passed, 7 failed outside this task - shell.spec x3 and compact-shell x2 wait for [data-action=create-workbench] on Welcome, which since the Stage 1 redesign (TASK-581e6591) appears only after a folder is chosen; chatgpt.spec (provider catalog evaluate) and session-reasoning (missing fixture reply 2) touch no viewer, panel or layout code. Recorded for the parent's validation; every spec this task touches passes
- 2026-10-31 build: evolution reviewed: 19 paths, all in the design's files list or the logged scope additions (pdf-viewer focus handoff, downloads.css cleanup, e2e selector moves); check errors=0
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: review round 1 quality: changes_required - (1) arrow/Home/End tab navigation keeps a stale return path (only clicks clear it); (2) a scope change (session/workbench/settings) with an open source leaves the panel on an empty Source tab, expanded, with stale return state; (3) when the opener is unmounted, focus falls to <body>; (4) Shell-level tests missing for collapsed return, keyboard tab navigation, scope change and lost opener; dead dialog polyfills; Escape ignores IME composition. Spec: changes_required - (1) 60vw cap untested; (2) specs/REQ-UX-4a040001.md layout record lacks source; (3) specs/pdf-downloads.md, knowledge pdf-downloads.md and renderer-foundation.md still describe a centered modal / old tab list; (4) no native Ctrl+F step; (5) REQ-UX-712804c9 verification overstates the Docs-row anchor and 'no dialog element'; (6) Design/interface not updated for the scope additions; (7) recent entries can repeat a ref cited in two messages (by design); Log attribution of shell/compact-shell failures imprecise
- 2026-10-31 validate: returned to build - round 1: keyboard tab return path, scope-change close, focus fallback, IME Escape, Shell-level tests, 60vw cap and native Ctrl+F e2e, spec/knowledge/Design updates
- 2026-10-31 build: red: npx vitest run documents.test/workspace.test -t 'IME|returns to where it was opened' exit 1 - Escape during IME composition closes the source; after arrow-key navigation to Changes the stale return path re-collapses the panel on close (REQ-UX-d64f086f, REQ-UX-712804c9)
- 2026-10-31 build: green (renderer): npx vitest run src/apps/desktop/src/renderer exit 0 except pre-existing - any tab change (mouse or arrow/Home/End) ends the return path; a scope change closes an open source and restores the tab/collapse without moving focus; a lost opener hands focus to the visible tab (or main content); a collapsed-panel citation closes back to a collapsed panel with the chip focused; Escape during IME composition is ignored; dead dialog polyfills removed from documents.test.ts. Spec fixes: REQ-UX-4a040001.md layout record and pdf-downloads spec/knowledge updated, renderer-foundation tab list, REQ-UX-712804c9/b3231a55 verification aligned, Design updated with the scope additions and the actual hook interface; e2e adds the 60vw cap (documents.spec) and native Ctrl+F (citations.spec). Log correction: shell.spec x3 expect create-workbench at launch (it now lives on the New Workbench page); compact-shell's second test drives Welcome and the rail, its cause is not create-workbench but it touches no Source code. lint 0 errors; typecheck exit 0. Pending: e2e for documents/citations (needs the dev app stopped)
- 2026-10-31 build: green (e2e): VERA_TEST=1 npm run test:e2e -- documents citations office-documents pdf-download artifacts plan mock exit 0 (9 passed) - incl. the 60vw cap and native Ctrl+F
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: review round 2: spec approved, quality approved. Low notes: (applied) documents.spec linked to REQ-UX-b3231a55; document-viewer.md describes the tab-change reset, scope-change close and lost-opener fallback; (kept) the IME test does not assert focus inside the panel first; recent entries per citation provenance; open_ ref written during render (idempotent, no transitions in the app)
- 2026-10-31 validate: DEVIATION validate: after round-2 approval the REQ-UX-b3231a55 linked_tests and the document-viewer knowledge page were updated as the reviewers asked - accepted without another round: requirement metadata and documentation only, no code or test changed
- 2026-10-31 validate: final: python .agentic/aegis.py check --task TASK-1c2ea187 --strict --run exit 0; lint ok, typecheck ok, i18n ok (tests not in [check] run; renderer vitest and the 9 touched e2e specs logged above); 138 warnings, none on this task or its requirements (uncovered-source and pre-existing journal/requirement warnings). Outside scope and recorded for the parent validation: full-suite e2e failures in shell x3, compact-shell x2, chatgpt and session-reasoning; pre-existing unit failures 'bounds large text DOM' and Settings tab count
- 2026-10-31 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-10-31 | decision=Remove the modal viewer; every source opens in a Source tab of the right panel | reason=user chose 'Dispare, totul in panou' | source=user | supersedes=none
- RULING-002 | date=2026-10-31 | decision=While the Source tab is selected the right panel can be widened up to 60% of the window; other tabs keep their limits | reason=user chose 'Pana la 60% pe tab-ul Sursa' | source=user | supersedes=none
- RULING-003 | date=2026-10-31 | decision=Recent sources: last 10 per session, cleared on session or workbench change, not persisted | reason=user chose 'Pe sesiune, ultimele 10' | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-1c2ea187.md
changed: 4 created, 0 revised
evidence: check --task TASK-1c2ea187 --strict --run exit 0
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-10-31)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-712804c9 - Open sources in the right panel Source tab
  - REQ-UX-aa068a49 - List and reopen recent sources of the session
  - REQ-UX-b3231a55 - Widen the right panel for sources
  - REQ-UX-d64f086f - Move focus into and back from the Source panel
- deviations: 1 recorded
  - validate: after round-2 approval the REQ-UX-b3231a55 linked_tests and the document-viewer knowledge page were updated as the reviewers asked - accepted without another round: requirement metadata and documentation only, no code or test changed
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 33e72b8: 174 file(s) changed, 9629 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=138 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
