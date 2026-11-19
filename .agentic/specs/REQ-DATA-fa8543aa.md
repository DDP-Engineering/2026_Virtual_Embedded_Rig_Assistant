# REQ-DATA-fa8543aa — Plan comment anchoring and review protocol

Status: active

## Authority and scope

- STATED (accepted task Frame, ticket request): comments target an entire step or a selected
  fragment, remain scoped to a session and plan revision, survive reopening and do not send
  chat until Review plan. Submitted feedback remains distinguishable from drafts, and previous
  reviewed text remains understandable after replacement.
- OBSERVED (.agentic/specs/REQ-FUNC-2e8a54c7.md; shared session.ts; core tools/todo.ts): the plan is
  an ordered whole-list replacement, with optional/duplicate IDs, repeated/empty descriptions,
  at most 50 steps and 200 UTF16 units per description. Current todo persistence and publication
  are atomic. Existing todo limits and status values remain unchanged.
- INFERRED technical contract (accepted safety/lifecycle outcomes): the protocol below defines
  target identity, atomic acceptance, idempotent retry and capability isolation, not a new
  execution workflow. It is shared detail for the requirements linked to this spec.

## Target identity and range semantics

- STATED (accepted Frame): a wrapped display line or a user-supplied step ID alone is not an
  anchor. Identical descriptions are separate ordered occurrences.
- INFERRED technical contract: each logical target carries the owning workbench/session,
  authoritative revision identity, zero-based step occurrence within that revision, original
  whole-step text and either a whole-step marker or a half-open selected range plus exact quote.
  An empty step supports a whole-step comment but cannot have a nonempty fragment comment.
- INFERRED technical contract: a fragment is within one step. Its offsets count UTF16 units in
  the exact host-validated text projection from which selection was made; start is inclusive,
  end exclusive, and 0 <= start < end <= text.length. Boundaries cannot split a surrogate pair.
  The quote equals text.slice(start, end). No normalization, trimming, grapheme substitution or
  newline collapsing changes the target text. A backward selection resolves to the same ordered
  endpoints and quote as a forward selection. Feedback text preserves Unicode and newlines.
- INFERRED technical contract: renderer offsets never index a different canonical, redacted or
  truncated string. The host validates the supplied occurrence, projection and quote against the
  authoritative revision before recording a target. Client claims are not target authority.
- OBSERVED (main/events.ts sanitizeTodos; sessionContent projection; existing masking requirements):
  renderer-visible plan text can differ from retained text. All comment, quote and history
  presentation follows the existing session disclosure choice and unconditional error scrubbing;
  model disclosure follows the existing agent choice. Identity fields remain protocol data.
- INFERRED technical contract: projection changes that invalidate a saved range require renewed
  target validation, never application of old offsets to newly projected text or disclosure of
  hidden canonical text to repair the UI. A changed projection cannot silently target a fragment.

## Revision and stale-target lifecycle

- STATED (accepted Frame): changed targets are flagged; users explicitly re-anchor or remove them
  before review, and no plan update silently attaches feedback to another occurrence or fragment.
- INFERRED technical contract: authoritative revision identity is scoped to the owning session
  and survives replay. Renderer layout changes and resubscription do not create a new revision.
  An identical step string alone does not prove continuity across a whole-list replacement.
- INFERRED technical contract: a current target must be provably the original step occurrence
  with the same original text and quoted fragment. Changed/removed text, unprovable occurrence
  continuity, or invalidated projection makes a draft stale. A conservative stale decision is
  valid when continuity cannot be proven; matching IDs, nearest offsets, text similarity or the
  first repeated description are never sufficient to choose another target.
- STATED (accepted Frame): stale feedback remains readable with its old quote, including when
  the replacement plan is empty. Re-anchor explicitly chooses a current whole step or fragment;
  removal explicitly deletes that draft. Editing feedback does not re-anchor it.
- INFERRED technical contract: re-anchor validation compares the revision at confirmation, not
  only at editor opening. An intervening plan replacement refuses the stale confirmation rather
  than silently anchoring to the new list. Submitted review snapshots remain immutable history;
  re-anchoring a retry changes a pending draft, not the original reviewed text.

## Logical review envelope

- STATED (accepted Frame): Review plan contains the selected session's current plan and pending
  comments as one explicit same-session request, with enough quotes to identify each target.
