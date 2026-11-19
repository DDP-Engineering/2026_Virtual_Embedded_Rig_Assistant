# REQ-DATA-fa8543aa — Plan comment anchoring and review protocol

Status: draft

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
  execution workflow. It is shared detail for the draft requirements linked to this spec.

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
- UNKNOWN (design mechanism): concrete IPC names, fields, event variants, database representation,
  revision token encoding and compare-and-swap/idempotency storage. The logical fields above
  describe required identity/context, not a second competing public transport schema.

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

## Assumptions and open decisions

- INFERRED (scope): saved comment drafts are the durable feedback records entered through the
  comment editor; exact autosave/composition scheduling and focus restoration are design details.
- UNKNOWN (design): identity mechanism and conservative proof of unchanged target continuity,
  safe host/renderer projection binding, draft/review storage and IPC schemas, editor/re-anchor
  interaction, error message keys, duplicate-request payload comparison and retry draft creation.
  Design must close these before build without weakening the outcomes specified above.
- UNKNOWN (design): concrete comment resource limits, if needed, must be justified and recorded;
  no numeric comment length/count/retention or new data-format version is authorized by this spec.
- STATED (root AGENTS.md): every stored-format version remains 1; current contracts change in
  place without migration, backup or legacy compatibility. Review history follows session lifetime.
- UNKNOWN (verification): actual dependency/browser readiness and platform results; this spec
  is a proposed contract, not test execution evidence or proof that any model will comply.
