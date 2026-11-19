# TASK-c33386cb - Plan: add comments and Review plan to request an agent revision

stage: design
type: feature
interaction: autopilot
requirements: REQ-FUNC-2e8a54c7, REQ-DATA-d968385c, REQ-UX-8d3039aa, REQ-REL-4bea0006, REQ-DATA-fa8543aa, REQ-FUNC-dfa01734, REQ-UX-1dcf2048, REQ-FUNC-566e4205, REQ-FUNC-10533e00, REQ-SEC-9467cfbc, REQ-DATA-a71d1aac, REQ-UX-e86663cb, REQ-FUNC-14c661ce, REQ-DATA-cb383f59, REQ-FUNC-5536a651, REQ-DATA-0f69ffdd, REQ-REL-e048aed0, REQ-REL-ce1e5319, REQ-REL-02c0e68e, REQ-REL-2e0ba7fb, REQ-REL-239f8647, REQ-REL-5b02ea0b, REQ-SEC-4a5e9261, REQ-SEC-e412df5e, REQ-SEC-292daffe, REQ-REL-e50514e6, REQ-REL-0dca1c44, REQ-FUNC-461d6eb1, REQ-FUNC-bf4758a4, REQ-SEC-bb8e4dce, REQ-SEC-5f675c2f, REQ-UX-98d58422, REQ-UX-f205aabf, REQ-UX-4a040005, REQ-UX-4a040007, REQ-UX-4bea0002, REQ-FUNC-a1040002
parent:
branch: adore/gitea-dpasare-2026_Virtual_Embedded_Rig_Assistant-318-p9fda84577701
base: 52cf2a57c0314d8937a4402df10763548efce498
opened: 2026-11-19

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] design note written under the five headings, or its skip justified
- [ ] each decision cites a requirement ID or a named technical constraint
- [ ] every requirement maps to a decision and test seam, or no design impact
- [ ] risks and open decisions recorded
- [ ] `affected_paths` match the expected files
- [ ] knowledge pages unchanged

## Frame

