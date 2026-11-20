# Session Plan

## Routing

Select for todo whole-list validation, todos repository, todo.updated and the Plan panel. Start at core tools/todo.ts/storage/repos/todos.ts and renderer components/session/plan-tab.tsx under05_Software. [Sessions](sessions.md) owns identity, durability and lifecycle; [workbench storage](workbench-storage.md) owns schema/connection; [Chat UI](chat-ui.md) owns navigation/hook; [IPC](ipc-boundary.md) owns snapshot/event transport.

## Purpose and boundaries

Core owns validated ordered session task lists and atomic database/event updates. Renderer displays current snapshot and replacements through existing session subscriptions. Workbench file tools and approval gates have their own authority.

## Public interface

- Shared todoItemSchema/todoItemsSchema require text<=200 UTF16 code units, count<=50 and pending/in_progress/done; optional string IDs, duplicate rows, empty text and empty lists are preserved.
- Registered todo is session class with strict {items}; returns {items:stored list}, replacing the whole list. ToolRegistry/runtime failures return actionable errors to the model.
- TodosRepository.get(sessionId) reads its row; replace(sessionId,items,updatedAt) independently validates and parameterizes the existing schema1 upsert. SQLite session deletion cascades todos.
- SessionService binds TodoHost database/repository/session/Clock/ownership/scrub/hub callbacks; todo validates scrubbed fields, checks abort/authority and upserts+records one event within a synchronous transaction, publishing after commit.
- PlanTab keys workbench/session identity and consumes the shared session view (useSessionView over useSessionEvents). List text is escaped, order is authoritative; Circle/CircleDot/CircleCheck expose localized status image names and visible status labels. Empty/loading/retry states share application conventions.

## Feedback and review backend

- Shared plan-review.ts defines exact revision/occurrence/full-text targets with whole-step or scalar-safe UTF16 ranges. Each todo.updated increments planRevision, including identical replacements, conservatively making old draft targets stale. Shared projection validates against the displayed agent-masked text before disclosure.
- SessionService.savePlanComment/deletePlanComment record scoped draft metadata with feedback-revision CAS, without transcript rows, model requests or todo changes. Existing format-1 events retain drafts and immutable submitted plan/comment snapshots across database reopen; no separate store or migration is used.
- The four strict user-only channels session.plan.comment.save, session.plan.comment.delete, session.plan.review and session.plan.review.restore carry workbench/session scope. Desktop captures the original database before enqueue and guards it across preparation and durable effects; metadata and review never prepare programs or skills. Review reads current validated config through host-only readConfig and pinned context without catalog-warning discovery; ordinary preparation retains getConfig warnings.
- reviewPlan atomically commits one envelope/user message/started turn and consumes only its captured drafts before publication or dispatch. The expected plan/feedback pair identifies an accepted receipt across reopen. Its fresh runtime offers at most the built-in todo, denies approval and rejects ordinary text/image steering before attachment validation, regardless of permission mode; Stop affects that review runtime only. Historical image references remain text-only without reading project images; review-boundary.test.ts covers both image seams.
- An unsuccessful accepted review retains history. Explicit restore stages only missing source-linked retry drafts without overwriting edits; a subsequent review revalidates all anchors. Generic chat Retry uses this restore path rather than ordinary send, and active review sending is disabled while Stop stays available.

## Live feedback interface

- PlanFeedback owns live actions and the shared session projection; PlanItems is a separate readable list with an optional action slot, so historical tool results expose no mutations. Counts attach only to exact current targets; stale drafts and collapsed Previous reviews stay readable with an empty plan.
- PlanCommentEditor derives saved Edit/Re-anchor text by comment ID from the live projection; unavailable records hide saved text and disable saved mutations. Only actual Create/Edit input (including empty) lives locally across refresh/error; Re-anchor submits target only. Projection epochs invalidate captured quotes. A previously captured fragment invalidated before click opens targetless until explicit recapture or Entire step; an ordinary no-fragment click still chooses the whole step. The readonly selector uses aria-readonly, native beforeinput/paste/cut/drop guards and controlled-value restoration: HTML-readonly disables native caret navigation in Chromium. Standard Shift selection maps native textarea CRLF/CR offsets to exact original UTF16 bounds without normalizing stored strings; pointer capture verifies the exact DOM span and captures source quotes before action focus changes.
- Save, delete, restore and review use strict scoped channels, synchronous duplicate guards and unmount generations. An unknown review acknowledgement retains its original pair and explicit Retry independently of later draft edits; it cannot silently submit a new batch. Successful restoration never starts a model request.
- Native modal Escape owns its keys and restores the connected opener or stable toolbar fallback. Saved drafts come from events, never localStorage; en/ro/de/fr labels and wrapping/scrolling use existing theme/focus conventions.