- INFERRED technical contract: an envelope logically identifies the workbench, session, logical
  submission identity, expected current plan revision and pending-comment snapshot. Its captured
  content contains the complete ordered current plan (including statuses and optional IDs),
  and each pending comment's identity, feedback, original step occurrence/full text and optional
  exact fragment range/quote. Step order is authoritative; model-facing step numbering may be
  human-readable but must distinguish duplicate descriptions.
- INFERRED technical contract: the host builds captured content from owned authoritative records,
  checking expected revision/comment state at acceptance. Renderer prose cannot substitute a
  different plan, smuggle foreign comments or omit a stale pending comment to evade validation.
  A later comment edit cannot change an already accepted envelope.
- INFERRED technical contract: envelope contents are feedback data, not instructions that grant
  tools, change permissions or execute the quoted plan. Structured quoting/delimitation keeps
  feedback distinguishable from the review-only instruction even with Markdown/code-like text.
- INFERRED (design D1-D4 in the task journal): the concrete event-backed representation and
  user-only IPC below implement this logical envelope; no separate plan repository or hash-seal
  service is introduced.

## Acceptance and retry state machine

- INFERRED technical contract: `draft` describes unsent feedback; `submitted` describes feedback
  captured in an accepted review. Staleness is a target property, not permission to drop a draft.
  A submission has logical phases preparing, accepted/running, completed or unsuccessful. These
  are protocol concepts; exact enum names and UI phrasing belong to design/build.
- INFERRED technical contract: acceptance is one atomic durable boundary containing the captured
  envelope, one explicit admitted user request and submitted ownership of its comment batch.
  Publication/model work follows durable acceptance; a failed transaction creates none of these.
- STATED (accepted Frame): the UI synchronously guards repeated activation while preparing or
  submitting. INFERRED technical contract: host idempotency also protects non-UI retries and
  persists across restart; a committed logical submission cannot produce another admitted
  request because its response was lost, the tab unmounted or the app reopened.
- INFERRED technical contract: an exact replay of an accepted submission resolves the original
  acceptance rather than revalidating against the plan it already revised. Reuse of an identity
  for different content is a conflicting snapshot, not authorization for a second request.
- STATED (accepted Frame): failure before acceptance keeps feedback as unsent drafts with retry.
  INFERRED technical contract: an unknown acknowledgement first reconciles the original logical
  submission; it does not mint a new request or optimistically delete drafts.
- INFERRED technical contract: failure, abort, context limit or restart interruption of an accepted
  turn retains its submitted envelope/history. Explicit retry makes its feedback available as
  pending retry drafts, preserving original quotes and performing current-anchor checks; it does
  not rewrite the submitted snapshot or automatically replay work on startup. A deliberately
  retried failed turn is a new logical submission, unlike an acknowledgement retry.
- STATED (accepted Frame): submitted comments and unsent drafts are visibly distinguishable.
  INFERRED technical contract: only current pending feedback enters a new review; successful
  submitted comments are not automatically sent again. A clarification response is valid chat
  output without a fabricated plan change; a prose-only response is not a structured plan update.

## Admission and errors

- OBSERVED (shared errors.ts and existing session/IPC guards): INVALID, NOT_FOUND, CONFLICT,
  BUSY and DENIED already exist. INFERRED technical contract: new operations reuse those codes
  with localized presentation rather than inventing an untyped error transport.
- INFERRED technical contract: the following are separately covered refusal responses, not a
  promise about which wins when multiple independent invalid conditions exist:

| Condition | Response | Required preservation |
|---|---|---|
| Malformed occurrence/range, cross-step selection or forged quote for the supplied revision | INVALID | Existing plan and feedback unchanged |
| Superseded revision, stale/unprovable target, changed pending snapshot or reused identity with different content | CONFLICT | Feedback retained for explicit resolution/retry |
| No current steps | INVALID | No admitted request; pending feedback retained |
| No pending feedback | INVALID | No admitted request |
| Active/queued work, approval wait, deletion, shutdown or a distinct review in flight | BUSY | No review steering queued; feedback retained |
| Archived session, read-only workbench or lost write ownership | DENIED | No mutation; prior comments remain readable |
| Comment/review outside the specified session, including unknown identity | NOT_FOUND | No foreign disclosure or mutation |
| Captured workbench replaced before asynchronous admission/publication | CONFLICT | No dispatch/effect in replacement context |
| Ordinary send during an active revision-only review | BUSY | No ordinary queued/delivered steering |

- INFERRED technical contract: text-only draft edits and draft deletion do not require target
  freshness; they remain available for stale feedback under writable/unarchived ownership.
  Target freshness is required for creation, re-anchoring, review and retry admission. Comparing
  an expected edited record is separate from requiring its old target to remain current.
