# Chat UI

## Routing

Select for session navigation/CRUD, transcript, Markdown/code/citations, reasoning/tool rows,
composer, @ completion, models, Stop, context usage and renderer resume. Start with
05_Software/src/apps/desktop/src/renderer/components/session/workspace.tsx and App.tsx.
Focused tests: components/session/workspace.test.ts; tests/e2e/chat-ui.spec.ts and mock.spec.ts.
[Sessions](sessions.md) owns persistence/runtime; [renderer foundation](renderer-foundation.md)
owns geometry/preferences; [workbench](workbench.md) owns folder lifecycle/pinned edits;
[transcript navigation](chat-ui-transcript-navigation.md) owns the scroll rail, the user-message
navigator lane and bookmarks.

[Verification fixtures](demo-onboarding.md) routes the fictional board corpus and PDF sources under tests/fixtures, used by isolated tests and evaluation/smoke harnesses.

## Purpose and boundaries

React presents durable backend session state through the shared API/reducer; reasoning and live
tool-update presentation are transient renderer state. Main/core own persistence, tools, models,
budgets and abort. The browser mock seeds six selectable states and an edit approval scenario through the same API.

## Public interface

- Shell approval cards show exact command/cwd/shell and, for eligible literal syntax, a chosen-prefix selector with Always allow. session.approval.decide carries the prefix only on that explicit user action. The [workbench editor](workbench-editor.md) owns the Agent editor list of saved prefixes. The card has four locales. Tests: tests/e2e/command-prefixes.spec.ts.

- Markdown HTTP(S) source buttons use translated confirmation before system-browser IPC; cancel/Escape restore focus. A body portal preserves valid Markdown nesting; stable source components survive transcript refresh. [Web search](web-search.md) owns source handling.

- WorkbenchNavigation coordinates session/workbench action details through one sidebar scope. Opening a trigger closes others; outside pointer/focus dismisses and Escape restores trigger focus. Archived expansion is independent. New session/shortcut opts into server-side unused-session reuse, retains the synchronous operationBusy guard, deduplicates the cache and focuses the selected composer through a consumed session-scoped request; same-session unsent drafts remain intact. Tests: workspace.test.ts, native navigation-actions.spec.ts.

- Each user message shows, only at the Verbose chat detail level, a muted, wrapping statistics line (`PromptUsage`, session/prompt-usage.tsx) per user prompt: reported input/output, frozen initial normal-request context (estimated when applicable), unavailable dashes and explicitly shared batch consumption. Locale-aware formatters are memoized per language. Source is the shared user-item usage projection, not the changing global meter; strings are en/ro/de. Tests: activity-usage.test.ts, native prompt-usage.spec.ts.

- PermissionPicker offers read-only, Ask, Auto-edit and marked Bypass. Each Bypass change first opens one localized confirmation naming read/change/run in any OS-accessible folder. Confirm saves the mode; Cancel/Escape keeps the prior mode and restores focus. Save errors retain the dialog for retry/cancel and pending saves prevent duplicates. Bypass remains red/bold, and its enabled ordinary file tools can use outside paths; application data is excluded. Other mode changes remain available during active turns, with core revocation on downgrade.

- The composer places a localized reasoning picker immediately after Model. It offers Default plus the model-declared native levels and hides for models without declared support. Its session-keyed metadata follows effective session/workbench/app model configuration; saves use an expected-model guard and confirmed responses. Read-only/pending saves disable editing; running or awaiting-approval turns can select the next request level. No polling or full-history replay is needed for reasoning metadata.

- App owns one confirmed workbench snapshot shared with Welcome, Welcome/Settings/session memory routes and per-workbench selected IDs in localStorage.
- SessionList offers workbench-scoped title/message search, localized empty/loading/error results, New/select/rename/confirmed delete/status; Ctrl+N creates when writable.
- SessionList offers row-scoped native Markdown/JSON export with localized completion/cancel/errors in read-only or writable workbenches. SessionWorkspace composes transcript/composer/meter and Ctrl+F search with localized match count and per-message match text; closing search restores transcript focus. Plain Escape confirms Stop in a writable active turn; global actions yield to modal/handled/composing/repeated keys.
- useSessionEvents gets snapshot/seq, then subscribes from seq; cancellation detaches obsolete views.
- App mounts one `SessionViewProvider` (`renderer/hooks/session-view.tsx`) around Shell for the open session while the chat
  shows; SessionWorkspace and the Changes/Artifacts/Plan tabs read it through `useSessionView`, so a window holds one
  snapshot, subscription and revision poll per session. Without a provider, or for another session id, `useSessionView`
  runs its own `useSessionEvents`.
