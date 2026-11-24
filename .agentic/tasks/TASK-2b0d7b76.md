# TASK-2b0d7b76 - Show Chat and an open tab side by side (#397)

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-09da4b2f, REQ-UX-83989235, REQ-UX-57b18a0a, REQ-UX-a45258b3, REQ-UX-d64f086f
parent:
branch: master
base: 3684009452618d098a053e3c5e58b25233cc2ecf
opened: 2026-11-24

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

Problem: STATED: #397 asks to read an open document or Git diff while following Chat. OBSERVED: The current tab strip switches one visible central pane; the mounted Chat panel is inert behind a document.
Desired outcome: STATED: Show Chat on the left and a chosen open tab on the right, support switching and resizing, preserve the open strip on exit, and keep both views reachable in narrow windows.
Actors: VERA desktop users following a conversation while reviewing evidence or edits.
Primary scenario: Open a file beside Chat from its tab menu, switch the right pane to a Git diff, drag the divider and return to a single pane.
Examples: Pinning and selecting an already open tab does not create a second copy. At narrow widths the existing strip still switches between Chat and the right-hand tab.
Counterexamples: The existing right accessory panel and the saved document-tab record keep their own responsibilities; split does not create additional persistent tabs.
In scope: Central session tab strip, two-pane layout, pointer and keyboard resize, narrow fallback, focus and Chat controls while split.
Out of scope: STATED: #397 concerns one document beside Chat. OBSERVED: The right accessory panel is a separate shell component. No multi-document splits or store changes.
Constraints: STATED: Implement on master. AGENTS.md authorizes one local ticket commit. Preserve per-folder and per-session tab ownership and loader checks.
Success signals: Open a real document and real Git diff in the right pane with Chat visible; resize, switch and exit while the same tabs survive; select each pane at a narrow window size.
Evidence: OBSERVED: Gitea #397 from tea, DocumentTabs overlay CSS, SessionWorkspace current Chat visibility guard, and existing Shell separator pointer/keyboard behavior.
Assumptions: INFERRED: Split is a presentation choice for the active session in the current application view.
Unknowns: None blocking.
Decision-blocking questions: None.
Proposed behaviors: None outside the ticket.

## Requirement coverage

| Requirement | Design | Proof |
| --- | --- | --- |
| REQ-UX-09da4b2f | Existing active tab in the right grid column with visible Chat | Chromium and Windows Electron Git diff |
| REQ-UX-83989235 | Recent ratio and accessible divider | Chromium pointer and keyboard |
| REQ-UX-57b18a0a | Toggle presentation only | Chromium retention and draft |
| REQ-UX-a45258b3 | Observed center width restores single-pane navigation | Chromium responsive geometry |
| REQ-UX-d64f086f | Escape transfers focus out of a document while Chat remains shown | Existing renderer focus and Chromium split focus |

## Design

**Approach.** DocumentTabs keeps its original tab strip, mounted Chat and one active document. A new document-split helper owns transient split intent for the exact session and resizes the CSS grid. The active document changes through the original selection flow. A tab menu action opens another document beside Chat, and the tab bar provides a visible toggle for the active document.

**Interfaces and data.** No saved format or IPC change. The measured center (separate from the right accessory panel) needs 640 CSS pixels to show both panes. The accessible separator clamps both panes to 280 CSS pixels and uses pointer capture or arrows/Home/End. Below the threshold, the current tab remains selected and the ordinary strip can select either pane. Widening resumes the requested layout when a document is selected. Chat remains mounted and interactive when visible. Chat features share actual visibility for thumbnail loading, navigation and bookmark jumps. Tab movement and close shortcuts read the focused pane. Reopening focuses the restored document. Escape and the Chat tab can return focus to Chat without replacing the visible document in a split.

**Files and test seams.** DocumentTabs, a document-split helper, SessionWorkspace visibility, CSS, four locales, help and release notes. Chromium covers real geometry, pointer and keyboard resizing, switching, exit and compact fallback. Existing Windows native Git tabs exercise real diff content. Renderer regression covers standard tabs, Plan and Chat.

**Risks and open decisions.** Preserve the existing selection, loaders, workbench lease, draft, and saved tab ordering. A change of session clears transient split intent. Show the Chat controls and guard focus according to visibility even with a selected document.