- STATED (accepted Frame): Review plan is disabled for unavailable states, including no plan,
  no pending feedback, unresolved stale targets and in-flight submission; host validation still
  enforces refusals if the renderer is stale or bypassed.
- OBSERVED (core service.ts/todos.test.ts): session `read-only` permission mode still allows
  session plan updates; a read-only workbench prohibits mutation. INFERRED technical contract:
  revision-only review preserves that distinction rather than escalating or rewriting the mode.

## Session isolation and restricted response

- STATED (accepted Frame): switching sessions/workbenches during submission cannot redirect
  feedback or revised plans. INFERRED technical contract: capture workbench identity before
  asynchronous preparation and recheck at the owning host; a session ID alone is insufficient
  because separate workbench databases may contain the same value. A session switch may leave
  accepted work running only in its original session. Workbench lifecycle keeps its existing
  close/drain/ownership rules, with no background write into a replacement database.
- STATED (accepted Frame): the agent considers feedback, gives a brief chat explanation and
  publishes a revised structured plan, or asks for clarification. INFERRED technical contract:
  request instructions explicitly require those outcomes; existing schema-validated atomic
  todo publication and chat projection carry them. Chat prose alone never changes todos.
- INFERRED technical contract: every dispatch and tool execution of a review turn is restricted
  to chat, review metadata and structured plan publication, regardless of Ask/Auto-edit/Bypass
  or hostile feedback. Ordinary write/program/command/permission capabilities are absent and
  fabricated disallowed calls cannot reach their hosts. Review preparation cannot run command or
  program probes as a side effect of preparing the ordinary execution prompt. Prompt text alone
  is not the boundary.
- INFERRED technical contract: review cannot join an active ordinary turn or consume recovered
  undelivered steering; ordinary sends cannot join a review. These rules also cover subsequent
  model calls, historical compaction, finalization and cancellation/recovery. A later, separate,
  explicitly initiated ordinary user request remains governed by existing session permissions.

## Examples and focused acceptance

- INFERRED fixture: revision R has two steps with the same optional ID and text `Verify μC\nGPIO`.
  A fragment quote `μC` on occurrence 1 is distinct from occurrence 0. Resizing or text scaling
  does not change it; a replacement that makes continuity ambiguous flags it stale.
- INFERRED fixture: selecting `😀` inside `A😀B` uses [1,3); [1,2) is invalid. A whole-step
  comment is valid on an empty description; a zero-length fragment is not a fragment target.
- INFERRED fixture: acceptance commits and its acknowledgement is lost. Repeating the same logical
  request yields that acceptance with one user message/turn. A provider failure then permits an
  explicit new retry with retained feedback, not a duplicate acceptance of the old request.
- INFERRED fixture: workbench A and B share a session ID. A delayed review prepared for A either
  runs in A before its lifecycle drains or conflicts; neither its comments nor todo updates enter B.
- STATED (validation scope): focused unit/component tests cover anchors, persistence, admission,
  retry and isolation; deterministic agent flow tests cover structured publication and explanation/
  clarification. Relevant real-browser acceptance covers pointer/keyboard Unicode selection,
  all four languages, narrow panels, resize/text scale and visible draft/submitted/stale/error
  states. Existing shared-view, masking and todo regression proofs remain applicable.

## Concrete design contract

All choices in this section are INFERRED technical decisions D1-D6 from the accepted requirements,
current synchronous event store and existing host/runtime interfaces, not observations of implemented code.

### D1 — Revision, projection and target validation

- Add `planRevision` to SessionState, initially 0, incremented once for every committed
  `todo.updated` folded in order. Its identity is the tuple (workbench, session, planRevision),
  not an item ID, timestamp, wrapped line or content hash. Replay reproduces it exactly.
- Every subsequent `todo.updated` invalidates pending anchors from older revisions, even an
  identical-looking replacement: the current whole-list API supplies no proof of occurrence
  continuity. Do not merge, move or regenerate comment targets in response to a replacement.
  This intentionally conservative rule avoids pretending duplicate rows have stable identities.
- `PlanTarget` is `{ revision, stepIndex, stepText, range }`. `revision` and `stepIndex` are
  nonnegative safe integers; stepIndex must identify an actual current step. `stepText` is the
  complete exact displayed step text (at most the existing 200 UTF16 units), and `range` is
  null for a whole step or `{ start, end, quote }` with the range semantics above. The owning
  workbench/session is carried by the event/request scope, never inferred from text.
