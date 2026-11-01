# Chat UI

## Routing

Select for session navigation/CRUD, transcript, Markdown/code/citations, reasoning/tool rows,
composer, @ completion, models, Stop, context usage and renderer resume. Start with
05_Software/src/apps/desktop/src/renderer/components/session/workspace.tsx and App.tsx.
Focused tests: components/session/workspace.test.ts; tests/e2e/chat-ui.spec.ts and mock.spec.ts.
[Sessions](sessions.md) owns persistence/runtime; [renderer foundation](renderer-foundation.md)
owns geometry/preferences; [workbench](workbench.md) owns folder lifecycle/pinned edits.

[Verification fixtures](demo-onboarding.md) routes the fictional board corpus and PDF sources under tests/fixtures, used by isolated tests and evaluation/smoke harnesses.

## Purpose and boundaries

React presents durable session state through the shared API/reducer. Main/core own persistence,
tools, models, budgets and abort. The browser mock seeds six selectable states and an edit approval scenario through the same API.

Durable state comes from
the backend; reasoning and live tool-update presentation are transient renderer state.

## Public interface

- Markdown HTTP(S) source buttons use translated confirmation before system-browser IPC; cancel/Escape restore focus. A body portal preserves valid Markdown nesting; stable source components survive transcript refresh. [Web search](web-search.md) owns source handling.

- WorkbenchNavigation coordinates session/workbench action details through one sidebar scope. Opening a trigger closes others; outside pointer/focus dismisses and Escape restores trigger focus. Archived expansion is independent. New session/shortcut opts into server-side unused-session reuse, retains the synchronous operationBusy guard, deduplicates the cache and focuses the selected composer through a consumed session-scoped request; same-session unsent drafts remain intact. workspace.test.ts and native navigation-actions.spec.ts cover crossings, keyboard, clicks, errors and restart.

- Agent activity displays a muted, wrapping statistics line per user prompt: reported input/output, frozen initial normal-request context (estimated when applicable), unavailable dashes and explicitly shared batch consumption. Locale-aware formatters are memoized per language. Source is the shared user-item usage projection, not the changing global meter; en/ro/de strings and activity-usage.test.ts plus native prompt-usage.spec.ts cover presentation and restart.

- PermissionPicker offers read-only, Ask, Auto-edit and marked Bypass. Bypass persists as the session mode and enables full ordinary file tool access outside the workbench without confirmations; its red/bold warning-marked selection remains visible even when the localized Close/X/Escape warning is suppressed through application preferences. Mode changes remain available during active turns, with scoped execution revoked by the core on downgrade. Permission save failures surface at the picker.

- The composer places a localized reasoning picker immediately after Model. It offers Default plus the model-declared native levels and hides for models without declared support. Its session-keyed metadata follows effective session/workbench/app model configuration; saves use an expected-model guard and confirmed responses. Read-only/pending saves disable editing; running or awaiting-approval turns can select the next request level. No polling or full-history replay is needed for reasoning metadata.

- App owns one confirmed workbench snapshot shared with Welcome, Welcome/Settings/session memory routes and per-workbench selected IDs in localStorage.
- SessionList offers workbench-scoped title/message search, localized empty/loading/error results, New/select/rename/confirmed delete/status; Ctrl+N creates when writable.
- SessionList offers row-scoped native Markdown/JSON export with localized completion/cancel/errors in read-only or writable workbenches. SessionWorkspace composes transcript/composer/meter and Ctrl+F search with localized match count and per-message match text; closing search restores transcript focus. Plain Escape confirms Stop in a writable active turn; global actions yield to modal/handled/composing/repeated keys.
- useSessionEvents gets snapshot/seq, then subscribes from seq; cancellation detaches obsolete views.
- Composer sends Enter, adds Shift+Enter newline, selects configured catalog models and completes
  caret-local @ paths with arrows/Enter/Tab/Escape. Connected subscription status enables a separate ChatGPT catalog query; sign-out removes those choices. Failed sends retain draft.
- Attached entries (TASK-2fef1397): App keeps per-session lists in `AttachmentsContext`
  (components/session/attachments.tsx); the Docs tree's Attach as context adds to the active
  session (or one created with reuseEmpty) and opens its chat. The composer shows them above the
  message box as chips (name, path as title, "Remove attachment: <path>") and sends
  `withMentions(text, paths)` (lib/attachments.ts): the text, then `@path` mentions on a new line
  (`@"path"` with whitespace), or the mentions alone; at most 20, no duplicates; an accepted send
  clears the sent chips, a failed one keeps text and chips. session.send stays text only
  (REQ-UX-b5edf930, REQ-UX-f8ec3a43, REQ-FUNC-47287974).