## Invariants

- Invalid bounds/status/shape, abort or authority loss cannot mutate the list/event. Failed event persistence rolls back the upsert. Observer errors are contained by SessionHub after persistence.
- Session-class calls run sequentially and remain offered in session read-only mode. Workbench read-only denies sends/mutation. SQLite-only synchronous replacement introduces no asynchronous admission gap or migration.
- Snapshot/event schemas use the same list bounds; shared reducer replaces todos. Replay restores the final committed list after restart; obsolete snapshots/subscriptions cannot cross navigation.
- Core is Electron independent; renderer uses shared API and keeps the exact sandbox/origin/import authority. Known-secret text/ID fields are scrubbed before persistence and parsed again. Main snapshot/replay sanitization also redacts optional user IDs against current credentials, bounds expanded presentation text at200 and preserves status/system identities.

## Change map

| Change | Start | Focused proof |
|---|---|---|
| Bounds/registration/order | shared session.ts;tools/todo.ts/registry.ts | shared todos.test.ts;core sessions/todos.test.ts/registry.test.ts |
| Atomic storage/events/authority | TodosRepository;SessionService TodoHost | core sessions/todos.test.ts;native plan.spec.ts |
| Snapshot/live/status/navigation | PlanTab;useSessionView;mock sessions | plan-tab.test.ts;native/browser plan.spec.ts |
| CLI composition | same SessionService/registry | tooling/cli.test.ts Plan process case |
| Drafts, admission, receipts and restore | shared/core plan-review; core service; main plan-review | shared/core plan-review.test.ts; core review-{turn,recovery,boundary}.test.ts; main plan-review{,-boundary}.test.ts |
| Live privacy and safe generic Retry | session-view/use-session-events; workspace/composer | hooks/session-privacy.test.ts; components/session/plan-review-retry.test.ts |
| Live feedback and exact selection | plan-feedback; plan-comment-editor; plan-target; plan-feedback-history; plan-items | components/session/plan-feedback.test.ts; mocks/plan-feedback.test.ts; browser plan-review.spec.ts and plan-fragments.spec.ts |

## Key behaviors

REQ-FUNC-2e8a54c7 bounded whole replacement;REQ-DATA-d968385c atomic durable list/event;REQ-UX-8d3039aa accessible live/restarted Plan. The plan-updates fixture has three distinct replacements in separate model steps; its anchored Update the plan matcher preserves existing automatic replay scenarios. The Plan feedback targets mock fixture includes its initiating user message and exact duplicate/Unicode/empty steps, so New session reuses the empty fixture without inheriting a seeded plan; mocks/plan-feedback.test.ts covers that separation.

## Files

Under05_Software: shared session.ts/events.ts/session-state.ts/todos.test.ts;core tools/todo.ts/context.ts/registry.ts/registry.test.ts,storage/repos/todos.ts,sessions/service.ts/todos.test.ts,index.ts;renderer components/session/{plan-tab,plan-feedback,plan-comment-editor,plan-feedback-history,plan-items}.tsx,plan-target.ts,plan-feedback.test.ts,plan-tab.test.ts,App.tsx,components/shell.tsx,mocks/{sessions,plan-feedback,session-fixtures}.ts,styles.css,locales;tests/fixtures/llm-scripts/plan-updates.jsonl;tests/integration/cli.test.ts;tests/e2e/plan.spec.ts.