- Factor the current pure todo projection (scrub text then slice to 200; scrub optional ID,
  preserve status) into shared `plan-review.ts`. Core uses that same helper with
  maskContent('agent', text); desktop session presentation uses sessionContent. Core compares
  the incoming stepText and quote to the current projected step before storing a target.
  No renderer-provided canonical text, string similarity or cryptographic token is needed.
- Core snapshot projection derives each draft's `stale` flag before sanitization: revision differs
  OR saved stepText differs from the current host-projected text OR the saved range/quote no
  longer validates. Never recompute that flag by comparing two already-redacted strings.
  Live plan replacement immediately marks old drafts stale through the shared reducer.
- A masking-relevant settings.changed, workbench config.changed or session modelRef change forces
  the existing shared session view to reconcile even when its durable seq is unchanged; there is
  still one session subscription/poll loop. Pass workbenchId through SessionViewProvider to the
  hook and key the provider by workbench. Invalidate an in-flight old projection before applying
  its reply and hide retained projection while refreshing. Host admission always revalidates.
  Historical quotes are scrubbed as independent strings, not sliced using obsolete offsets.

### D2 — Durable events and snapshots

- Keep the current schema_version 1 SQLite events/messages/todos tables; introduce no table,
  migration, upgrade reader, schema bump, dependency or second persistence tree.
- Add `planFeedbackRevision` (initial 0), `planComments` (initial []) and `planReviews` (initial [])
  to the shared snapshot. A saved draft is `{ id, text, target, restoredFrom? }`; `restoredFrom`
  is `{ reviewId, commentId }` for an explicit failed-review retry. The snapshot's draft view
  additionally has the derived stale boolean. System-generated IDs are opaque nonempty strings.
- Add durable event variants `plan.comments.saved { comments }`, `plan.comment.removed { commentId }`,
  `plan.review.submitted { review }` and `plan.review.restored { reviewId, expectedFeedbackRevision,
  comments }`. Each event increments planFeedbackRevision exactly once. Draft saves contain only
  changed draft records; deletion affects one record. Existing event publication stays post-commit.
- An accepted review is `{ id, expectedPlanRevision, expectedFeedbackRevision, plan, comments,
  turnId, messageId, submittedAt, stopReason }`. `plan` is the complete owned canonical ordered
  plan at acceptance, `comments` is its immutable captured draft batch, and stopReason is initially
  null, later end/error/aborted/limit. Scope is inherited from the owning session/workbench.
  `plan.review.submitted` moves only captured drafts into that submitted envelope; it does not
  overwrite later drafts. Existing `turn.done` folds the matching review outcome by turnId.
- The snapshot user item with messageId matching an accepted review exposes optional `reviewId`
  derived by the reducer. It is host metadata, not a model tool parameter. This also survives replay
  and lets generic transcript Retry distinguish review from ordinary chat.
- Core comment operations write only events, never transcript/model messages; session deletion
  already cascades events. JSON export naturally retains the new format-1 events; existing
  desktop sanitization covers every nested comment/quote/plan in export and presentation. Reuse a
  typed shared feedback-content mapper from desktop events.ts and CLI session-output.ts to scrub
  only data fields, never comment/review/message identities, counters or discriminants. CLI gains
  no review command. Submitted review text already appears in Markdown; no new export format.

### D3 — User-only IPC and scope

- Add strict shared channels, exposed through the schema-derived authorized bridge only:
  - `session.plan.comment.save`: `{workbenchId, sessionId, expectedFeedbackRevision, action, ...}`;
    action create carries `{text,target}`, edit carries `{commentId,text}`, and reanchor carries
    `{commentId,target}`. Use a strict discriminated union, with no optional mixed-action fields.
  - `session.plan.comment.delete`: `{workbenchId,sessionId,expectedFeedbackRevision,commentId}`.
  - `session.plan.review`: `{workbenchId,sessionId,expectedPlanRevision,expectedFeedbackRevision}`;
    returns `{reviewId,turnId,messageId}`. No caller-supplied plan, feedback prose or permission field.
  - `session.plan.review.restore`: `{workbenchId,sessionId,expectedFeedbackRevision,reviewId}`;
    restores retry drafts only and returns {}. Comment save/delete also return {}.
- Snapshot/subscription remains the read API; no comment polling endpoint or duplicate session.get.
  Every named draft/review lookup is scoped to the specified session before inspection or mutation.
  Archived/read-only reads remain available; corresponding mutation controls and host writes lock.