- ApprovalCard renders tool/path/bytes and coloured +/- patch lines inline beside the tool. Approve, Deny and Approve-and-switch invoke the exact stored digest. Focused A/D has no modifiers/repeat/composition; pending, decided and read-only cards lock actions and errors remain visible.
- Composer exposes the confirmed session mode during active turns; text/Enter/Send remain available while running, alongside Stop; approval waits lock text/sending and active turns lock model selection. Approval events invalidate sidebar summaries; new sessions inherit workbench defaults.
- ContextTab queries .vera/WORKBENCH.md and enabled validated [skills](skills.md) metadata with scoped Skills settings; ChangesTab shows ordered completed files/counts and the selected stored diff with replay/live refresh and confined reveal; ArtifactsTab lists saved sizes/times, opens safe Markdown/plain text and exports/reveals through shared IPC with revision-scoped live/replay queries; PlanTab displays the current ordered todo list through useSessionEvents with localized accessible status icons, empty/loading/retry states and keyed workbench/session isolation; Docs lists live index status/search/Open/Reindex/progress through the [document viewer](document-viewer.md). [Plan](plan.md) routes these contracts. [Artifacts](artifacts.md) routes these contracts. [Changes](changes.md) routes these contracts.
- UsageMeter presents optional localized compaction status and whole request-view token count alongside labeled estimates, budgets and actual provider usage; old usage events remain valid. Full transcript items remain visible after historical compaction.
- `?mock=chat` exposes empty/streaming/tools/invalid/provider-error/context-limit fixtures.
- CitationChip uses shared refs.ts parsing/compact labels and per-kind page, range,
  heading, line and artifact icons. Full refs remain in tooltip/accessible labels.
  Unverified and malformed refs render inert warning chips; verified chips open the scoped document viewer through session/message-bound host revalidation.

- Queued user rows show a localized pending status until message.delivered clears the marker; the event-backed projection retains pending rows after interruption and restart.

## Session workspace and inspectors

- The transcript and growing composer share a centered content column. The textarea
  resizes on draft/width changes up to a scrolling cap. Compact model/mode controls
  retain Enter/Shift+Enter, completion, steering, approval waits and Stop.
- The transcript fills the remaining bounded session area; its native scrolling is controlled by a segmented left rail with a proportional position marker. The rail appears only for overflowing content, supports pointer dragging/track clicks and Arrow/Page/Home/End keys, and has an en/ro/de accessible label. Wheel and touch use the same native viewport. Content and viewport resize refresh rail metrics; new messages retain an older reading position until the reader returns to the bottom. Composer and shell stay in place.
- The context icon shows latest request-view/context tokens divided by reported
  context window; missing capacity is displayed as unknown. Estimated values are
  labeled. Its modal renders UsageMeter and workbench instructions/available skills
  on demand. Activity opens a separate modal over actual prompt/question, assistant,
  tool argument/update/preview/status and supplied live reasoning projections.
  These do not expose or fabricate a raw provider/system wire prompt.
- Inspectors use native dialog modality, Escape/Close and opener focus restoration.
  App keys workspaces by workbench/session to isolate drafts and inspector state.
- Workbench session disclosure uses a distinct 2rem button with Lucide right/down
  chevrons, translated state-aware tooltip/accessible label and expanded/controls
  semantics; name selection keeps opening the workbench overview.
- Each sidebar session row displays the localized date/time of updatedAt (last
  recorded activity). Selecting the row does not write an access time; runtime
  status remains in screen-reader text and action guards. REQ-UX-9a0489f1 covers
  this presentation; filtering and ordering are unchanged.
- Each sidebar session row has one ellipsis menu: Markdown/JSON export of that row,
  rename, confirmed delete, archive/restore. Exports remain available in read-only
  workbenches. Mutations lock for read-only workbenches and active/approval turns.
  Archived sessions remain accessible in a collapsible section and can be restored.
- REQ-UX-cb7b704e, REQ-UX-bdd845d0, REQ-UX-b0da5193 and REQ-FUNC-f7ef5641
  attach to workspace/usage tests and tests/e2e/session-workspace.spec.ts.

## Invariants

- Exact renderer origin, sandbox and shared IPC authority apply. Renderer imports no native modules.
- Backend terminal text replaces transient deltas; full transcript remains visible after context limits.
- Late snapshot/event results cannot replace another session. Main replay starts after snapshot seq.
- Workbench readOnly and pending operations disable sends; approval waits lock text/sending, active turns lock model changes;
  active Stop uses the real session.stop channel and leaves a usable composer at completion.
