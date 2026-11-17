# TASK-5bdc042a - VIEW-04 Hex mode (#289)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-94765114, REQ-FUNC-69596c3b, REQ-FUNC-b66d2d80, REQ-FUNC-53b3527c, REQ-REL-63f0f1cc, REQ-REL-a4d21663
parent:
branch: master
base: b33e44979a840b3a945316b4d43fed8e5631475a
opened: 2026-11-17

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

Problem: STATED issue #289: binary bytes cannot be inspected inside VERA.
Desired outcome: STATED bounded read-only Hex rows, offset navigation, cancellable text/hex Find and selection copy.
Actors: STATED ordinary workbench file viewer users.
Primary scenario: STATED open an ordinary file as Hex, navigate, search and copy Display-masked bytes.
Examples: STATED Done A sequence across a window boundary; Done B partial final row and nonprintable bytes.
Counterexamples: STATED citations retain verified original source/range; Hex does not decode citation text metadata.
In scope: STATED VIEW-04 only, four locales/help/release notes, minimum ordinary-file Hex access, focused proof.
Out of scope: STATED VIEW-05 automatic binary opening/applicability/preferences, VIEW-06 images; migrations; packaging.
Constraints: STATED shared master/default master; full base b33e44979a840b3a945316b4d43fed8e5631475a. Coordinator owns acceptance, authorized local commit and Gitea closure. User authorizes local commits, but this implementation chat must not stage or commit. Preserve unrelated workflow payload/root instructions, untracked bundled-plugins and PERF TASK-9a4d3e8a. No full suites. Scratch evaluation-outputs/view04 only.
Success signals: STATED Done A/B, focused regressions, meaningful browser/native acceptance, individual statics, candidate Biome, strict AEGIS and two independent reviews.
Evidence: OBSERVED issue289 and epic285 via tea issues <id> --comments --login ddp --repo dpasare/2026_Virtual_Embedded_Rig_Assistant; current HEAD matches base; document-viewer knowledge and byte-source implementation inspected.
Assumptions: INFERRED fixed bounded working buffers and per-scan yielding implement arbitrary file sizes without whole-file allocations.
Unknowns: native Ubuntu unavailable; unchanged confinement/masking/native packaging proof is reused as authorized.
Decision-blocking questions: None; coordinator explicitly delegates bounded selection policy and minimum access.
Proposed behaviors: None outstanding.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| When an ordinary workbench file is opened as Hex, the viewer | REQ-FUNC-94765114 | bounded byte source / Hex UI | hex-source.test.ts, hex-viewer.test.ts; hex-viewer.spec.ts |
| When a valid decimal or 0x-prefixed physical offset is submitted in Hex, the viewer | REQ-FUNC-69596c3b | bounded byte source / Hex UI | hex-source.test.ts, hex-viewer.test.ts; hex-viewer.spec.ts |
| When Find is submitted in Hex, the viewer | REQ-FUNC-b66d2d80 | bounded byte source / Hex UI | hex-source.test.ts, hex-viewer.test.ts; hex-viewer.spec.ts |
| When a Hex byte selection of at most 65536 bytes is copied, the viewer | REQ-FUNC-53b3527c | bounded byte source / Hex UI | hex-source.test.ts, hex-viewer.test.ts; hex-viewer.spec.ts |
| If Hex offset, hexadecimal query or selection exceeds its accepted bounds, the viewer | REQ-REL-63f0f1cc | bounded byte source / Hex UI | hex-source.test.ts, hex-viewer.test.ts; hex-viewer.spec.ts |
| If a Hex byte read or ownership/size/modified validation fails, the viewer | REQ-REL-a4d21663 | bounded byte source / Hex UI | hex-source.test.ts, hex-viewer.test.ts; hex-viewer.spec.ts |

## Design