- Tool arguments/output (transcript ToolDetails via `ToolOutput`) and approval diffs render through `BoundedText` (`session/bounded-text.tsx`): a field with a `truncated` size shows its excerpt and a localized "Show full output (N KB)" button that loads the text once through `session.item.detail`; fields that were not cut show no button. A full diff above 256 KiB renders as plain `<pre>` instead of per-line DiffViewer markup.
- Composer sends Enter, adds Shift+Enter newline, selects configured catalog models and completes
  caret-local @ paths with arrows/Enter/Tab/Escape. Connected subscription status enables a separate ChatGPT catalog query; sign-out removes those choices. Failed sends retain draft.
- Attached entries: App keeps per-session lists in `AttachmentsContext`
  (components/session/attachments.tsx); the Docs tree's Attach as context adds to the active
  session (or one created with reuseEmpty) and opens its chat. The composer shows them above the
  message box as chips (name, path as title, "Remove attachment: <path>") and sends
  `withMentions(text, paths)` (lib/attachments.ts): the text, then `@path` mentions on a new line
  (`@"path"` with whitespace), or the mentions alone; at most 20, no duplicates; an accepted send
  clears the sent chips, a failed one keeps text and chips (REQ-UX-b5edf930, REQ-UX-f8ec3a43,
  REQ-FUNC-47287974). Raster images use a separate per-workbench/session draft. Paste, external drop and Attach image
  import the original through main. The Files menu and drag attach an existing path. The composer displays up to
  eight removable Blob thumbnail chips. Image sends wait for the pending capability lookup so the composer can warn when the effective model receives only paths. Image-only drafts
  are sendable and use the same acknowledgment and retry behavior. See `composer-images.spec.ts`.
- User-message image paths appear as bounded thumbnails in the visible transcript. Thumbnail buttons open the
  file viewer in Rendered mode and the standard keyboard return restores the opener. A missing or unreadable
  image shows its persisted workbench path under Display masking. Visible attachments refresh when Chat is
  selected again or the window regains focus. Rows release thumbnail resources when they leave the viewport. See `transcript-images.spec.ts`.
- ApprovalCard renders tool/path/bytes and coloured +/- patch lines inline beside the tool. Approve, Deny and Approve-and-switch invoke the exact stored digest. Focused A/D has no modifiers/repeat/composition; pending, decided and read-only cards lock actions and errors remain visible.
- Program approval cards display canonical outside directory arguments under the localized Outside directories label without hashes; file hashes stay in their own list. `components/session/approval-card.test.ts` covers the metadata list.
- Composer exposes the confirmed session mode during active turns; text/Enter/Send remain available while running, alongside Stop; approval waits lock text/sending and active turns lock model selection. Approval events invalidate sidebar summaries; new sessions inherit workbench defaults.
- ContextTab shows .vera/WORKBENCH.md in a collapsed, word-wrapped, scrollable block, the enabled validated [skills](skills.md) metadata and a Skills settings dialog; ChangesTab shows ordered completed files/counts and the selected stored diff with replay/live refresh and confined reveal; ArtifactsTab lists saved sizes/times, opens safe Markdown/plain text and exports/reveals through shared IPC with revision-scoped live/replay queries; PlanTab displays the current ordered todo list through useSessionEvents with localized accessible status icons, empty/loading/retry states and keyed workbench/session isolation; Docs lists live index status/search/Open/Reindex/progress through the [Docs panel](document-viewer-docs-panel.md). [Plan](plan.md), [Artifacts](artifacts.md) and [Changes](changes.md) route these contracts.
- UsageMeter presents optional localized compaction status and whole request-view token count alongside labeled estimates, budgets and actual provider usage; old usage events remain valid. Complete durable history remains available after historical compaction; the main transcript follows workbench chat.detail.
- `?mock=chat` exposes empty/streaming/tools/invalid/provider-error/context-limit fixtures. Browser-test triggers in mocks/sessions.ts: a message `seed N messages` appends N seeded question/answer pairs; `stream slowly…` streams a 40-line reply over about 6 s.
- CitationChip uses shared refs.ts parsing/compact labels and per-kind page, range,
  heading, line and artifact icons. Full refs remain in tooltip/accessible labels.
  Unverified and malformed refs render inert warning chips; verified chips open the scoped document viewer through session/message-bound host revalidation.

- Queued user rows show a localized pending status until message.delivered clears the marker; the event-backed projection retains pending rows after interruption and restart.