- Desktop `planReviewHandlers` routes these operations through SessionsHost with an expected
  workbenchId from the request and an originating DB handle captured synchronously before joining
  the serial queue. Compare both inside the queue before preparation, after awaits and in the
  captured service's durability/ownership guard. Never capture only when queued work starts.
  Accepted work retains its
  original SessionService until lifecycle drain; callbacks never reacquire the newly selected service.
- Extend SessionsHost preparation purpose to metadata/review/ordinary. Metadata and review never
  list/probe programs, load skills or warm command hosts. Review loads only current configuration
  and pinned prompt context without command execution. Use the unchanged canonical prompt builder
  with no program/command/help capabilities, then append the revision-only instruction. Core hosts
  may supply reviewPrompt(mode); otherwise a pure host.prompt(mode) plus that instruction is used.
- Known-credential user feedback text follows existing user-input refusal policy; target context
  follows the live projection, not a blanket credential check on quoted retained plan records.
  Errors use existing localized codes; add contextual stale/restore statuses in all four catalogs.

### D4 — Atomic admission, receipts and failed-turn restore

- planFeedbackRevision is a compare-and-swap token for every draft operation; it prevents stale
  edits and an asynchronous review from consuming a different draft snapshot. Edit/delete do not
  require a current target revision. Create/reanchor/review require current target validation.
- The logical submission key is the scoped pair (expectedPlanRevision, expectedFeedbackRevision).
  Since both counters only increase and acceptance itself increments the feedback counter, the
  same pair can represent only one review. Before fresh-admission freshness/busy checks, look for
  an already accepted envelope with that pair after validating current scope/authority; return its
  original receipt, even if its plan was subsequently revised. No client nonce store is needed.
- For a fresh pair, reject no plan/no feedback, stale target/projection/comment snapshot, active
  or undelivered queued work, pending approvals, deletion, close/shutdown or archive/unwritable
  authority using the defined errors. Check again at the synchronous durable boundary.
- Prepare the restricted runtime without sending; preallocate turnId/messageId. One transaction
  writes plan.review.submitted, the sole explicit user transcript message plus message.user, a
  turn.started event and session running status. The message contains a revision-only instruction
  and a JSON-delimited complete plan/comment envelope with one-based occurrence labels for humans.
  Counter/range values remain their exact machine units. No pending feedback is omitted or truncated.
- Extend RuntimeInit with optional `requestIdentity: {turnId,messageId}`; ReferenceRuntime uses it
  for this turn's initial events. Ordinary callers omit it and keep generated identities. Service
  seeds matching events durably once and suppresses only the two matching initial runtime echoes.
  A mismatching runtime identity aborts the review, never creates a second user request.
- After commit, install the active review before observer publication; start runtime.send so its
  abort controller exists, then publish the committed seed events. Gateway/tool dispatch still
  passes the existing durability/ownership barrier. Commit failure starts no runtime; startup
  failure after commit closes the recorded review as unsuccessful, retaining the receipt/history.
- Failed acceptance leaves drafts untouched. An unknown acknowledgement retries the same counter
  pair, not a new ordinary send. Failed/aborted/limited/interrupted accepted turns retain their
  submitted envelope; recovery closes the recorded active review using existing interrupted/turn
  events and never automatically dispatches another model call.
- Explicit restore clones missing feedback from an unsuccessful envelope into pending drafts with
  restoredFrom links, preserving old anchors and original history. Existing linked retry drafts are
  not duplicated or overwritten. Restored targets may be stale: staging feedback is not new model
  admission, and the user must re-anchor/remove before a subsequent Review plan. Repeated restore
  acknowledgements are reconciled by source review and expected feedback revision in stored events.

### D5 — Execution boundary and generic Retry

- Refactor only turn setup/admission seams in SessionService, not a second execution loop. Ordinary
  turn behavior remains the default. Review uses a fresh minimal tool context containing TodoHost
  and a registry constructed from the built-in todo definition, not an injected/overridden registry.
  Respect existing disabledTools/host permission policy; unavailable todo is never re-enabled by review.
- Review exposes at most todo, with no read/write/program/terminal/plugin/permission capabilities;
  approve immediately denies and cannot call registry.prepare or an approval host. Enforce the
  same allowlist at gateway dispatch and tool execution for every model/summary call. A hostile
  feedback string or fabricated call cannot reach any non-plan host in any permission mode.
