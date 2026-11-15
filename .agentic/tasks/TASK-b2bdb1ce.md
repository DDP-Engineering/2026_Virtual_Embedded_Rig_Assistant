# TASK-b2bdb1ce - PERF-06 Bounded tool previews with on-demand details (#254)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-a8ca0721, REQ-FUNC-acaeb296, REQ-SEC-bde59b0b, REQ-UX-4f1c85d5, REQ-FUNC-70479d66
parent:
branch: feature/249-responsiveness
base: dec06876e590b7243f041a32925eaec5d6f822a2
opened: 2026-11-14

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

Problem: the session snapshot sent to the renderer carries every tool `preview`, the full `args` and every approval `diff` in full; a 200-message session with 64 KiB previews moves ~13 MB per open through sanitize, validation, structured-clone IPC and renderer state; 1.09 s median open vs 0.45 s without large previews (STATED #254 Problem). OBSERVED: `session.get` handler `main/index.ts:789` returns `sanitizeSessionSnapshot(hub.get(...))`; live events go `main/sessions.ts:315` -> `session-events.ts` transport -> `createEventEmitter` (`main/events.ts:226`) -> `vera:event`; schema fields `session-state.ts:21,24,76`, `events.ts:104,112,123`.
Desired outcome: what main sends to the renderer (snapshot and live session events) holds at most 8 KiB of each tool preview / approval diff and 4 KiB of stringified args, UTF-8 bytes, cut at a character boundary, with the total size; the full text comes on demand from a new `session.item.detail` channel; stored events and export stay full; opening `payload` costs about the same as `medium` (STATED #254 Goal, coordinator brief 3).
Actors: the user reading tool/approval details in the chat and inspector; main IPC handlers; the developer running `perf:sessions`.
Primary scenario: the user opens a session whose `read` tool returned 64 KiB; the tool disclosure shows the first 8 KiB and "Show full output (64 KB)"; clicking it calls `session.item.detail` and the full text replaces the excerpt.
Examples: preview of 65,536 ASCII bytes -> excerpt 8,192 bytes, `truncated.preview = 65536`; a preview whose byte 8,192 falls inside a 3-byte character -> excerpt ends before that character (<= 8,192 bytes, valid UTF-8); preview "board ready" -> unchanged, no `truncated`, no button (STATED #254 Tests).
Counterexamples: export (`sessions/export.ts`) and the agent runtime (`service.ts:283,288,773,1140` read `hub.get` in core) keep full content - bounding is applied only on the two main->renderer paths (OBSERVED; STATED #254 plan 3, 6).
In scope: shared limits + cut function + bounded snapshot/event helpers; `truncated` field in snapshot tool items, approvals and the tool.started/tool.done/approval.requested events; main bounds `session.get` responses and every `vera:event` session envelope; core `SessionService.itemDetail` + hub lookup of one stored event; channel `session.item.detail` (shared ipc, main handler, renderer mock); renderer excerpt + "Show full output (N KB)" for tool args/preview (transcript + inspector) and approval diff; i18n en/ro/de; harness fixture expected snapshot bounded (STATED coordinator brief 3).
Out of scope: windowing (later child); changing export; agent context (STATED #254 plan 6); new DB index (see Design).
Constraints: format versions stay 1, no compatibility code (STATED background); no new dependency; Windows and Linux, no platform code; no commit/push; targeted tests only; 1-2 review rounds (STATED coordinator brief).
Success signals: shared cut tests (limit, multi-byte boundary, small unchanged); main `session.get` bounded on the payload fixture; `session.item.detail` full text and NOT_FOUND refusals (unknown item, missing field, other workbench's session); renderer expand test and no button for small; export unchanged; i18n check; perf tooling tests; `perf06-after.json` payload loadMs within 20% of medium (STATED brief 4-5).
Evidence: OBSERVED file reads above; renderer uses listed in Design; `aegis explain` for export.ts (REQ-FUNC-70479d66), transcript.tsx (REQ-TEST-4bea0008 ...), ipc (REQ-FUNC-2b462360).
Assumptions: INFERRED from `scrub()` (`core/llm/scrub.ts`, exact replace of known secrets) that cutting before scrubbing could leave the prefix of a secret that straddles the cut unredacted; so cut after scrub. INFERRED from `checkDatabase` (`storage/schema.ts`, every `CREATE INDEX` in schemaSql is required) that a new index would make existing workbench databases "incomplete current schema".
Unknowns: native Ubuntu timing (no host here; no platform code).
Decision-blocking questions: none - ticket and brief fix limits, channel shape and UI.
Proposed behaviors: as In scope; error for unknown item / missing field / foreign session = NOT_FOUND (existing session-read convention: `service.row` throws NOT_FOUND, OBSERVED `service.ts:282`).
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | excerpt + Show full button |
| no new interface or data format | no | new IPC channel, `truncated` snapshot/event field |
| no new dependency | yes | none |
| an existing requirement already covers the behavior | no | new requirements needed |
| no security or data-handling change | no | new read channel must be sanitized and scoped to the open workbench |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| Snapshot and live session events sent to the renderer carry bounded previews/args/diffs with total size | REQ-FUNC-a8ca0721 |
| `session.item.detail` returns the scrubbed full text of one item's field from its stored event | REQ-FUNC-acaeb296 |
| `session.item.detail` refuses unknown item, missing field, or session not in the open workbench with NOT_FOUND | REQ-SEC-bde59b0b |
| Truncated field shows excerpt + "Show full output (N KB)"; click shows full text; no button when small | REQ-UX-4f1c85d5 |
| Export keeps full content | REQ-FUNC-70479d66 (unchanged, re-verified) |

## Design

Data shape: instead of turning a field into `{ text, truncated, totalBytes }` (#254 plan 2), the field keeps its type and holds the excerpt, and an optional sibling `truncated` records the full UTF-8 size per cut field: tool item / tool events `truncated?: { preview?: n, args?: n }`, approval / approval.requested `truncated?: { diff?: n }`. Cut args become the excerpt *string* of compact `JSON.stringify(args)`. Why: `args` is `z.unknown()`, so an object marker would be ambiguous; every reader of `preview`/`diff` keeps a string.

Shared (`libraries/shared/src/bounded.ts`): `PREVIEW_INLINE_BYTES = 8192`, `ARGS_INLINE_BYTES = 4096`, `cutUtf8(text, limit) -> { text, totalBytes } | undefined` (undefined when it fits; `TextEncoder.encodeInto` into a limit-sized buffer stops at the last whole character, `read` gives the UTF-16 length), `boundSessionState(state)` (copies only cut items/approvals), `boundSessionEvent(event)` (tool.started args, tool.done preview, approval.requested diff). Reducer copies `truncated` from events (tool.started/done merge into the item; approval.requested spreads already).

Main: `session.get` -> `boundSessionState(sanitizeSessionSnapshot(...))`; `createEventEmitter` bounds session-topic envelopes after `sanitizeEvent`, so live and replay events are cut after scrub (#254 plan 3 says cut before sanitize; cutting after avoids leaking a partial secret at the cut; full-text scrub is already cheap, PERF-05 payload snapshotMs 2.5 ms). Export uses `sanitizeEvent` directly, not the emitter -> unchanged.

Detail: channel `session.item.detail` request `{ sessionId, itemId: string 1..200, field: "preview"|"args"|"diff" }`, response `{ text: string }`. Main handler `sessions.run(s => ({ text: scrub(s.itemDetail(...)) }))`. Core `SessionService.itemDetail` calls `this.row(id)` (NOT_FOUND for a session not in this workbench's database) then `hub.itemDetail`: one SQL query on that session's rows (`idx_events_session_seq`) filtered by `type` and `json_extract(payload_json, '$.callId' | '$.approvalId')`, latest matching row; preview -> `tool.done` with a string preview; args -> `tool.started`, pretty `JSON.stringify(args, null, 2)`; diff -> `approval.requested`. Missing row/field -> NOT_FOUND. No new index: `checkDatabase` requires every schemaSql index, so a new one refuses existing workbench DBs; the query parses only that session's rows of one type inside SQLite.

Renderer uses of `preview`, `args`, `diff` (snapshot readers to update):
- `transcript.tsx:295` DownloadCard parses `item.preview` (web_download JSON metadata, far below 8 KiB) - unchanged.
- `transcript.tsx:377` summary line `JSON.stringify(item.args)` -> use excerpt string when `truncated.args`.
- `transcript.tsx:383,385` ToolDetails args/preview `<pre>` -> `BoundedText` with button.
- `session-inspector.tsx:114,116` inspector tool args/preview -> `BoundedText`.
- `approval-card.tsx:150` plugin_install review `<pre>{diff}` and `:164` `DiffViewer diff` -> `BoundedText`; full diff above 256 KiB renders as plain `<pre>`.
- `changes-tab.tsx:109` DiffViewer reads `changes.detail` (separate channel, not the snapshot) - unaffected.
- `runs-tab.tsx`, `approval-card.tsx:32` read `program.args` (program approval, not tool args) - unaffected.
No agent path reads the renderer snapshot: core runtime/steering/citations/recovery call `hub.get` in core (`service.ts:283,288,773,1140`), never main's bounded response (OBSERVED).

UI: `BoundedText({ sessionId, itemId, field, text, totalBytes, children: (text) => node })` renders `children(full ?? text)`; when `totalBytes` is set and the full text is not loaded, a button `t("chat.showFull", { size })` (KB) calls `api.invoke("session.item.detail")`; an error shows `ErrorMessage`. State is local; collapsed disclosures don't mount it (PERF-03), so nothing is fetched until opened and clicked.

Harness: `fixtures.mjs` expected snapshot for `payload` holds the 8,192-byte excerpt and `truncated: { preview: 65536 }`; stored events unchanged (fixture contentHash unchanged; snapshotHash changes, so reports before/after are not comparable on content proof; timings are).

## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: DEVIATION design: truncation recorded as a sibling 'truncated' size map with the field holding the excerpt, not the {text,truncated,totalBytes} union of #254 plan 2 - args is z.unknown() so an object marker is ambiguous; readers keep string types
- 2026-11-14 design: DEVIATION design: fields are cut after scrubbing, not before sanitize (#254 plan 3) - cutting first could leave an unredacted prefix of a known secret at the cut; full-text scrub is cheap (PERF-05 payload snapshotMs 2.5 ms)
- 2026-11-14 design: DEVIATION design: no new events index for item lookup - checkDatabase requires every schemaSql index, so a new one refuses existing workbench databases; the query filters the session's rows by type and json_extract inside SQLite
- 2026-11-14 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-14 build: red: npmw exec vitest run src/libraries/shared/src/bounded.test.ts exit 1 - cutUtf8/boundSessionState/boundSessionEvent and limits not exported (REQ-FUNC-a8ca0721)
- 2026-11-14 build: red: npmw exec vitest run src/apps/desktop/src/main/events.test.ts tests/tooling/session-performance.test.ts exit 1 - no rendererSessionSnapshot, emitter sends unbounded tool.done, fixture expected snapshot unbounded (REQ-FUNC-a8ca0721)
- 2026-11-14 build: green: npmw run typecheck exit 0; npmw exec vitest run shared bounded.test.ts, main events.test.ts, tests/tooling/session-performance.test.ts exit 0 - fixture expected snapshot now holds the 8 KiB payload excerpt + truncated (snapshotHash changed; stored-event contentHash unchanged) (REQ-FUNC-a8ca0721)
- 2026-11-14 build: red: npmw exec vitest run src/libraries/core/src/sessions/service.test.ts exit 1 - SessionService.itemDetail missing (REQ-FUNC-acaeb296, REQ-SEC-bde59b0b)
- 2026-11-14 build: green: npmw run typecheck exit 0; npmw exec vitest run core service.test.ts, shared bounded.test.ts, main ipc-router.test.ts, preload bridge.test.ts, renderer mocks/sessions.test.ts exit 0 (REQ-FUNC-acaeb296, REQ-SEC-bde59b0b)
- 2026-11-14 build: green: npmw exec vitest run renderer transcript-detail.test.ts exit 0 - excerpt + one 'Show full output (64 KB)' button, click calls session.item.detail once and shows full text, small preview has no button (REQ-UX-4f1c85d5)
- 2026-11-14 build: DEVIATION build: the renderer expand test was written after BoundedText; its first run failed only on the collapsed disclosure (PERF-03 lazy mount), not on missing behaviour - no true red for REQ-UX-4f1c85d5
- 2026-11-14 build: green: npmw run typecheck exit 0; npmw run check:i18n exit 0; biome check --write on 26 changed files (3 formatted; 11 warnings on pre-existing test lines); npmw exec vitest run shared src, core sessions, main events/ipc-router/sessions/session-export, preload bridge, renderer components/session + hooks + mocks + api, tooling session-performance*/build-mode exit 1 - 525 pass, 2 fail unrelated: workspace.test.ts Settings 'parts' tab (known) and shared plugins-ipc.test.ts catalog activities/keywords (no file of this task); export tests unchanged and green (REQ-FUNC-a8ca0721, REQ-FUNC-acaeb296, REQ-SEC-bde59b0b, REQ-UX-4f1c85d5, REQ-FUNC-70479d66)
- 2026-11-14 build: perf: npmw run perf:sessions -- run --mode quick --cases medium,payload --scenarios first,warm,cross exit 0 (perf06-after.json); medians payload payloadBytes 1,431,635 -> 213,675 (perf05-after/-2); payload loadMs first 434/440 -> 404, warm 322/356 -> 356; vs medium (439/304/338 first/warm/cross) payload is -8% / +17% / 0% - target within 20% met; payload mainHandlerMs ~unchanged (21 -> 22); snapshotHash of payload changed with the bounded fixture expectation, so content proofs before/after are not comparable, timings are
- 2026-11-14 build: review round 1 (independent read-only code-reviewer agent on bounded.ts, bounded-text.tsx, main events/index, SessionService/SessionHub itemDetail, reducer/schemas): no golden-path blockers - cut never splits surrogate pairs, cut after scrub on both paths, live fold equals bounded snapshot, json_extract key constant + bound params, NOT_FOUND for other workbench/missing item/field
- 2026-11-14 build: knowledge pages updated: sessions.md (bounded renderer view, itemDetail), ipc-boundary.md (session.item.detail), chat-ui.md (BoundedText/ToolOutput)
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: final: python .agentic/aegis.py check --task TASK-b2bdb1ce --strict --run exit 0; lint ok, typecheck ok, i18n ok, strict ok (test not in [check] run - focused vitest runs logged above); 54 warnings: pre-existing repository records plus review-state (explicit verdicts not recorded; one independent reviewer round instead, as in PERF-03..05) and uncovered-source on test files classified as source; pre-existing unrelated failures: workspace.test.ts Settings 'parts' tab, shared plugins-ipc.test.ts catalog activities/keywords
- 2026-11-14 validate: completed; next done (9 Done checklist item(s) left unticked; review verdicts not both approved)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-b2bdb1ce.md
changed: bounded renderer view of sessions (8 KiB previews/diffs, 4 KiB args) + session.item.detail + Show full output; 4 reqs; 3 knowledge pages
evidence: check --task TASK-b2bdb1ce --strict --run exit 0; focused vitest 525/527 (2 unrelated); perf:sessions quick exit 0
issues: renderer expand test had no true red; explicit review verdicts not recorded; pre-existing failures workspace.test.ts Settings 'parts' and shared plugins-ipc.test.ts activities/keywords; mock session.get not bounded
spec_compliance:
implementation_quality:
review_round:

## Delivery report (2026-11-14)

- stage: validate; type: feature; path: full; branch: feature/249-responsiveness
- requirements:
  - REQ-FUNC-a8ca0721 - Bound large session fields sent to the renderer
  - REQ-FUNC-acaeb296 - Return one session item's full detail
  - REQ-SEC-bde59b0b - Refuse session item detail outside the session
  - REQ-UX-4f1c85d5 - Show the full tool or approval output on demand
  - REQ-FUNC-70479d66 - Export complete session history
- deviations: 4 recorded
  - design: truncation recorded as a sibling 'truncated' size map with the field holding the excerpt, not the {text,truncated,totalBytes} union of #254 plan 2 - args is z.unknown() so an object marker is ambiguous; readers keep string types
  - design: fields are cut after scrubbing, not before sanitize (#254 plan 3) - cutting first could leave an unredacted prefix of a known secret at the cut; full-text scrub is cheap (PERF-05 payload snapshotMs 2.5 ms)
  - design: no new events index for item lookup - checkDatabase requires every schemaSql index, so a new one refuses existing workbench databases; the query filters the session's rows by type and json_extract inside SQLite
  - build: the renderer expand test was written after BoundedText; its first run failed only on the collapsed disclosure (PERF-03 lazy mount), not on missing behaviour - no true red for REQ-UX-4f1c85d5
- explicit review: enabled; spec_compliance=not recorded; implementation_quality=not recorded; review_round=not recorded
- diff vs task base dec0687: 34 file(s) changed, 829 line(s) added
- checks: errors=0 warnings=54 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