## Session workspace and inspectors

- The transcript and growing composer share a centered content column. The textarea
  resizes on draft/width changes up to a scrolling cap. Model/mode controls are compact.
- The scroll rail, the user-message navigator lane and bookmarks are described in
  [transcript navigation](chat-ui-transcript-navigation.md).
- The context icon shows latest request-view/context tokens divided by reported
  context window; missing capacity is displayed as unknown. Estimated values are
  labeled. Its modal (SessionInspector) renders only UsageMeter (usage and limits cards, model, turns, tool calls);
  instructions and available skills are in the Context tab. No view exposes or fabricates a raw provider/system wire prompt.
- Inspectors use native dialog modality, Escape/Close and opener focus restoration.
  App keys workspaces by workbench/session to isolate drafts and inspector state.
- Workbench session disclosure uses a distinct 2rem button with Lucide right/down
  chevrons, translated state-aware tooltip/accessible label and expanded/controls
  semantics; name selection keeps opening the workbench overview.
- Each sidebar session row displays the localized date/time of updatedAt (last
  recorded activity). Selecting the row does not write an access time; runtime
  status remains in screen-reader text and action guards (REQ-UX-9a0489f1).
- Each sidebar session row has one ellipsis menu: Markdown/JSON export of that row,
  rename, confirmed delete, archive/restore. Mutations lock for read-only workbenches and active/approval turns.
  Archived sessions remain accessible in a collapsible section and can be restored.
- REQ-UX-cb7b704e, REQ-UX-bdd845d0 and REQ-FUNC-f7ef5641
  attach to workspace/usage tests and tests/e2e/session-workspace.spec.ts.

## Invariants

- Exact renderer origin, sandbox and shared IPC authority apply. Renderer imports no native modules.
- Backend terminal text replaces transient deltas; complete durable history remains available after context limits.
- Late snapshot/event results cannot replace another session. Main replay starts after snapshot seq.
- Workbench readOnly and pending operations disable sends;
  active Stop uses the real session.stop channel and leaves a usable composer at completion.
- Markdown skips HTML and renders links/images inert; verified message citations alone enable chips.
- Tool disclosures expose full arguments and preview/update/summary; errors and estimates are labelled.
- `Disclosure` mounts its content only while open (transcript, groups and reasoning); its empty
  hidden container keeps `aria-controls` resolvable. Collapsed content is not in the DOM, so find-in-page
  and copy-all skip it.
- Transcript rows (`MessageRow`, `ToolRow`, `ErrorRow`, `ToolDetails`) and `Markdown` are `React.memo` with
  shallow props; they rely on `applySessionEvent` keeping untouched items' identity, so a live event re-renders
  only its row. Every value a row shows must arrive as a prop (or a stable callback); search text is lower-cased
  once per item object (`searchMatch`).
- `useSessionEvents` queues live events (`message.delta`, `reasoning.delta`, `tool.update`) and applies them
  in arrival order once per animation frame; a durable event applies the queue and itself at once. A new
  snapshot, session switch or unmount drops the queue and cancels the frame. The transcript autoscroll
  layout effect runs only for commits that change `state`, `reasoning`, `updates` or `detail`.
- A streaming assistant message renders as blocks (`streamingBlocks`: split at blank lines outside code
  fences), each through memoized `Markdown`, so only the growing last block is parsed again per frame;
  `message.done` renders the whole text once.
- The transcript mounts the newest 40 rows in its first commit and prepends older rows in chunks of 100,
  one per `requestIdleCallback` (250 ms timeout) inside `startTransition`, until all are mounted; the window
  start is pinned once rows exist, so later rows never unmount older ones, and resets on session change.
  A search mounts every row (matches are outlined in all of them). Scrolling within one screen of the oldest
  mounted row (wheel, Home, the rail) mounts the rest at once; at scroll position 0 the view then shows the
  first message. While following, prepended chunks keep the end in view; a reader who scrolled up keeps
  the place through Chromium's native scroll anchoring. Navigator markers appear as their rows mount.
  Rows do not use `content-visibility`: its estimated heights would resize rows as they scroll into view
  and move the navigator anchors and the rail.