### Approach
OBSERVED docs.stat/readBytes supply masked physical bytes independently of text/citation metadata.
REQ-FUNC-94765114: add HexSource with four 64KiB LRU windows; virtualize one local window and use a physical-byte slider for arbitrary file sizes without giant browser scroll heights.
REQ-FUNC-b66d2d80: incremental KMP over 64KiB scan chunks, query <=4096 bytes, constant retained hit state, next/wrap search, yielding and AbortSignal checks around IPC.
REQ-FUNC-53b3527c: selection stores two physical offsets; copy reads at most64KiB and uses the existing permitted execCommand clipboard route. UTF8 replacement decoding is explicit in help.
### Interfaces and data
REQ-FUNC-69596c3b: decimal/0x offset form, exact byte positioning. A textPath target gains optional hex:true; identical original file key, format1 storage, optional offset place. No per-extension preference.
REQ-REL-63f0f1cc: invalid offsets/hex patterns/selection bounds show localized feedback before operations. No file-size cap; only window/query/selection bounds.
REQ-REL-a4d21663: source validates owner/path/offset/size/exact byte count and stat modified; errors show Retry. Each viewer owns sources/abort controllers and ignores disposed operations. Existing provider attempts and live Display refresh remount Hex and clear caches.
The Files menu offers Show as Hex; ordinary Open returns to the usual viewer. citations retain their existing verified target/range and rendering.
### Files and test seams
New hex-source.ts/test, hex-viewer.tsx/test, hex-rows.tsx and scoped CSS; viewer-context/document-tabs/store/tree entry points; locales/help/release notes and inventories.
Focused tests exercise formatting, border Find, cancellation, validation, selection/copy and provider refresh. One browser/native acceptance uses an owned binary fixture.
### Risks and open decisions
STATED reuse unchanged host confinement/masking and native packaging proof; no byte host changes or delivery rebuild. Native Ubuntu unavailable. Selection copy and Find never access unmasked channels. No open product decisions.
### Requirement map
REQ-FUNC-94765114 -> source/virtual rows; REQ-FUNC-69596c3b -> offset form/slider; REQ-FUNC-b66d2d80 -> cancellable KMP; REQ-FUNC-53b3527c -> bounded selection/copy; REQ-REL-63f0f1cc -> input feedback; REQ-REL-a4d21663 -> validated reads/Retry.
Diagrams: [diagram_TASK-5bdc042a.md](diagram_TASK-5bdc042a.md)


## Log