- Append instructions to consider feedback, publish the revised structured plan with todo, explain
  changes briefly in the same chat or ask needed clarification, and never execute the plan. Existing
  transcript/context budget/masking/durable tool-result handling remains authoritative. A prose-only
  response is chat only. No promise about a live model's compliance substitutes for the host boundary.
- Record ActiveTurn.kind as ordinary/plan-review. Reject ordinary sends into a review with BUSY
  before expensive desktop ordinary preparation as well as in core send; SessionsHost takes an
  ordinarySessionId preflight inside its serial queue. Review steering returns an empty queue and
  admission excludes recovered pending messages. Other sessions may continue their own turns.
- Review Stop aborts its runtime only, not unrelated prior background program runs. Workbench
  close/delete still follow their separately authorized lifecycle rules. User mode changes do not
  widen the fixed review capability set; review creates no permission/grant mutation.
- Workspace detects the last user's reviewId: its generic Retry calls review.restore and reports
  that feedback is ready in Plan, never session.send(last.text). Plan history exposes the same
  explicit restore action. A later Review plan is the only new revision submission. Keep ordinary
  error Retry unchanged. During a running review disable composer sending while retaining Stop
  and the existing user-controlled mode behavior; core remains the final authority.

### D6 — Compact accessible interaction

- Keep PlanItems usable unchanged for historical tool results; add optional live-row action/selection
  slots only for PlanView. Live steps offer Add comment and a compact count indicator for draft or
  submitted comments whose exact target is still valid in that current revision/occurrence, with
  draft/submitted states visibly distinguished. Never show an old ordinal's indicator on
  an unrelated replacement step. Stale drafts live in a compact Needs re-anchor section; submitted
  snapshots live in a collapsed Previous reviews section, even when the current plan is empty.
- Add a session/workbench-keyed PlanFeedback component and native modal comment editor with feedback
  textarea, exact read-only step text selector, Entire step/Use selected text, Save draft and Cancel.
  Pointer selection on one live .plan-text prepopulates its fragment before action focus changes;
  keyboard users select in the named readonly textarea using standard Shift navigation. Capture
  selectionStart/End, normalize backwards selections and map native textarea newline offsets back
  to the unchanged original UTF16 step text before validating. Pointer offsets/quotes likewise use
  the exact verified text span, not the selection API's rendered-text newline normalization.
  Use aria-readonly with native beforeinput/paste/cut/drop guards and controlled-value restoration:
  Chromium's HTML-readonly attribute disables the native caret navigation this selector requires.
- Persist on explicit Save draft; until success the modal retains edited text and structured errors.
  Keep the editor mounted across shared-view refresh/error states. A privacy refresh invalidates
  and hides its captured quote/selection while retaining feedback text for explicit target recapture.
  Saving never sends chat. Re-anchor opens the same selector with an explicitly chosen numbered
  current step; Save re-anchor changes target only. Escape/Cancel restores connected opener focus
  or the Plan toolbar fallback. Modal key ownership avoids invoking global Stop while selecting.
- Saved drafts survive navigation/reopen in events, not localStorage. Mutation/submission refs guard
  same-tick duplicate activation; captured request scope and unmount generations guard completions.
  On conflict reconcile the shared session view without discarding feedback or the editor's text.
- All controls, state labels, quoted regions, errors and restoration notices use en/ro/de/fr catalogs.
  Step text and exact selector preserve whitespace with pre-wrap; wrapping rem-based flex/grid
  layout and internal scrolling retain actions at the narrowest existing
  panel widths and all supported text scales; no hidden hover-only or pointer-only action.

## Assumptions and open decisions

- INFERRED (scope): saved comment drafts are the durable feedback records entered through the
  comment editor; exact autosave/composition scheduling and focus restoration are design details.
- INFERRED (design D1-D6): mechanism choices are fixed below and in the journal's Design;
  build may adjust private helper factoring, not lifecycle/authority semantics, without revisiting scope.
- INFERRED (existing session storage and context-budget constraints): introduce no new numeric
  comment length/count/retention limit. Feedback is never silently truncated; an oversized review
  uses the existing whole-request context-limit failure and retained-feedback retry behavior.
- STATED (root AGENTS.md): every stored-format version remains 1; current contracts change in
  place without migration, backup or legacy compatibility. Review history follows session lifetime.
- OBSERVED (build journal): focused shared/core/main/component and real Chromium results are
  recorded with their actual scope. Windows/native Electron and independent review results remain
  separate validation obligations; this contract is not proof that a live model will comply.
