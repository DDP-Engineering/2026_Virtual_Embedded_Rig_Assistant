# TASK-d798dbc7 - BKM-02 Bookmark controls and rail preview (#305)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-f9086aa9, REQ-SEC-84cb1ada, REQ-UX-a3be2b11, REQ-UX-94b2ef16, REQ-UX-88f317e2, REQ-REL-16690ed0
parent:
branch: master
base: 5184f7d5265a1418b38b6a15abe1683a57174452
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

Problem: STATED (#305): bookmarks have persistence but no renderer controls; preview lacks the agent reply.
Desired outcome: STATED: synchronized message/card bookmark toggles, optimistic response and rollback with localized failure; title/reply preview.
Actors: STATED: desktop users in English, Romanian, German and French.
Primary scenario: STATED: hover or focus a user message, bookmark it, inspect/remove it in its rail card.
Examples: STATED: a multiline prompt uses its first line as card title and the start of its agent reply below.
Counterexamples: STATED: assistant messages have no bookmark action; read-only/archived sessions cannot mutate.
In scope: STATED: #305 controls, previews, translations/help, focused proof and current-state records.
Out of scope: STATED: #306 marker styles/group bookmark marks/shortcuts; migrations; agent awareness.
Constraints: STATED: shared master/default master; base 5184f7d5265a1418b38b6a15abe1683a57174452; full uncommitted candidate review. User authorizes local per-ticket commit, owned by coordinator; implementer must not stage/commit/push. Preserve unrelated PERF task and untracked bundled-plugins. No complete suite. OBSERVED: existing typed bookmark IPC and snapshot/event projection.
Success signals: STATED: BKM-02-A both controls agree; B failed IPC rolls back with error; C no Message N in card; hover/focus action and localized names.
Evidence: OBSERVED: tea issues 305/303; plan/chat-bookmarks.md; transcript.tsx, transcript-navigator.tsx, use-session-events.ts and chat-ui knowledge.
Assumptions: INFERRED: existing ErrorMessage/API error translation conventions suit bookmark failures.
Unknowns: Native Ubuntu availability; Windows/WSL2 evidence kept distinct.
Decision-blocking questions: None; authoritative ticket and coordinator instruction settle scope.
Proposed behaviors: None unaccepted.
Path and reason: Full, because new observable renderer behavior.

| Quick criterion | Holds | Evidence |
|---|---|---|
| no new externally observable behavior | no | #305 adds controls |
| no new interface/data format | no | new renderer controls |
| no new dependency | yes | existing React/Lucide/API |
| existing requirement covers behavior | no | new control contracts |
| no security/data handling change | yes | existing IPC authority unchanged |

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Immediate shared optimistic state | REQ-UX-f9086aa9 | useBookmarks overlay | deferred IPC component |
| Read-only/archive/pending lock | REQ-SEC-84cb1ada | shared disabled flag | component/native |
| Message icon and localized state | REQ-UX-94b2ef16 | Shared BookmarkButton | component/browser/native |
| Existing marker preview contract updated | REQ-UX-a3be2b11 | Title/reply card | existing navigation regressions |
| Title/reply card and keyboard reachability | REQ-UX-88f317e2 | Navigator card | navigator/browser/native |
| Optimistic agreement/rollback/error | REQ-REL-16690ed0 | useBookmarks overlay | deferred IPC component/native |


## Design

### Approach
REQ-UX-94b2ef16: add reusable BookmarkButton with Lucide Bookmark and translated state-aware name.
REQ-UX-f9086aa9 / REQ-REL-16690ed0: a transcript-owned useBookmarks hook overlays confirmed snapshot ids with per-message pending desired values; both controls consume that same projection. Serialize each message while pending; retain successful overlay until matching event/snapshot arrives. Failure restores the preceding projected value and shows ErrorMessage. Session change/unmount discards obsolete completions.
REQ-UX-88f317e2: build navigator messages in one linear pass over items, associate the first nonempty assistant response through immutable replyToMessageIds, expose title/reply card with the shared action. Preserve grouped selector navigation and marker ordinals. Card is a nonmodal accessible group, not an interactive tooltip. Focus/hover stay open; Escape returns focus to its marker.

### Interfaces and data
Use existing session.bookmark IPC and persisted events unchanged. REQ-UX-88f317e2: shared assistant snapshots carry optional derived replyToMessageIds frozen on first delta or terminal-only creation from current request usage.promptIds; current valid events without request usage use the last admitted user in transcript order at creation. Completion preserves the binding. Renderer has no positional fallback; pending prompts have no reply until admitted and answered. Metadata can bind shared replies to multiple admitted prompts. No core/runtime, stored event, format-version or migration change.
REQ-SEC-84cb1ada: existing transcript disabled flag and selected session-summary archived flag lock both actions; per-message in-flight guards prevent racing toggles. Confirmed snapshot remains authority after acknowledgement.

### Files and test seams
Shared session-state reducer/schema and its tests; transcript, navigator and new bookmark button/hook; styles.css; renderer component tests and focused browser/native bookmark acceptance; four locales/help (including fixed-key guidance in generate-help-shortcuts.mjs), release notes/changelog and plan/current-state records.
No dependencies, marker style changes or shortcut additions.

### Risks and open decisions
Avoid stale session promises, lost optimistic state before event delivery, and inaccessible interactive tooltips. Preserve memoized row identity and existing navigator scroll/focus behavior. No open product decisions.

### Requirement map
REQ-UX-f9086aa9 -> shared optimistic projection; REQ-SEC-84cb1ada -> disabled controls; REQ-UX-a3be2b11 -> existing preview contract; REQ-UX-94b2ef16 -> shared button and CSS; REQ-UX-88f317e2 -> card/projection; REQ-REL-16690ed0 -> optimistic hook and ErrorMessage.
Diagrams: [diagram_TASK-d798dbc7.md](diagram_TASK-d798dbc7.md).


## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: pinned vitest transcript-navigator.test.ts exit 1: new integrated test fails because message bookmark action is missing (REQ-UX-94b2ef16/88f317e2/REQ-REL-16690ed0); corrected test-file encoding separately
- 2026-11-16 build: OBSERVED: archive state lives in session summaries rather than snapshot; App passes selected archived summary to workspace transcript mutation guard. Existing IPC remains final authority.
- 2026-11-16 build: green: pinned vitest transcript-navigator/transcript-render/transcript-detail/workspace tests exit 0, 83 tests; includes optimistic agreement/rollback, delayed event acknowledgement, obsolete failures, four localized names, disabled controls, keyboard card and existing memoization behavior. Existing preview requirement updated to authorized first-line/reply contract.
- 2026-11-16 build: Scope seam: read help/tooling knowledge; shortcuts.md is wholly generated, so localized fixed-key card guidance belongs in existing generate-help-shortcuts.mjs words and generated pages. No shortcut registry change.
- 2026-11-16 build: green: pinned Playwright bookmarks.spec.ts browser exit 0 (en/ro/de/fr hover/focus visibility, title/reply/action, keyboard and agreement), native exit 0 (three bookmarks, real process restart and archived controls); instrumented VERA_TEST=1 npm run build exit 0. Existing session-navigation.spec.ts exit 0, 4 tests including 500-message grouping, streaming and detail/session geometry.
- 2026-11-16 build: green: pinned vitest transcript-navigator.test.ts + tooling help-shortcuts/help/boundaries exit 0, 41 tests after tool-interleaved reply assertion/help generator change; check:help exit 0; candidate Biome check14files exit 0 (78 nonblocking CSS specificity warnings). Tool generator Biome exit 0. Windows typecheck earlier exit 0; final strict statics pending review.
- 2026-11-16 build: Evolution reviewed: exactly renderer bookmark/preview/guard, tests, four locales/help, existing help generator, release notes, inventory, plan/current-state scope. No plugin/core/format/shortcut-registry changes; pre-existing bundled-plugins and PERF task preserved.
- 2026-11-16 build: DEVIATION validate: native Ubuntu acceptance unavailable in this Windows session; Windows Chromium and sandboxed Electron cover this UI ticket. Ubuntu WSL2 is available but is not native Ubuntu acceptance; no Linux result is claimed.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Coverage audit explicitly split immediate shared optimistic state (REQ-UX-f9086aa9) and read-only/archive/pending control lock (REQ-SEC-84cb1ada) from the initially grouped control/recovery coverage; accepted scope/design and existing red/green tests unchanged.
- 2026-11-16 validate: Final focused acceptance after ARIA semantics correction: VERA_TEST=1 pinned npm run build exit 0 (original log C:/Users/pasar/AppData/Local/Temp/vera-bkm02-build.log); pinned npx playwright test tests/e2e/bookmarks.spec.ts exit 0, both browser/native cases. No complete test suite run.
- 2026-11-16 validate: Review R1 quality/coordinator finding: queue before first active assistant reply steals preview; clearing pending would reassign again on replay. red: pinned focused vitest -t 'keeps a running reply|binds reply ownership' exit 1, both assertions fail for missing ownership metadata and wrong original preview.
- 2026-11-16 validate: returned to build - R1 reply ownership across queued delivery/replay requires stable derived snapshot association
- 2026-11-16 build: Read sessions knowledge for correction: immutable derived replyToMessageIds belongs in shared snapshot projection, copied from existing request usage.promptIds (or latest admitted user for current valid usage-absent events); preserves completion/live/durable replay and shared batch ownership. No stored event, core/runtime, format-version or migration changes. Renderer consumes association without positional inference.
- 2026-11-16 build: Review correction green: pinned vitest shared session-state + transcript-navigator + transcript-render + renderer mocks/sessions + core sessions/bookmarks + main session-bookmarks exit 0, 46 tests before final admitted-user cache refinement; latest focused replay tests exit0 (31). Request ownership is derived only in snapshots; storage/events/agent input unchanged.
- 2026-11-16 build: R1 correction final focused proof: pinned npmw.py npx vitest run shared/session-state, renderer transcript-navigator/transcript-render/mocks-sessions, core sessions/bookmarks and main session-bookmarks exit0: 6 files, 47 tests. Covers live pending ownership, later delivery, terminal-only durable replay, batched admitted prompts, usage-absent current events and agent isolation. Typecheck exit0; rebuilt VERA_TEST=1 app exit0.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: R1 correction acceptance: pinned npx playwright test tests/e2e/bookmarks.spec.ts exit0, 2 cases on rebuilt source (four-language browser controls/card and sandboxed native three-bookmark process restart/archive locks). Existing navigation geometry/stream/grouping proof remains valid for unchanged navigator handlers/styles.
- 2026-11-16 validate: Exact final focused command from 05_Software: python ../02_Tools/environment/npmw.py npx vitest run src/libraries/shared/src/session-state.test.ts src/apps/desktop/src/renderer/components/session/transcript-navigator.test.ts src/apps/desktop/src/renderer/components/session/transcript-render.test.ts src/apps/desktop/src/renderer/mocks/sessions.test.ts src/libraries/core/src/sessions/bookmarks.test.ts src/apps/desktop/src/main/session-bookmarks.test.ts -> exit0,47tests. Exact acceptance: python ../02_Tools/environment/npmw.py npx playwright test tests/e2e/bookmarks.spec.ts -> exit0,2tests; earlier immediate navigator command tests/e2e/session-navigation.spec.ts -> exit0,4tests. Build: VERA_TEST=1 python ../02_Tools/environment/npmw.py npm run build -> exit0.
- 2026-11-16 validate: R2 reviewers reproduce valid usage-absent recovered queue divergence: queued q, newer normal user u, delivered q, reply a selects q in fold but u live. Cache must preserve item order, matching a fresh snapshot scan.
- 2026-11-16 validate: returned to build - R2 cached ownership must agree with live item order after older recovered queue delivery
- 2026-11-16 build: R2 red: pinned vitest shared/session-state.test.ts -t 'keeps recovered queue ownership' exit1, fold q vs live u. Corrected cache to retain greatest admitted item index, initialize lazily from current snapshot and invalidate after item compaction; older delivered rows cannot overwrite a newer user.
- 2026-11-16 build: R2 correction green: pinned npx vitest run src/libraries/shared/src/session-state.test.ts src/apps/desktop/src/renderer/components/session/transcript-navigator.test.ts exit0,34tests. Both older recovered queue/new normal order and interrupted streaming-row removal have explicit fold-vs-live assertions. Cache uses ordered indices with invalidation; all prior pending/delivery/request-batch regressions remain green.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: R3 rebuilt acceptance: VERA_TEST=1 pinned npm run build exit0; pinned npx playwright test tests/e2e/bookmarks.spec.ts exit0,2browser/nativecases. Both independent reviewers approved R3 complete candidate; confirmed corrected pending/delivered/recovered/batched/interrupted reply ownership. No remaining candidate findings.
- 2026-11-16 validate: final: python .agentic/aegis.py check --task TASK-d798dbc7 --strict --run exit1: lint fails on two baseline format errors; typecheck/i18n/help exit0. Original log C:/Users/pasar/AppData/Local/Temp/vera-bkm02-strict.log. Targeted baseline Biome confirms exactly src/bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts (base/current blob953b4ea3eb9f249b88acc4202f42a2930273f04b).
- 2026-11-16 validate: DEVIATION validate: global final strict --run exits1 only on two preserved pre-existing formatting errors; accepted candidate-only Biome16files plus tool generator1file exit0, strict metadata exit0 (0errors,51unpromoted warnings), and remaining statics exit0 under delegated/project verification policy. No candidate lint errors; 79 nonblocking warnings. Release-notes check exit0 reused for unchanged notes/changelog. Native Ubuntu remains unverified, no Linux claim.
- 2026-11-16 validate: Handover: independent R3 verdicts approved; final focused reducer/component34tests and rebuilt browser/native2cases green, prior immediate consumers/tooling/navigation proof retained. No source edits after approved candidate/final strict proof. HEAD5184f7d5265a1418b38b6a15abe1683a57174452 master, empty index; no stage/commit/push/full suite. Coordinator owns authorized local commit. Native test roots close/remove in finally; original build/strict/lint logs and browser failure diagnostic retained under Temp.
- 2026-11-16 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-16 | decision=Implement #305 in autopilot on master; coordinator owns authorized local commit; implementer hands back without staging/commit/push | reason=User sequential cycle and delegated implementation instruction | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-d798dbc7.md
changed: BKM-02 controls, title/reply preview, optimistic rollback, immutable reply ownership, localized help/notes and records
evidence: Final focused34tests, browser/native2cases, R3reviews approved; scoped lint17files, typecheck/i18n/help/release-notes and strict metadata exit0
issues: Global strict --run exit1 only on two preserved baseline formatting errors; native Ubuntu unverified. Candidate ready for coordinator commit; no staging/commit/push/full suite.
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-16)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-f9086aa9 - Synchronize optimistic bookmark controls
  - REQ-SEC-84cb1ada - Lock bookmark controls for immutable sessions
  - REQ-UX-a3be2b11 - Preview a user message from its marker
  - REQ-UX-94b2ef16 - User-message bookmark controls
  - REQ-UX-88f317e2 - Conversation rail preview card
  - REQ-REL-16690ed0 - Optimistic bookmark failure recovery
- deviations: 2 recorded
  - validate: native Ubuntu acceptance unavailable in this Windows session; Windows Chromium and sandboxed Electron cover this UI ticket. Ubuntu WSL2 is available but is not native Ubuntu acceptance; no Linux result is claimed.
  - validate: global final strict --run exits1 only on two preserved pre-existing formatting errors; accepted candidate-only Biome16files plus tool generator1file exit0, strict metadata exit0 (0errors,51unpromoted warnings), and remaining statics exit0 under delegated/project verification policy. No candidate lint errors; 79 nonblocking warnings. Release-notes check exit0 reused for unchanged notes/changelog. Native Ubuntu remains unverified, no Linux claim.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 5184f7d: 53 file(s) changed, 1476 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=51 notes=38
- checklist: 9/9 done