Problem:
- STATED (ticket #318): the right-panel Plan shows task steps/progress but is read-only;
  users cannot attach feedback to a step or selected fragment and request an agent revision.
- OBSERVED (E1): PlanTab renders snapshot todos and live replacements, statuses and
  loading/empty/retry states, with no comment editor or review action.

Desired outcome:
- STATED (ticket #318): users prepare persistent session/revision-scoped comments without
  immediately sending chat, then explicitly Review plan once to submit the current plan
  and pending comments together in the same session. The agent explains changes briefly
  in chat and publishes a revised structured plan, or asks for clarification in chat.
- STATED (ticket #318): review requests revision only, never plan execution, project-file
  changes, commands or extra execution permissions. Previous reviewed text stays intelligible.

Actors:
- STATED (ticket #318): the engineer using pointer or keyboard, the selected workbench/session,
  and the agent revising its structured plan.
- OBSERVED (E2-E5): renderer Plan/session view, shared IPC/event contracts, desktop session host,
  core SessionService/runtime and workbench SQLite participate in the existing plan flow.

Primary scenario:
1. STATED (ticket #318): in a session with a plan, the engineer comments on a whole step or
   selected text, reads/edits/deletes drafts via compact step indicators, and can navigate
   away or reopen the session without losing drafts.
2. STATED (ticket #318): if a replacement changes a commented target, the interface flags it;
   the engineer explicitly re-anchors or removes that comment before review. No silent retargeting.
3. STATED (ticket #318): Review plan sends one explicit request containing that session's current
   plan and pending feedback with enough quoted context for every target; submitted comments
   remain distinguishable from unsent drafts.
4. STATED (ticket #318): agent explanation/clarification appears in that chat, and a revised
   structured plan updates that Plan tab. Failure retains feedback for retry; navigation during
   submission cannot redirect the request or apply its result to another session.

Examples:
- STATED (ticket #318 acceptance 1-2): Unicode, multiline comments/text, repeated step descriptions,
  absent/duplicate IDs, resizing and text-size changes must not corrupt comment association.
- INFERRED (illustrative fixture from those acceptance cases, not new product values): two steps
  both labelled "Verify the pins", with the same optional ID, can each receive independent
  comments; a fragment comment on one occurrence must never move to the other after replacement.
- INFERRED (illustrative fixture from ticket #318 lifecycle): feedback on "Inspect μC\nGPIO" keeps
  its original quote after the agent replaces that text; review waits for explicit re-anchoring
  or removal rather than guessing a new target.

Counterexamples:
- STATED (ticket #318): a wrapped display line is not a stable target; IDs alone are insufficient.
- STATED (ticket #318): adding a draft is not a chat send or a plan replacement; Review plan is not
  approval to run a command, execute a planned step or modify a project file.
- STATED (ticket #318): double-clicking Review must not submit the same review twice; a late
  response from session A must not change the selected session B's plan or comments.

In scope:
- STATED (ticket #318): whole-step and selected-fragment comment creation, reading, editing,
  deletion, compact indicators and keyboard-accessible selection in narrow Plan panels.
- STATED (ticket #318): session/revision/step/range anchoring independent of layout and IDs alone;
  retained quoted context; changed-target detection and explicit re-anchor/remove lifecycle.
- STATED (ticket #318): durable drafts across session navigation/reopening and a distinguishable
  submitted state; one explicit current-plan-plus-pending-comments review request, failure/retry
  preservation and duplicate-submission prevention.
- STATED (ticket #318): revision-only agent request, explanation/clarification and structured plan
  update; restrictions for unavailable, busy, read-only and archived sessions; workbench/session
  isolation before, during and after asynchronous submission.
- STATED (ticket #318; root AGENTS.md): accessible localized controls/text in en/ro/de/fr, focused
  tests and relevant browser acceptance; ticket-related changelog/release notes and documentation
  accompany implementation in its later stage.

Out of scope:
- STATED (ticket #318): general document-viewer annotations, manual plan-step editing/reordering
  and automatic execution.
- STATED (root AGENTS.md pre-release policy): data migration/legacy readers, format-version bumps,
  upgrade backups and compatibility layers. Change current stored contracts in place at version 1.
- STATED (bounded executor instructions): no child task, commit, push, PR/MR, forge credential
  access or AEGIS payload/source modification; this attempt finishes frame only.

Constraints:
- OBSERVED (E2): the current plan allows at most 50 items, text up to 200 UTF16 units, optional
  string IDs, duplicate descriptions/IDs, empty text/lists and pending/in_progress/done statuses.
  Preserve these established input behaviors; anchors must handle every valid list.
- OBSERVED (E2-E3): todo is a session-class tool; replacements and todo.updated commit atomically,
  publish afterwards and replay. Session read-only permission mode permits this session tool,
  distinct from a read-only workbench that refuses mutation.
- STATED (ticket #318): review is disabled without a plan, pending feedback, request admission,
  or while submitting; stale targets must be resolved before review. Failure preserves drafts.
- INFERRED (ticket #318 revision-only guarantee; E4-E5): ordinary send/steering and a prompt-only
  request to behave safely do not establish a revision-only execution boundary. Specify/design
  must provide enforceable admission/tool restrictions, including against hostile comment text,
  without granting permissions or routing through another session's active turn.
- OBSERVED (E6): main can redact/truncate presented plan text against current credentials while
  stored history remains unchanged. Anchor validation and quoted context must account for the
  renderer/host projection boundary without bypassing established secret handling.
- STATED (root AGENTS.md; E3-E5): preserve core/desktop boundaries, validated renderer IPC and
  sandboxing; shared session snapshot/subscription ownership remains REQ-REL-4bea0006.
- OBSERVED (`git branch --show-current`): current branch matches the recorded task branch
  adore/gitea-dpasare-2026_Virtual_Embedded_Rig_Assistant-318-p9fda84577701; not master.
  STATED (executor instructions): use the pinned task/current checkout; do not switch branches.
- STATED (executor instructions): interaction is autopilot (already set), ADORE supervises each
  stage and owns publication approval; stop immediately after advancing frame.
- STATED (02_Tools/verification-policy.md and ticket #318): smallest sufficient tests and statics/
  strict AEGIS plus both independent reviews; no per-ticket full suite. Keep reviewers in separate
  contexts when required by the installed review policy. No product test result is claimed here.

Success signals:
1. STATED (ticket #318 AC1/AC9): pointer and keyboard can create/read/edit/delete whole-step and
   selected-fragment comments for Unicode, multiline and repeated text; en/ro/de/fr controls have
   accessible names and fit narrow panels.
2. STATED (AC2/AC7 and anchoring/lifecycle): resize/text scale preserve anchors; navigation/reopen
   preserve drafts; changed targets are flagged and block review until explicit re-anchor/removal;
   old reviewed text remains understandable, never silently reassigned.
3. STATED (AC3/AC6): exactly the selected session's current plan and pending comments are submitted
   together once with identifying quotes; session/workbench switching cannot redirect any phase.
4. STATED (AC4/AC5): chat explains revisions or asks for clarification; structured updates reach
   that session's Plan, with no project edits, shell commands, planned-step execution or grants.
5. STATED (AC8 and disabling/lifecycle rules): unavailable/busy/read-only/archived restrictions,
   no-plan/no-feedback/in-flight disables, draft/submitted distinction, failure retention and
   retry all work without duplicate submission.
6. STATED (validation request; verification policy): focused anchoring/persistence/submission/retry/
   isolation and agent-update tests plus relevant browser acceptance provide proof; required
   static/strict checks and independent reviews accompany the later candidate, not a full suite.

Evidence:
- STATED source: the complete ticket #318 request and bounded executor instructions in this job.
- OBSERVED E1: 05_Software/src/apps/desktop/src/renderer/components/session/plan-tab.tsx and
  plan-tab.test.ts: display-only rows, occurrence keys, snapshot/replacement/error/late-event tests.
- OBSERVED E2: .agentic/knowledge/plan.md; .agentic/requirements/functional/REQ-FUNC-2e8a54c7.toml;
  .agentic/requirements/data/REQ-DATA-d968385c.toml; .agentic/requirements/ux/REQ-UX-8d3039aa.toml;
  05_Software/src/libraries/shared/src/session.ts; core/src/tools/todo.ts and
  core/src/storage/repos/todos.ts under 05_Software/src/libraries: bounds/duplicates and transaction.
- OBSERVED E3: 05_Software/src/libraries/core/src/sessions/todos.test.ts and
  05_Software/tests/e2e/plan.spec.ts: existing test definitions for bounds, rollback, authority,
  restart, live updates and navigation. Inspected definitions only; not run in frame.
- OBSERVED E4: .agentic/knowledge/sessions.md and agent-runtime.md;
  05_Software/src/libraries/core/src/sessions/service.ts (writable/idle/send and tool binding):
  ordinary active sends can queue steering; normal tool binding includes execution capabilities.
- OBSERVED E5: 05_Software/src/libraries/shared/src/ipc.ts session.send schema;
  .agentic/requirements/reliability/REQ-REL-4bea0006.toml;
  05_Software/src/apps/desktop/src/renderer/hooks/session-view.tsx: shared active-session transport;
  desktop main/sessions.ts identity guards and renderer session/workspace.tsx archived/readOnly gates.
- OBSERVED E6: .agentic/specs/REQ-FUNC-2e8a54c7.md: existing secret projection and historical
  read-only UI description. The ticket explicitly authorizes replacing that UI limitation;
  it does not retire bounded todo, atomicity, isolation or secret-handling contracts.
- OBSERVED: .agentic/context/project.md, .agentic/context/environment.md, root/.agentic AGENTS.md,
  task template and frame step; 02_Tools/verification-policy.md establish routing and stage limits.
- OBSERVED: requirement search found existing baseline requirements above, but none covering
  comment drafts, revision anchors or review-only admission. New atomic coverage is needed in specify;
  baseline IDs are recorded in the header now, not claimed as full ticket coverage.

Assumptions:
- INFERRED (ticket #318 scope and E1-E5): this is one cross-layer feature on the existing Plan/todo
  and session flow, not independently scoped child work. Keep this one pinned journal.
- INFERRED (ticket #318 authorizes persistent comments but excludes project changes during review):
  session metadata/event/plan persistence required by review is distinct from modifying project files.

Unknowns:
- UNKNOWN (implementation decisions for specify/design, not accepted behavior): exact revision identity,
  range representation/Unicode mapping, persisted comment/request structures, IPC shape, atomic
  acceptance/retry protocol and re-anchoring UI. No numeric comment limit or error code chosen here.
- UNKNOWN (to inspect in specify/design): detailed interaction of revision-only turns with durable
  queued steering, current runtime prompts/tools and cancellation/recovery; read-only workbench,
  archived and permission-mode gates must remain distinct and enforced at the owning boundary.
- UNKNOWN (to inspect in specify/design): how to compare anchors across scrubbed renderer text and
  canonical persisted text, preserving both target integrity and established privacy behavior.
- UNKNOWN: readiness of pinned dependencies/browser runtime and actual focused-test results on this
  container; Windows/native Ubuntu acceptance and any CI-only proof are not established by reading.

Decision-blocking questions:
- INFERRED (request and evidence audit): none for frame. The ticket defines the observable outcomes,
  safety/lifecycle boundaries and exclusions. Remaining items are implementation/verification
  discoveries to resolve explicitly in specify/design, not permission to invent product behavior.

Proposed behaviors:
- INFERRED: no additional product behaviors proposed or accepted. The outcomes above come from
  the ticket or existing contracts; mechanism choices remain unknown until later stages.
- STATED (executor autopilot instruction): framed scope is recorded without waiting for a human;
  advance to specify, then return to ADORE without beginning that stage.

## Requirement coverage

STATED: scope and success signals come from the accepted Frame and ticket #318. OBSERVED:
existing requirements below remain active and unchanged; new records are draft. INFERRED:
new atomic contracts and their exact refusal codes refine that scope under conductor-authorized
autopilot; the shared draft spec records the required identity/protocol detail without choosing
storage or IPC names. Each row has exactly one requirement. Design decisions are not yet filled.

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Preserve structured Plan | Existing bounded ordered whole-list replacement | REQ-FUNC-2e8a54c7 | Existing shared/core boundary and invalid-input regression tests | Pending design |
| Preserve structured Plan | Existing atomic plan/event persistence and restart | REQ-DATA-d968385c | Existing real SQLite rollback/restart and Plan acceptance | Pending design |
| Live revised Plan | Existing live ordered/status/empty/error projection | REQ-UX-8d3039aa | Plan component and browser/native replacement cases | Pending design |
| Session view isolation | Existing one shared snapshot/subscription for chat and Plan | REQ-REL-4bea0006 | Shared-view consumer count and late-event regressions | Pending design |
| Stable target association | Revision/session/occurrence/full-text/range anchor independent of wrapping or IDs | REQ-DATA-fa8543aa | Duplicate/missing-ID Unicode fixtures and resize/scale anchor equality | Pending design |
| Comment creation | Add a draft on a whole step or selected nonempty fragment | REQ-FUNC-dfa01734 | Exact Unicode/multiline text and independent duplicate-row targets | Pending design |
| Read compact comments | Step indicator opens correct text, quote and draft/submitted state | REQ-UX-1dcf2048 | Step/fragment, no-comment and removed-target presentation | Pending design |
| Edit drafts | Replace one draft's feedback without retargeting | REQ-FUNC-566e4205 | Edit/reopen Unicode text; stale target unchanged | Pending design |
| Delete drafts | Remove only the selected pending draft | REQ-FUNC-10533e00 | Delete/reopen, last-draft and stale-draft cases | Pending design |
| No immediate send | Draft operations do not change chat/model requests or the plan | REQ-SEC-9467cfbc | Capture gateway/transcript/todos around all draft operations | Pending design |
| Durable drafts | Restore text/anchors/staleness across navigation and database reopen | REQ-DATA-a71d1aac | Real SQLite reopen and two independent sessions | Pending design |
| Stale feedback | Changed/unprovable target gets stale label, old quote and resolution actions | REQ-UX-e86663cb | Removed/changed/ambiguous duplicate targets including cleared plan | Pending design |
| Explicit resolution | Re-anchor updates only the chosen current target and preserves feedback | REQ-FUNC-14c661ce | Confirm current target and race confirmation with replacement | Pending design |
| Understand old review | Retain submitted ordered plan and original quotes/feedback after replacements | REQ-DATA-cb383f59 | Clear/replace/reopen and compare review history | Pending design |
| One explicit review | Submit exact current plan plus current pending feedback and identifying quotes | REQ-FUNC-5536a651 | Capture one same-session envelope/message with repeated descriptions | Pending design |
| Submitted distinction | Atomic acceptance changes captured drafts to submitted with one admitted request | REQ-DATA-0f69ffdd | Observer committed visibility, rollback injection and reopen | Pending design |
| Double activation/lost acknowledgement | Same logical submission admits at most once, including restart retry | REQ-REL-e048aed0 | Concurrent UI/direct calls and lost post-commit acknowledgement | Pending design |
| Invalid selection error | Malformed/forged/cross-step target refuses INVALID with no mutation | REQ-REL-ce1e5319 | Invalid ranges, overflow, split surrogate, quote mismatch | Pending design |
| Stale/racing request error | Superseded plan or pending snapshot refuses CONFLICT, retaining feedback | REQ-REL-02c0e68e | Host admission races and stale re-anchor confirmation | Pending design |
| No-plan error | Review without steps refuses INVALID without consuming drafts | REQ-REL-2e0ba7fb | New empty and cleared commented plans; no request/dispatch | Pending design |
| No-feedback error | Review without pending comments refuses INVALID | REQ-REL-239f8647 | None/deleted-last/submitted-only cases | Pending design |
| Busy-session error | Active/queued/approval/lifecycle work refuses new review with BUSY | REQ-REL-5b02ea0b | Held turn, queue, approval, review and shutdown boundaries | Pending design |
| Read-only/archive authority error | Unwritable/archived feedback mutations refuse DENIED; reads preserved | REQ-SEC-4a5e9261 | All mutations under lost ownership/read-only/archive; permission-mode control | Pending design |
| Foreign feedback error | Foreign/unknown comment or review refuses NOT_FOUND without disclosure | REQ-SEC-e412df5e | Real foreign identifiers used across every operation | Pending design |
| Navigation race isolation | Captured workbench/session owns asynchronous effects; replacement context conflicts | REQ-SEC-292daffe | Delayed save/admission/response; same session ID in different databases | Pending design |
| Pre-acceptance failure/retry | Submission failure retains unsent drafts, visible error and retry | REQ-REL-e50514e6 | Inject validation/persistence/admission failure and retry after reopen | Pending design |
| Post-acceptance failure/retry | Failed/interrupted review retains submitted history and explicit validated retry | REQ-REL-0dca1c44 | Fail/stop/restart, partial plan update and stale retry | Pending design |
| Agent explanation/clarification | Review instructions request brief changes explanation or needed clarification in chat | REQ-FUNC-461d6eb1 | Capture instructions; deterministic explanation and clarification responses | Pending design |
| Agent structured revision | Review instructions request validated structured plan publication | REQ-FUNC-bf4758a4 | Capture instructions; scripted update vs prose-only response | Pending design |
| Revision only | Enforce chat/plan/metadata-only effects in every permission mode | REQ-SEC-bb8e4dce | Host spies plus fabricated execution/grant calls under all four modes | Pending design |
| No mixed execution | Ordinary send during review refuses BUSY instead of steering | REQ-SEC-5f675c2f | Sends during tools, compaction and finalization; no queue/delivery | Pending design |
| Disabled control states | Disable review for absent plan/feedback, stale feedback and unavailable submission | REQ-UX-98d58422 | Pointer/keyboard attempts in each state, including same-tick double activation | Pending design |
| Keyboard/accessible names | Exact fragment selection and all comment/review controls usable without pointer | REQ-UX-f205aabf | Real keyboard-only browser Unicode/reversed-range flow | Pending design |
| Four interface languages | Existing resolved en/ro/de/fr labels and structured errors | REQ-UX-4a040005 | Four-language comment/stale/retry labels and names; i18n audit | Pending design |
| Narrow-panel usability | Existing keyboard/focus/contrast/scaling and no-overflow contract | REQ-UX-4a040007 | Minimum viewport, narrow panel, both themes, all supported text scales | Pending design |
| Chat response visibility | Existing ordered transcript shows explanation/clarification/errors | REQ-UX-4bea0002 | Review response fixture visible only in originating chat | Pending design |
| Retained text privacy | Existing live session disclosure projection preserves identities | REQ-FUNC-a1040002 | Secret/projection change with comment/quote/history; no canonical-text leak | Pending design |

### Specify evidence and audit

- OBSERVED: clean checkout at resume; `git log -2 --oneline` showed ADORE checkpoints of task
  creation and frame. `git diff 52cf2a57c0314d8937a4402df10763548efce498..HEAD --stat` showed only
  this journal, so previously inspected source/tests were unchanged by integration.
- OBSERVED: `aegis.py explain` for PlanTab and SessionService reconfirmed baseline requirements;
  .agentic/knowledge/plan.md, sessions.md and agent-runtime.md (Frame evidence E1-E6) route ownership.
  Additional boundary reads: ipc-boundary.md, renderer-foundation.md, workbench-storage.md;
  shared errors.ts; core storage/schema.ts; desktop main/index.ts session handlers, sessions.ts
  run/serial/lifecycle and events.ts sanitization; core agent/steering.test.ts. These were code/test
  inspections, not test execution.
- OBSERVED: ordinary main session.send accepts only sessionId/text and SessionsHost.run captures
  its workbench when queued work executes. The new feedback path therefore requires explicit
  originating-workbench validation; unchanged sessionId alone cannot settle the navigation race.
- INFERRED technical decisions: existing typed error vocabulary is reused with distinct
  INVALID/CONFLICT/BUSY/DENIED/NOT_FOUND refusal rows. Review admission excludes active or recovered
  queued work, and ordinary sends cannot enter a review; these implement the stated no-execution
  boundary without changing ordinary steering outside review.
- INFERRED technical decisions: offsets use exact validated-projection UTF16 ranges with scalar
  boundaries; quote equality and original occurrence disambiguate repeated descriptions. Revision
  continuity and projection-binding mechanisms remain design decisions, not text-matching guesses.
- INFERRED technical decisions: durable acceptance distinguishes submitted from unsent feedback;
  acknowledgement retry is idempotent, while explicit retry after terminal review failure retains
  history and revalidates current targets. This closes failure/restart cases without losing feedback
  or adding upgrade compatibility.
- OBSERVED conflict audit: old active Plan spec describes no editable UI/no new IPC. The accepted
  ticket changes that limitation; baseline active requirements themselves do not prohibit comments.
  Keep active source/knowledge/spec claims unchanged in specify and update relevant current-state
  documentation together with implementation, rather than claiming draft behavior already exists.
- STATED (current conductor instruction): this attempt conducts specify only and stops after advance;
  prior Frame-only wording above is retained as the historical accepted Frame, not the current stop rule.
- UNKNOWN for design: exact revision/projection seal and conservative target-continuity proof,
  persistence and IPC/event fields, retry-draft lifecycle implementation, editor/re-anchor interaction,
  draft resource limits if justified, and mechanism for review-only dispatch across runtime/host.
  The shared spec leaves these visible and requires closure before build; no blocking scope question
  is outstanding. No new numeric limit, migration, plugin behavior or automatic execution is included.
- OBSERVED artifact audit: 37 coverage rows map one-to-one to 37 header IDs: 29 new draft
  requirements and eight reused active baseline records. Each new requirement has one self-contained
  shall sentence, concrete verification, estimated existing source paths and empty linked_tests.
  One shared draft spec carries the anchor/protocol/state-machine detail. Reused active requirements
  are unchanged, including the existing compound shared-view contract; the one-shall authorship
  audit applies to the new records rather than rewriting established unrelated baseline prose.
- INFERRED coverage audit: all five product success signals and the focused-validation signal have
  rows or the verification column; new validation uses real SQLite and deterministic gateways plus
  relevant browser acceptance. Required statics/strict AEGIS and two independent reviews remain
  later-stage obligations under 02_Tools/verification-policy.md, not tests claimed by this stage.

## Design


## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: Framed ticket #318 as one cross-layer Plan comments/review feature; retained baseline todo bounds/atomicity/shared-view requirements and identified new coverage for specify. Explicit conductor authority sets autopilot and frame-only execution; no child tasks or commits, with publication approval reserved to ADORE. Existing read-only Plan UI limitation is explicitly changed by the ticket, not a reason to weaken execution restrictions.
- 2026-11-19 frame: completed; next specify - Frame completed and scope recorded under conductor-authorized autopilot; no decision-blocking question; stop at this stage boundary.
- 2026-11-19 specify: Specify complete: 29 draft requirements plus eight unchanged baseline contracts mapped in 37 one-requirement coverage rows; one shared draft anchoring/review protocol spec. Concrete IPC/storage/UI mechanisms remain recorded design decisions. Inline TOML/coverage audit passed (exit 0); git diff --check passed (exit 0); scoped strict AEGIS passed (exit 0, zero errors, 25 existing warnings and 39 notes). No product tests/statics or independent implementation reviews run in specify; no product/source changes or commits.
- 2026-11-19 specify: completed; next design - Specify completed under conductor-authorized autopilot; all accepted outcomes mapped and format checks passed; stop at this stage boundary.

## Rulings

- RULING-001 | date=2026-11-19 | decision=Review admission excludes active and recovered queued work; ordinary sends during a review return BUSY, and all review phases including preparation are revision-only. | reason=The requested no-execution guarantee cannot be enforced by sending review text through ordinary execution-capable steering; observed SessionsHost preparation may also probe programs. | source=technical | supersedes=none
- RULING-002 | date=2026-11-19 | decision=Use revision/occurrence/quoted-context anchors with exact validated-projection UTF16 ranges; invalid targets use INVALID, stale snapshots CONFLICT, busy admission BUSY, unwritable/archive DENIED and foreign feedback NOT_FOUND. | reason=Optional and repeated IDs are not identity, renderer text may be projected, and the existing shared error vocabulary supports explicit testable refusals without a new transport. | source=technical | supersedes=none
- RULING-003 | date=2026-11-19 | decision=Distinguish unsent drafts, atomic submitted acceptance and retained unsuccessful review history; reconcile acknowledgement retries idempotently and revalidate explicit failed-turn retries against the current plan. | reason=Ticket lifecycle requires failure retention, a visible submitted/draft distinction, no duplicates and preservation of previously reviewed text; acceptance failure and post-acceptance model failure are different durable states. | source=technical | supersedes=none


## State

status: ready
reported: specify - completed
next: start design: read .agentic/steps/3_design.md
must_read: .agentic/tasks/TASK-c33386cb.md, .agentic/steps/3_design.md
changed: Created 29 draft requirements and one protocol spec; mapped 37 coverage rows including eight unchanged baseline contracts; recorded three technical rulings.
evidence: Inline TOML/coverage audit: exit 0; git diff --check: exit 0; scoped AEGIS check --strict: exit 0, errors=0 warnings=25 notes=39.
issues: Existing warnings unchanged. No product tests/statics/reviews run; design must resolve recorded IPC/storage/UI and revision/projection mechanisms.
spec_compliance:
implementation_quality:
review_round:
