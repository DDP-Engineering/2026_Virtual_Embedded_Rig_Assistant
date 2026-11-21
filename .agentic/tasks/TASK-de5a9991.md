# TASK-de5a9991 - Desktop Files staged and unstaged Git diff tabs (#366)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-da6632e8, REQ-SEC-aacbd514, REQ-SEC-0634fcfa, REQ-REL-c097dfac, REQ-UX-ca8791b8, REQ-UX-c4e574c0
parent:
branch: ddp/epic-338
base: 44d98ba4ada4875c04f62faad2d8617d0b482cda
opened: 2026-11-21

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

Problem: STATED (#366): Files users need to inspect staged and working-tree changes while staying in Chat.
Desired outcome: STATED (#366): each applicable comparison opens in a distinct central document tab with readable hunks or a localized notice.
Actors: STATED (#366): Desktop users inspecting a Git-enabled workbench.
Primary scenario: STATED (#366): open the Files context menu by keyboard, compare both states of one path, and return to the unchanged Chat draft and scroll.
Examples: STATED (#366): virtual deletions, in-scope rename endpoints, staged additions on an unborn branch.
Counterexamples: STATED (#366 and delegation): untracked files use the ordinary viewer; nested and out-of-scope paths may not yield patches.
In scope: STATED (#366 and delegation): isolated Git reads, active lease and literal identity checks, masking, localized menu and patch presentation, focused proof, and a design note for future Changes reuse.
Out of scope: STATED (#366–#367 and delegation): Git writes, history, changes to the existing VERA Changes panel, and agent/plugin execution.
Constraints: STATED (delegation): edit only the sibling checkout at 44d98ba4, leave the candidate unstaged, preserve version 1, and hand off to the coordinator, who is authorized to commit and close #366.
Success signals: STATED (#366): independent comparison actions and tabs; shared keyboard navigation, close and reorder; unchanged Chat and ordinary viewers; bounded, masked, confined output.
Evidence: OBSERVED: the sibling is clean at the requested commit; GitReader, the Files Git overlay, TreeMenu, DocumentViewerProvider and DiffViewer are present at that base.
Assumptions: INFERRED (#365 and #366): the same supported repository and Git installation policy applies.
Unknowns: UNKNOWN: final WSL2 and Electron runtime readiness until focused validation.
Decision-blocking questions: None.
Proposed behaviors: Use a narrow typed diff request and keep Git results scoped to the active workbench activation.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Read staged and unstaged file comparisons | REQ-FUNC-da6632e8 | Private staged/worktree operation |
| Confine unattended file comparisons | REQ-SEC-aacbd514 | Literal path and raw rename admission |
| Bind and mask Git comparison responses | REQ-SEC-0634fcfa | Lease-owned request and Display projection |
| Explain unavailable Git comparison content | REQ-REL-c097dfac | Typed bounded result and patch view |
| Offer applicable Git comparisons in the Files menu | REQ-UX-ca8791b8 | Single keyboard submenu |
| Open comparison tabs beside Chat | REQ-UX-c4e574c0 | Typed transient central target |

## Design

### Approach

- REQ-FUNC-da6632e8, REQ-SEC-aacbd514: Extend GitReader's private metadata path with a named comparison operation. Validate the portable selected path and its physical parents. Inspect bounded raw changes with rename detection to identify legitimate comparisons and prevent disclosure of a rename across the selected scope. The staged inventory can inspect repository index and HEAD metadata. The unstaged inventory stays inside the workbench. Neither accepts renderer-supplied Git arguments.
- REQ-SEC-0634fcfa: Main resolves the Files Display identity after admitting the workbench ID, index lease and opt-in. Recheck ownership after the read, cancel on retirement, and apply the current Display scrub to patch text and source labels before IPC. Bounded responses describe only the selected comparison.
- REQ-REL-c097dfac: Render confined, bounded text with DiffViewer. Use explicit localized states for binary, oversize, conflict, empty and unavailable results. Name the empty base for unborn staged comparisons.
- REQ-UX-ca8791b8, REQ-UX-c4e574c0: DocsTree composes applicable Git actions into a single TreeMenu submenu alongside the existing file actions. Virtual change rows offer Git actions only. A distinct Git diff ViewerTarget is scoped to the current activation and comparison. It shares tab selection, ordering and close behavior, and Chat remains mounted.

### Interfaces and data

- New git.diff request takes the active workbench ID, lease, path identity and staged or unstaged selector. The result echoes ownership, identity and selector and carries masked display path plus comparison context and either a bounded patch or a typed notice.
- Git comparison tabs are transient. They reread through the current lease after an explicit re-open and discard obsolete read results. Ordinary stored tabs keep their existing format and load path.

### Files and test seams

- Real Git fixture tests exercise the operation, hostile config, confined rename pairs and path spellings. Service and Display tests establish current ownership and masking. Document menu and native Desktop tests exercise virtual rows, keyboard navigation, coexisting viewers and preserved Chat state.

### Risks and open decisions

- Reuse the supported Git layout restrictions, disable external diff/textconv explicitly, and cap bytes, render size and duration. Nested markers, symlinks and gitlinks under the selected path are excluded. Binary and invalid UTF-8 content are reported without displaying bytes.
- History can add a distinct typed target and a new TreeMenu child through the same seams. It needs its own main-owned tracked path operation.
- VERA Changes can use a separate central target keyed by workbench activation, session and change ID. A future scoped changes.get must validate both ownership and identity in main before projecting the masked tracked change into the same patch presentation. The recorded patch already lives in the session change store, so its adapter can reuse PatchDocument without running Git. Keep the existing list, selection and Reveal action in Changes until a separate UI change is approved.

### Requirement map

- The requirement table maps each behavior to its owning design seam.

Diagrams: [diagram_TASK-de5a9991.md](diagram_TASK-de5a9991.md).

## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: User authorized the coordinator to make the single local ticket commit after validation. The implementation chat leaves the candidate unstaged.
- 2026-11-21 frame: completed; next specify
- 2026-11-21 specify: completed; next design
- 2026-11-21 design: completed; next build
- 2026-11-21 build: red: pinned Vitest safe-diff.test.ts exit 1, six fixture assertions reach the missing GitReader.diff operation (comparison, confinement, typed notices); receipt git-red.log
- 2026-11-21 build: red: pinned Vitest display-documents.test.ts -t masks Git source exited 1 at missing DisplayDocuments.gitDiff; receipt display-red.log
- 2026-11-21 build: red: pinned Vitest docs-tree.test.ts focused Git scenarios exited 1, both invocations reached the missing Git submenu; receipt renderer-red.log
- 2026-11-21 build: green: pinned Windows Vitest renderer Git increment 2/2 and release-notes exit 0. WSL2 focused 105/105 plus affected Git and contract rerun 7/7, all exit 0. Receipts renderer-green.log, notes.log, wsl-focused-1.log, wsl-affected.log.
- 2026-11-21 build: green: native Windows Desktop git-diff-tabs.spec.ts passed 1/1 on the reviewed flow, including exact draft and scroll, TXT/PDF coexistence, keyboard reorder, virtual deletion and a copied-ID lease rejection. Receipt native-4.log. Rebuilt final input check in progress.
- 2026-11-21 build: Build evolution matches scope. Task-scoped AEGIS check reported no errors; layout and historical trace advisories do not affect proof. Original failed setup, fixture and timeout receipts retained.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: Round 1: both independent reviewers verified all 53 manifest entries. Findings: file-to-folder deletion menu and exact patch with a staged child, rendered notice coverage, known unborn base on read failure, and retired comparison opener references.
- 2026-11-21 validate: returned to build - Fix the replacement-path action and patch, preserve failure context and retire cached UI references. Add missing notice proof.
- 2026-11-21 build: red: pinned Windows Vitest review-round-1-red.log exit 1, four expected failures reproduce exact file/directory replacement, missing folder action, lost unborn failure context, and stale opener reference. The content-free notice test passed against existing rendering.
- 2026-11-21 build: green: round 2 affected Vitest passed 78/78 on Windows and WSL2, and native Windows Electron passed 1/1, including the staged deletion under a replacement folder with a staged child. Receipts windows-round-2.log, wsl-round-2.log, native-round-2.log. Reuse unchanged broader focused proofs.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: Round 2: both reviewers verified all 54 manifest entries. Specification approved. Quality found two remaining replacement-edge cases: isolated A/D reads could rediscover a rename with fewer candidates, and a confined rename query could include staged descendants.
- 2026-11-21 validate: returned to build - Use exact file operands for the final patch and keep the admitted comparison classification.
- 2026-11-21 build: red: pinned Windows Vitest review-round-2-red.log exit 1, both narrow read cases returned unavailable despite an admitted deletion or rename.
- 2026-11-21 build: green: final exact operands and admitted rename semantics passed the 28/28 focused Git tests on Windows and WSL2. The two earlier failing scenarios cover re-pairing an admitted deletion and overlapping rename trees with a path containing bracket characters. Original receipts windows-round-3.log and wsl-round-3.log.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: Round 3: both independent reviewers verified all 54 manifest paths and approved. The final native Windows Desktop rebuild passed 1/1 in native-round-3.log. Windows and WSL2 each passed 28/28 Git tests in round 3, with 78/78 affected tests per platform in round 2 and the unchanged broader focused results retained.
- 2026-11-21 validate: Final strict attempt exited 1. Lint, typecheck and help passed. The i18n checker could not register indirect Git diff translation calls. Original receipt final-strict.log.
- 2026-11-21 validate: returned to build - Use literal translation calls registered by the existing catalog checker.
- 2026-11-21 build: green: the unchanged catalogs now pass check:i18n with literal translation calls, and Windows renderer regressions passed 4/4 (i18n-correction.log, renderer-i18n.log). The final candidate changes only translation invocation at three renderer call sites.
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: Round 4: both independent reviewers verified 54 manifest entries and approved the literal translation calls, unchanged catalogs and 4/4 affected renderer proof. The final native rebuild passed 1/1 (native-final-i18n.log). Prior Windows and WSL2 Git receipts still apply.
- 2026-11-21 validate: Removed owned Windows runner selection scratch and the verified WSL2 mirror after use. Kept original logs, Playwright last-run records and review manifests in the ignored proof directory.
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-de5a9991 --strict --run exit 0. Lint, typecheck, EN/RO/DE/FR i18n and help passed. There were 54 nonpromoted layout, trace and historical-record warnings. Release notes and import boundaries passed in the unchanged focused proof. See strict-final.log.
- 2026-11-21 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-de5a9991.md
changed: 54-file Git diff tab candidate ready for the coordinator on ddp/epic-338
evidence: Strict AEGIS exit 0; native Windows 1/1; final renderer 4/4; Git 28/28 on Windows and WSL2.
issues: None blocking. Strict retained advisory trace, layout and historical-record warnings.
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: ddp/epic-338
- requirements:
  - REQ-FUNC-da6632e8 - Read staged and unstaged file comparisons
  - REQ-SEC-aacbd514 - Confine unattended file comparisons
  - REQ-SEC-0634fcfa - Bind and mask Git comparison responses
  - REQ-REL-c097dfac - Explain unavailable Git comparison content
  - REQ-UX-ca8791b8 - Offer applicable Git comparisons in the Files menu
  - REQ-UX-c4e574c0 - Open comparison tabs beside Chat
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 44d98ba: 54 file(s) changed, 1873 line(s) added
- checks: errors=0 warnings=54 notes=42
- checklist: 9/9 done