**Requirement map.** REQ-UX-09da4b2f owns the selected right pane, REQ-UX-83989235 the separator, REQ-UX-57b18a0a exit and REQ-UX-a45258b3 responsive fallback. REQ-UX-d64f086f retains normal Escape behavior plus a focus-only split path.

Diagrams: [diagram_TASK-2b0d7b76.md](diagram_TASK-2b0d7b76.md)

## Log

- 2026-11-24 frame: journal opened
- 2026-11-24 frame: completed; next specify
- 2026-11-24 specify: completed; next design
- 2026-11-24 design: completed; next build
- 2026-11-24 build: red: browser viewer-modes split selector exits 1 after reaching the open tab menu, which lacks Show beside Chat.
- 2026-11-24 build: green: Chromium viewer-modes split and centered tab search pass (2), covering pointer drag, keyboard resize and minimum, switching, Escape focus without hiding the right pane, compact fallback, exit and retained draft. Windows Electron git-diff-tabs passes (1) with staged and unstaged edits beside interactive Chat.
- 2026-11-24 build: Focused unit/integration run: 107 passed and one unrelated Settings list assertion failed. HEAD already contains the Permissions page and the unchanged Workspace settings test omits it in its expected array. Reran focused feature coverage with that exact stale test filtered. Release-notes, Biome on affected production files and i18n checks passed.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Round 1 findings: visible Chat in a split must continue lazy thumbnails, bookmarks and bookmark jumps. In Chat, tab shortcuts must not close or reorder the right document; reopening from the toolbar must focus the restored document rather than the first selected tab.
- 2026-11-24 validate: returned to build - Share actual Chat visibility and retain focus-sensitive tab actions in the split.
- 2026-11-24 build: red round 1: split thumbnail and bookmark unit checks fail because selected document hides Chat logically. The Chromium split keyboard check fails because the Chat composer shortcut reorders the right tab.
- 2026-11-24 build: green round 1 fix: six focused Vitest files pass 145 checks (one pre-existing Settings assertion filtered), the split and search Chromium scenarios both pass, and native Windows Git diff passes again. Verified active Chat prevents closing and moving the right tab, reopen focuses the document, and visible split Chat supports thumbnail fetch and bookmark commands and jumps. Hidden Chat still becomes selected for a bookmark panel jump.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Chromium bookmarks-tab browser regression passed after moving bookmark navigation visibility into the transcript hook.
- 2026-11-24 validate: Strict round 2 exit 1: TypeScript reports TS2352 at the two partial tab mocks in transcript-navigator.test.ts. Lint, i18n and help passed.
- 2026-11-24 validate: returned to build - Give the split bookmark test mock a typed view of the two tab fields it supplies.
- 2026-11-24 build: green round 2 correction: TypeScript exits 0 and the focused split bookmark navigation test exits 0 with the typed test stub. Product sources are unchanged from the approved review.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: final: python .agentic/aegis.py check --task TASK-2b0d7b76 --strict --run exit 0; lint, TypeScript, i18n and help passed. Release notes audit passed; 145 focused Vitest, 3 Chromium and 1 Windows Electron scenarios passed. A pre-existing Workspace Settings list expectation misses the Permissions page visible on the base commit and was excluded from the targeted pass. The 61 advisory warnings cover historical metadata, size/layout and scope heuristics and excluded pre-existing bundled plugin artifacts.
- 2026-11-24 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-24 | decision=Implement one validated local commit on master | reason=User requested #397 and AGENTS.md authorizes local ticket commits | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-2b0d7b76.md
changed: Implemented adjustable Chat plus open tab on the right with compact fallback
evidence: Strict AEGIS passed. 145 focused Vitest, 3 Chromium and 1 Windows Electron scenarios passed. Both reviews approved.
issues: An unchanged Workspace Settings assertion omits the Permissions page already present on the base commit.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-24)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-UX-09da4b2f - Open a tab beside Chat
  - REQ-UX-83989235 - Resize the Chat and document panes
  - REQ-UX-57b18a0a - Exit split view with the same tabs
  - REQ-UX-a45258b3 - Keep Chat and documents selectable in a narrow layout
  - REQ-UX-d64f086f - Move focus into and back from a document tab
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 3684009: 43 file(s) changed, 865 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=61 notes=44
- checklist: 8/9 done; open: `report` appended