- Dialog closure restores connected opener focus with fallback after removed session actions; rename save/cancel restores its action. Named diff/artifact regions support keyboard scrolling; keyboard controls and wrapping rem layout use en/ro/de catalogs.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Navigation/CRUD/read-only | App, session-list | workspace.test.ts |
| Stream/resume/Stop | use-session-events, workspace | workspace.test.ts; chat-ui.spec.ts |
| Markdown/citations/tools | markdown, transcript, disclosure; shared refs.ts | markdown.test.ts; workspace.test.ts; tests/e2e/citations.spec.ts |
| Composer/models/paths | composer | workspace.test.ts |
| Sent image previews, viewer activation and missing paths | transcript-images; main/display-documents | transcript-images.spec.ts; display-documents.test.ts |
| Permission picker/approval cards/keys | composer,approval-card,transcript,use-session-events | workspace.test.ts; tests/e2e/approvals.spec.ts; run_program cards (risk badge, command, notes, file hashes, typed word): tests/e2e/program-approvals.spec.ts |
| Plan task list | plan-tab;mock sessions | plan-tab.test.ts;tests/e2e/plan.spec.ts |
| Usage/Context | usage-meter, context-tab | usage-meter.test.ts; workspace.test.ts |
| Transcript render cost (lazy disclosures, memoized rows/Markdown) | disclosure, transcript, markdown, transcript-projection | transcript-render.test.ts; `npm run perf:sessions` |
| Progressive transcript mount (newest first, idle chunks) | transcript | transcript-progressive.test.ts; `npm run perf:sessions` (`firstScreenMs`) |

## Key behaviors

- REQ-UX-9c6aa149, REQ-UX-482d2ced, REQ-UX-16e08c34 govern durable transcript thumbnails, viewer activation and unavailable path labels.

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
- REQ-UX-7c3fd9a6 — viewport containment including the growing composer.

## Files

Paths relative to05_Software; `renderer/` is src/apps/desktop/src/renderer/.

- renderer/App.tsx — routes and workbench/session selection.
- renderer/hooks/use-session-events.ts — guarded snapshot/subscription.
- renderer/components/session/{workspace,session-list,composer,approval-card,transcript,markdown,disclosure,usage-meter,context-tab,changes-tab,diff-viewer,plan-tab}.tsx — session presentation.
- renderer/components/session/workspace.test.ts — fixtures, keyboard, context, model, Markdown and read-only tests.
- renderer/mocks/{mockApi,sessions,session-fixtures}.ts — bridge lifecycle and fixtures.
- renderer/{styles.css,locales/en.json,locales/ro.json,locales/de.json} — responsive styling and catalogs.
- src/apps/desktop/src/main/index.ts; src/libraries/shared/src/ipc.ts — config readOnly metadata and instrumented replay delay composition.
- tests/fixtures/llm-scripts/ui-{slow,grep-bad,grep-good}.jsonl — deterministic native acceptance.
- tests/e2e/{approvals,chat-ui,mock}.spec.ts — real native lifecycle/abort and browser matrix.
- renderer/components/session/markdown.test.ts and tests/e2e/citations.spec.ts — all reference kinds,
  warning presentation, inert controls and native restart citation projection;
  tests/fixtures/llm-scripts/citations-all.jsonl supplies deterministic tool-issued refs.
- tests/tooling/build-mode.test.ts — release omission of replay delay seam.
- src/apps/desktop/package.json; package-lock.json — pinned Markdown/component-test dependencies.

## Workbench chat detail

`chat.detail` (format 1, default `normal`; [workbench](workbench.md) owns the field, the [workbench editor](workbench-editor.md) its selector)
flows from App's confirmed workbench snapshot through SessionWorkspace into Transcript. It affects all
sessions in that workbench without changing stored messages, model requests, exports or permissions.

Verbose shows individual technical disclosures and supplied transient reasoning. Normal
uses expandable localized operation counts for consecutive same-turn routine tools;
non-tool content and essential cards split groups. Null-turn calls remain separate.
Minimal hides routine tools and shows a working indicator during active running turns.
Normal/Minimal omit empty finalized assistant placeholders without citations, retaining
all actual conversation text and streaming messages. Reasoning shows only at Verbose.
Approvals (except those granted by the permission mode, `by: "mode"`, which are hidden at Minimal and
grouped at Normal), failed tool rows, errors/Retry, successful download cards and the stopped/interrupted
notice (shown once, for the latest turn only) remain outside hidden groups.

Files: `session/transcript-projection.ts` owns pure grouping; `transcript.tsx` owns display
and essential cards; `workbench-config-form.tsx` owns the localized selector.
Change map: level semantics → projection/transcript tests; config route → App/Workspace;
all-level essential interactions → transcript-detail.test.ts; native persistence, Ask/Stop
and restart → tests/e2e/chat-detail.spec.ts.