- 2026-11-17 frame: journal opened
- 2026-11-17 frame: completed; next specify - Delegated autopilot scope recorded (7 Done checklist item(s) left unticked)
- 2026-11-17 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-17 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-17 build: red: pinned vitest hex-source.test.ts exit 1, five expected missing-behavior failures; original source-red.log in evaluation-outputs/view04; all six Hex requirements covered by source/UI increments
- 2026-11-17 build: green: pinned vitest hex-source.test.ts exit0, 5 tests; source-green.log. red: hex-viewer.test.ts exit1 expected missing Hex rows, ui-red.log
- 2026-11-17 build: green: Hex source/UI/store 13 passed in hex-final-focused.log; existing document-tabs32/tree18 passed in consumers-green.log, corrected tree1 passes tree-affected-final.log. native-acceptance5.log exit0: VIEW04A/B,16MiB+19bytes, displayed-window keyboard crossing, actual hex/text clipboard, live stored credential Display refresh during Find and en/ro/de/fr. Subsequent source identity adoption has focused regression; final source proof follows.
- 2026-11-17 build: green ready: pinned focused Hex source8/UI1/tab-store5/import-boundaries17=31 tests exit0, focused-ready.log; candidate Biome write exit0 format-final.log; native instrumented build exit0 native-build-ready.log. Reuse document-tabs32/docs-tree18 earlier passing proof plus corrected affected tree1. No full suites, plugin-system changes or packaging changes.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: native ready: native-ready.log exit0,1test11.2s, final source-aligned instrumented build. VIEW04A/B,16,777,235bytes,45mountedrows,608px viewport/86,030px bounded local scroll; actual clipboard; opaque original identity; live Display masks Find/copy during refresh; keyboard displayed-window crossing; fourlocales. Native screenshot visually inspected. Original native-receipt.json/native-hex.png retained; owned profile/workbench deleted after appclose. Both independent reviewers now reviewing complete owned candidate against recorded full base.
- 2026-11-17 validate: Independent current-candidate reviews approved: view04_spec_review (refreshed after four help EOF whitespace corrections) and view04_quality_review (includes those corrections), no actionable findings. All37owned paths against full recorded base; final proof next.
- 2026-11-17 validate: DEVIATION validate: final proof uses candidate-only Biome, individual typecheck/i18n/help/release-notes and strict AEGIS without --run, per coordinator instruction. Known unrelated global lint baselines excluded: untracked bundled-plugins/index.json and unchanged shared/src/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. No global lint pass claimed. Full app/plugin/E2E suites, native Ubuntu and exact-source delivery gates remain deferred. Plugin suite inapplicable to this renderer-only change. Reuse unchanged host confinement/masking/WSL2/native packaging proof; no delivery rebuild.
- 2026-11-17 validate: final: candidate Biome17files, npm run typecheck, check:i18n, check:help and check:release-notes each exit0 (final-*.log); python .agentic/aegis.py check --task TASK-5bdc042a --strict exit0,0errors61warnings38notes strictok (final-aegis.log), after both independent current-candidate approvals and last nonjournal edit. Warnings retained: existing oversized context/knowledge and historical record/ticket refs; repository layout classification for help/release notes/changelog; src test-file coverage heuristics despite linked passing tests; synthetic fixture credential literal; excluded user-owned bundled-plugins artifacts. No new product-source coverage gap or real credential is claimed. Native-ready1case passes; focused-ready31tests plus reused tabs32/tree18 and affectedtree1=82 relevant passing tests. Native Ubuntu/fullsuite/delivery gates deferred by coordinator policy.
- 2026-11-17 validate: completed; next done
- 2026-11-17 done: Handover cleanup limitation: automatic approval review rejected the command deleting only verified owned view04 node-compile-cache/playwright-transform-cache directories, stating blocked by policy with no further reason. Command did not execute; caches retained, no bypass attempted. Native processes/profiles already closed/cleaned by passing acceptance. Owned manifest generated separately.

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-5bdc042a.md
changed: VIEW04 complete;37owned paths ready unstaged/uncommitted for coordinator
evidence: Independent spec/quality approvals; focused31+reused51 tests; native1 acceptance; candidate Biome/typecheck/i18n/help/release notes and strictAEGIS exit0
issues: Deferred full suites/nativeUbuntu/exact-source delivery; known unrelated global lint baselines excluded;61 advisory AEGIS warnings documented
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-94765114 - Bounded hexadecimal file rows
  - REQ-FUNC-69596c3b - Hexadecimal offset navigation
  - REQ-FUNC-b66d2d80 - Cancellable byte sequence search
  - REQ-FUNC-53b3527c - Bounded hexadecimal selection copy
  - REQ-REL-63f0f1cc - Hexadecimal invalid input feedback
  - REQ-REL-a4d21663 - Hexadecimal failed read recovery
- deviations: 1 recorded
  - validate: final proof uses candidate-only Biome, individual typecheck/i18n/help/release-notes and strict AEGIS without --run, per coordinator instruction. Known unrelated global lint baselines excluded: untracked bundled-plugins/index.json and unchanged shared/src/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. No global lint pass claimed. Full app/plugin/E2E suites, native Ubuntu and exact-source delivery gates remain deferred. Plugin suite inapplicable to this renderer-only change. Reuse unchanged host confinement/masking/WSL2/native packaging proof; no delivery rebuild.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base b33e449: 68 file(s) changed, 2996 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=61 notes=38
- checklist: 9/9 done