- Markdown skips HTML and renders links/images inert; verified message citations alone enable chips.
- Tool disclosures expose full arguments and preview/update/summary; errors and estimates are labelled.
- Dialog closure restores connected opener focus with fallback after removed session actions; rename save/cancel restores its action. Named diff/artifact regions support keyboard scrolling; keyboard controls and wrapping rem layout use en/ro/de catalogs.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Navigation/CRUD/read-only | App, session-list | workspace.test.ts |
| Stream/resume/Stop | use-session-events, workspace | workspace.test.ts; chat-ui.spec.ts |
| Markdown/citations/tools | markdown, transcript, disclosure; shared refs.ts | markdown.test.ts; workspace.test.ts; tests/e2e/citations.spec.ts |
| Composer/models/paths | composer | workspace.test.ts |
| Permission picker/approval cards/keys | composer,approval-card,transcript,use-session-events | workspace.test.ts; tests/e2e/approvals.spec.ts |
| Plan task list | plan-tab;mock sessions | plan-tab.test.ts;tests/e2e/plan.spec.ts |
| Usage/Context | usage-meter, context-tab | usage-meter.test.ts; workspace.test.ts |
| Conversation scroll rail | transcript.tsx, transcript-scroll.tsx, styles.css | tests/e2e/session-scroll.spec.ts |

## Key behaviors

- REQ-UX-52f83eb7 — contextual global shortcuts and accessible search feedback.
- REQ-UX-4bea0001 — keyboard navigation and session mutations.
- REQ-UX-4bea0002 — complete Markdown, tools, reasoning, citations and errors.
- REQ-UX-34535128 — compact per-kind verified/warning citation chips with full-ref accessibility.
- REQ-UX-4bea0003 — keyboard composer, paths and configured models.
- REQ-REL-4bea0004 — runtime/worker Stop and recovery.
- REQ-UX-4bea0005 — usage/estimates/context-limit guidance with complete history.
- REQ-REL-4bea0006 — snapshot/subscription resume and identical terminal text.
- REQ-UX-4bea0007 — pinned context and available skills state.
- REQ-TEST-4bea0008 — browser fixture and translated keyboard acceptance.

- REQ-UX-8b320385 — running composer steering outside approval waits.
- REQ-UX-3001bd00 — localized pending delivery markers.
- REQ-UX-d1b480e0 — optional compaction status and derived request-view size.
- REQ-UX-1676bc64 — independent accessible segmented left conversation scroll rail.
- REQ-UX-7c3fd9a6 — viewport containment including the growing composer.

## Files

Paths relative to05_Software.

- src/apps/desktop/src/renderer/App.tsx — routes and workbench/session selection.
- src/apps/desktop/src/renderer/hooks/use-session-events.ts — guarded snapshot/subscription.
- src/apps/desktop/src/renderer/components/session/{workspace,session-list,composer,approval-card,transcript,markdown,disclosure,usage-meter,context-tab,changes-tab,diff-viewer,plan-tab}.tsx — session presentation.
- src/apps/desktop/src/renderer/components/session/workspace.test.ts — fixtures, keyboard, context, model, Markdown and read-only tests.
- src/apps/desktop/src/renderer/components/session/transcript-scroll.tsx — local native viewport metrics and accessible pointer/keyboard rail.
- tests/e2e/session-scroll.spec.ts — bounded chat/settings/banner geometry, pointer/keyboard/wheel/touch scrolling and reading/follow behavior in browser and native Electron.
- src/apps/desktop/src/renderer/mocks/{mockApi,sessions,session-fixtures}.ts — bridge lifecycle and fixtures.
- src/apps/desktop/src/renderer/{styles.css,locales/en.json,locales/ro.json,locales/de.json} — responsive styling and catalogs.
- src/apps/desktop/src/main/index.ts; src/libraries/shared/src/ipc.ts — config readOnly metadata and instrumented replay delay composition.
- tests/fixtures/llm-scripts/ui-{slow,grep-bad,grep-good}.jsonl — deterministic native acceptance.
- tests/e2e/{approvals,chat-ui,mock}.spec.ts — real native lifecycle/abort and browser matrix.
- components/session/markdown.test.ts and tests/e2e/citations.spec.ts — all reference kinds,
  warning presentation, inert controls and native restart citation projection;
  tests/fixtures/llm-scripts/citations-all.jsonl supplies deterministic tool-issued refs.
- tests/tooling/build-mode.test.ts — release omission of replay delay seam.
- src/apps/desktop/package.json; package-lock.json — pinned Markdown/component-test dependencies.
