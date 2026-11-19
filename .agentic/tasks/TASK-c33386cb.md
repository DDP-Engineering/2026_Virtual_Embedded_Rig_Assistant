# TASK-c33386cb - Plan: add comments and Review plan to request an agent revision

stage: build
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

- [ ] each automated increment has a red line before its implementation and a
      green line after; each manual one a logged observation
- [ ] anchor recorded before implementation; evolution reviewed after
- [ ] focused tests green, with the command and its scope logged
- [ ] `affected_paths`, `linked_tests` and `status = "active"` current on every
      requirement, or `retired` with its reason
- [ ] affected docstrings, usage examples and setup instructions updated
- [ ] `check` clean, or each remaining warning explained in the Log

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
existing requirements below remain active with their contracts preserved. All 29 new records are
now active with linked shared/core/main/component and real Chromium verification; the eight reused
contracts retain their existing scope and focused regression evidence. Native Electron/Windows and
independent review results are separate validation obligations, not inferred from browser mocks.
INFERRED: new atomic contracts and their exact refusal codes refine the accepted scope under
conductor-authorized autopilot; the active shared spec records the required identity/protocol detail. Each row has exactly one requirement; D1-D6 below now select its implementation and test seam.

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Preserve structured Plan | Existing bounded ordered whole-list replacement | REQ-FUNC-2e8a54c7 | Existing shared/core boundary and invalid-input regression tests | D1/D5: reuse bounded built-in todo; todos.test.ts and registry.test.ts |
| Preserve structured Plan | Existing atomic plan/event persistence and restart | REQ-DATA-d968385c | Existing real SQLite rollback/restart and Plan acceptance | D2/D4: retain todo transaction and add separate atomic review seed; todos.test.ts and plan-review.test.ts |
| Live revised Plan | Existing live ordered/status/empty/error projection | REQ-UX-8d3039aa | Plan component and browser/native replacement cases | D6: live actions only; historical PlanItems stays read-only; plan-tab.test.ts and plan.spec.ts |
| Session view isolation | Existing one shared snapshot/subscription for chat and Plan | REQ-REL-4bea0006 | Shared-view consumer count and late-event regressions | D1/D6: extend shared view, no second session query/subscription; hook and changes-tab tests |
| Stable target association | Revision/session/occurrence/full-text/range anchor independent of wrapping or IDs | REQ-DATA-fa8543aa | Duplicate/missing-ID Unicode fixtures and resize/scale anchor equality | D1: event-count revision plus index/full projected text/range; shared/core plan-review.test.ts |
| Comment creation | Add a draft on a whole step or selected nonempty fragment | REQ-FUNC-dfa01734 | Exact Unicode/multiline text and independent duplicate-row targets | D2/D3/D6: create draft event through Save draft; core/component plan-review tests |
| Read compact comments | Step indicator opens correct text, quote and draft/submitted state | REQ-UX-1dcf2048 | Step/fragment, no-comment and removed-target presentation | D6: count indicator, stale section and collapsed review history; plan-feedback.test.ts |
| Edit drafts | Replace one draft's feedback without retargeting | REQ-FUNC-566e4205 | Edit/reopen Unicode text; stale target unchanged | D3: strict edit action cannot carry target; core plan-review.test.ts |
| Delete drafts | Remove only the selected pending draft | REQ-FUNC-10533e00 | Delete/reopen, last-draft and stale-draft cases | D2/D3: scoped draft removal event with feedback CAS; core/component tests |
| No immediate send | Draft operations do not change chat/model requests or the plan | REQ-SEC-9467cfbc | Capture gateway/transcript/todos around all draft operations | D2: metadata events never enter transcript; core plan-review.test.ts |
| Durable drafts | Restore text/anchors/staleness across navigation and database reopen | REQ-DATA-a71d1aac | Real SQLite reopen and two independent sessions | D2: existing session events cascade/replay, no schema change; real DB reopen tests |
| Stale feedback | Changed/unprovable target gets stale label, old quote and resolution actions | REQ-UX-e86663cb | Removed/changed/ambiguous duplicate targets including cleared plan | D1/D6: every new plan revision invalidates old targets; shared/component/browser tests |
| Explicit resolution | Re-anchor updates only the chosen current target and preserves feedback | REQ-FUNC-14c661ce | Confirm current target and race confirmation with replacement | D1/D3/D6: explicit current target dialog, host revision/CAS validation; core/browser tests |
| Understand old review | Retain submitted ordered plan and original quotes/feedback after replacements | REQ-DATA-cb383f59 | Clear/replace/reopen and compare review history | D2/D6: immutable submitted snapshots in events and history disclosure; real DB/component tests |
| One explicit review | Submit exact current plan plus current pending feedback and identifying quotes | REQ-FUNC-5536a651 | Capture one same-session envelope/message with repeated descriptions | D3/D4: host builds JSON envelope from CAS snapshot, no renderer payload; core/main tests |
| Submitted distinction | Atomic acceptance changes captured drafts to submitted with one admitted request | REQ-DATA-0f69ffdd | Observer committed visibility, rollback injection and reopen | D4: one transaction for envelope/user/turn/status, then publication; real DB failure-injection tests |
| Double activation/lost acknowledgement | Same logical submission admits at most once, including restart retry | REQ-REL-e048aed0 | Concurrent UI/direct calls and lost post-commit acknowledgement | D4: durable scoped revision-pair receipt lookup and synchronous UI guard; core/main/component tests |
| Invalid selection error | Malformed/forged/cross-step target refuses INVALID with no mutation | REQ-REL-ce1e5319 | Invalid ranges, overflow, split surrogate, quote mismatch | D1/D3: strict range schemas plus exact host-projection validator; shared/core tests |
| Stale/racing request error | Superseded plan or pending snapshot refuses CONFLICT, retaining feedback | REQ-REL-02c0e68e | Host admission races and stale re-anchor confirmation | D1/D4: plan and feedback counters checked at commit; core/main tests |
| No-plan error | Review without steps refuses INVALID without consuming drafts | REQ-REL-2e0ba7fb | New empty and cleared commented plans; no request/dispatch | D4: fresh-admission nonempty plan guard before seed; core tests |
| No-feedback error | Review without pending comments refuses INVALID | REQ-REL-239f8647 | None/deleted-last/submitted-only cases | D4: fresh-admission pending-feedback guard before seed; core tests |
| Busy-session error | Active/queued/approval/lifecycle work refuses new review with BUSY | REQ-REL-5b02ea0b | Held turn, queue, approval, review and shutdown boundaries | D4/D5: active/pending/approval/lifecycle guard; core/main held-boundary tests |
| Read-only/archive authority error | Unwritable/archived feedback mutations refuse DENIED; reads preserved | REQ-SEC-4a5e9261 | All mutations under lost ownership/read-only/archive; permission-mode control | D3/D4: writable/unarchived owner guard; App passes restrictions; core/main/component tests |
| Foreign feedback error | Foreign/unknown comment or review refuses NOT_FOUND without disclosure | REQ-SEC-e412df5e | Real foreign identifiers used across every operation | D3: session-scoped lookup and snapshot-only reads; core/main isolation tests |
| Navigation race isolation | Captured workbench/session owns asynchronous effects; replacement context conflicts | REQ-SEC-292daffe | Delayed save/admission/response; same session ID in different databases | D3/D6: expected workbench/DB in serial host plus keyed UI generations; main/component tests |
| Pre-acceptance failure/retry | Submission failure retains unsent drafts, visible error and retry | REQ-REL-e50514e6 | Inject validation/persistence/admission failure and retry after reopen | D4/D6: no consumption before commit, modal/local error retains text; core/component tests |
| Post-acceptance failure/retry | Failed/interrupted review retains submitted history and explicit validated retry | REQ-REL-0dca1c44 | Fail/stop/restart, partial plan update and stale retry | D2/D4/D5: outcome from turn events, explicit restore then review; core/workspace tests |
| Agent explanation/clarification | Review instructions request brief changes explanation or needed clarification in chat | REQ-FUNC-461d6eb1 | Capture instructions; deterministic explanation and clarification responses | D5: review-only canonical prompt suffix; core replay plus browser response tests |
| Agent structured revision | Review instructions request validated structured plan publication | REQ-FUNC-bf4758a4 | Capture instructions; scripted update vs prose-only response | D5: request built-in todo publication and retain chat-only clarification; core/browser flow tests |
| Revision only | Enforce chat/plan/metadata-only effects in every permission mode | REQ-SEC-bb8e4dce | Host spies plus fabricated execution/grant calls under all four modes | D3/D5: probe-free prep, built-in-only registry, deny approval, dispatch/execution guards; main/core tests |
| No mixed execution | Ordinary send during review refuses BUSY instead of steering | REQ-SEC-5f675c2f | Sends during tools, compaction and finalization; no queue/delivery | D5: ActiveTurn kind and early desktop send preflight; core/main boundary tests |
| Disabled control states | Disable review for absent plan/feedback, stale feedback and unavailable submission | REQ-UX-98d58422 | Pointer/keyboard attempts in each state, including same-tick double activation | D6: state-derived disable plus ref guard, shared session restrictions; component/browser tests |
| Keyboard/accessible names | Exact fragment selection and all comment/review controls usable without pointer | REQ-UX-f205aabf | Real keyboard-only browser Unicode/reversed-range flow | D6: native modal and named read-only selector with standard Shift keys; real browser tests |
| Four interface languages | Existing resolved en/ro/de/fr labels and structured errors | REQ-UX-4a040005 | Four-language comment/stale/retry labels and names; i18n audit | D6: literal catalog keys in four locales and existing ErrorMessage; locale/browser tests |
| Narrow-panel usability | Existing keyboard/focus/contrast/scaling and no-overflow contract | REQ-UX-4a040007 | Minimum viewport, narrow panel, both themes, all supported text scales | D6: rem wrapping/scrolling, visible focus and modal key ownership; browser bounds/focus tests |
| Chat response visibility | Existing ordered transcript shows explanation/clarification/errors | REQ-UX-4bea0002 | Review response fixture visible only in originating chat | D5: ordinary transcript projection plus review-aware generic Retry; workspace/replay tests |
| Retained text privacy | Existing live session disclosure projection preserves identities | REQ-FUNC-a1040002 | Secret/projection change with comment/quote/history; no canonical-text leak | D1/D2: identical todo projection, typed nested sanitization and forced shared-view remask; core/main/CLI/hook tests |

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

### Approach

- INFERRED D1 (REQ-DATA-fa8543aa, REQ-UX-e86663cb): anchor by replayed plan-replacement counter,
  occurrence and exact projected text/range; every new revision conservatively stales older drafts.
- INFERRED D2 (REQ-DATA-a71d1aac, REQ-DATA-cb383f59): store drafts and immutable review envelopes
  in existing session events; extend the shared reducer, not the SQLite schema or a second store.
- INFERRED D4/D5 (REQ-DATA-0f69ffdd, REQ-SEC-bb8e4dce): preaccept one user/turn/envelope transaction,
  then reuse the turn pipeline with a fixed built-in-todo capability set; reject ordinary steering.
  Rejected: prompt-only safety, ordinary send/retry, text/ID matching, localStorage-only drafts.

### Interfaces and data

- INFERRED D1/D3: exact PlanTarget, event/snapshot fields, four strict workbench/session-scoped
  channels and error contracts are in specs/REQ-DATA-fa8543aa.md, Concrete design contract D1-D6.
- INFERRED D4 (REQ-REL-e048aed0, REQ-REL-e50514e6, REQ-REL-0dca1c44): scoped expected plan/feedback
  counters provide durable idempotency/CAS; failure before commit retains drafts, failure after
  commit retains submitted history. Explicit restore stages retry drafts, then Review submits.
- INFERRED D5 (REQ-SEC-5f675c2f, REQ-FUNC-461d6eb1, REQ-FUNC-bf4758a4): optional runtime requestIdentity
  binds precommitted IDs; review-only prompt suffix, probe-free host purpose and review-aware generic
  Retry prevent escalation. Stop aborts review runtime without stopping unrelated background runs.

### Files and test seams

- INFERRED D1-D6: shared plan-review.ts (new), events/session-state/ipc/index; core sessions/
  plan-review.ts (new) and service.ts, agent/runtime.ts/types.ts; no change to todo/storage algorithms.
- INFERRED D3/D5: desktop main plan-review.ts (new), index.ts, sessions.ts, events.ts; renderer
  plan-feedback.tsx (new), plan-tab.tsx, workspace.tsx, composer.tsx, use-session-events.ts, App.tsx,
  hooks/session-view.tsx, mocks/{sessions,mockApi}.ts, styles.css and four locale files; CLI
  session-output.ts uses the typed nested-content mapper without new CLI commands. Existing prompt builder,
  SessionHub, event repository, TodosRepository, todoTool, preload and export formatter are reused.
- OBSERVED build D6 factoring: PlanItems lives in plan-items.tsx with a readonly default and optional
  live actions, avoiding a circular dependency. PlanCommentEditor, plan-target and
  plan-feedback-history are private PlanFeedback helpers; mocks/plan-feedback.ts mirrors the strict
  shared protocol. The selector uses aria-readonly plus edit guards because Chromium HTML-readonly
  disables native Shift/caret selection; actual keyboard and pointer behavior is browser-proven.
- INFERRED verification plan: new shared/core/main plan-review.test.ts and renderer plan-feedback.test.ts;
  extend runtime identity, state reducer, todos, session lifecycle/steering, masking/sanitizer/export,
  shared-view/workspace and mock tests; focused browser plan-review.spec.ts plus existing Plan acceptance.
  Tests attach to every row above. Read 02_Tools/verification-policy.md before build checks; no full suite.

### Risks and open decisions

- OBSERVED (service.ts/runtime.ts): message.user normally persists synchronously and observers can
  reenter before later events; D4 precommits seed events and installs an abortable active review before
  publication. Never wrap existing send in an outer transaction with premature inner publication.
- OBSERVED (main/sessions.ts; workspace.tsx): normal preparation may probe programs and generic Retry
  uses session.send(last.text); D3/D5 explicitly change those two seams and test both for no escalation.
- INFERRED D1 (REQ-FUNC-a1040002): core validates unsanitized saved anchors against the current shared
  projection before presentation; privacy notifications force shared-view refresh without extra polling.
- STATED (root policy): format stays 1, no migrations/backups/dependencies. INFERRED (existing budgets):
  no new numeric feedback quota or silent truncation; oversize requests keep existing CONTEXT_LIMIT.
- OBSERVED (artifact audit; design writes only .agentic): four explicitly planned source modules do
  not exist yet; their affected_paths warnings must clear when build creates them, not be suppressed.
- UNKNOWN verification only: dependency/browser readiness, actual platform results and live model reply
  quality. No blocking product/mechanism decision remains; build proves the specified guards and fixtures.
  Both independent reviews remain validate obligations in separate contexts, not claimed design proof.

### Requirement map

- INFERRED traceability: every requirement ID maps to D1-D6 and its test seam in the coverage table's
  final column; the shared spec supplies the exact protocol/interaction, while active baseline behavior
  remains authoritative. Design details close the earlier specify unknowns, without changing its scope.
- OBSERVED: resume HEAD 2a9d5e80 contains only ADORE checkpointed .agentic artifacts since the recorded
  base; source/test assumptions were reconfirmed at the named seams. Knowledge pages remain unchanged.
Diagrams: [diagram_TASK-c33386cb.md](diagram_TASK-c33386cb.md)

## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: Framed ticket #318 as one cross-layer Plan comments/review feature; retained baseline todo bounds/atomicity/shared-view requirements and identified new coverage for specify. Explicit conductor authority sets autopilot and frame-only execution; no child tasks or commits, with publication approval reserved to ADORE. Existing read-only Plan UI limitation is explicitly changed by the ticket, not a reason to weaken execution restrictions.
- 2026-11-19 frame: completed; next specify - Frame completed and scope recorded under conductor-authorized autopilot; no decision-blocking question; stop at this stage boundary.
- 2026-11-19 specify: Specify complete: 29 draft requirements plus eight unchanged baseline contracts mapped in 37 one-requirement coverage rows; one shared draft anchoring/review protocol spec. Concrete IPC/storage/UI mechanisms remain recorded design decisions. Inline TOML/coverage audit passed (exit 0); git diff --check passed (exit 0); scoped strict AEGIS passed (exit 0, zero errors, 25 existing warnings and 39 notes). No product tests/statics or independent implementation reviews run in specify; no product/source changes or commits.
- 2026-11-19 specify: completed; next design - Specify completed under conductor-authorized autopilot; all accepted outcomes mapped and format checks passed; stop at this stage boundary.
- 2026-11-19 design: Design D1-D6 completed in the journal and draft protocol spec, with 37 one-to-one decision/test mappings and structure/sequence/state diagrams. Updated affected_paths in 29 draft and three active records without changing any requirement prose; clarified foreign-ID verification to use snapshot-only reads. No product, test, knowledge or payload changes; no commit/publication.
- 2026-11-19 design: DEVIATION design: accept stale-paths warnings for four explicitly planned new source modules - design must name the future files before build creates them; build must clear those warnings rather than suppress them.
- 2026-11-19 design: Design verification: inline TOML/coverage/prologue/history/diagram/affected-path audit exit 0; git diff --check exit 0; aegis.py check --task TASK-c33386cb --strict exit 0 (errors=0 warnings=82 notes=39; 57 planned-module path warnings and 25 pre-existing warnings). Product tests/statics/browser/platform proof and separate-context spec/quality reviews remain later-stage obligations, not claimed evidence.
- 2026-11-19 design: completed; next build
- 2026-11-19 build: Build resume: clean checkout at ADORE design checkpoint 00ca8990; recorded branch/base still match. Installed pinned Node/npm dependencies and Ubuntu 22.04 Electron/build libraries inside this container (Jammy non-t64 packages provide the required sonames); setup.py --check exit 0. No sandbox changes or dependency/lockfile edits.
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/shared/src/plan-review.test.ts exit 1 - five expected missing-behavior failures: feedback event schemas/counters/history and exact-target/content helpers are not implemented (shared foundation for REQ-DATA-fa8543aa, REQ-DATA-cb383f59, REQ-DATA-0f69ffdd, REQ-REL-0dca1c44, REQ-UX-e86663cb, REQ-FUNC-a1040002; full host/UI verification still required).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/shared/src/plan-review.test.ts src/libraries/shared/src/session-state.test.ts src/libraries/shared/src/todos.test.ts src/libraries/shared/src/events.test.ts exit 0 - 24 tests; shared metadata/target/history/content foundation passes, with the existing independent reducer oracle extended for the four new event types and replacement counter. Biome check --write for six touched shared files exit 0. Host/IPC/UI outcomes are not yet complete and new requirements remain draft.
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/sessions/plan-review.test.ts exit 1 - seven expected missing comment-operation failures (create/edit/delete/re-anchor, real DB reopen, private draft metadata, target/CAS validation, scoped authority and live projection); no import or fixture failure (REQ-FUNC-dfa01734, REQ-FUNC-566e4205, REQ-FUNC-10533e00, REQ-FUNC-14c661ce, REQ-DATA-a71d1aac, REQ-SEC-9467cfbc, REQ-REL-ce1e5319, REQ-REL-02c0e68e, REQ-SEC-e412df5e, REQ-SEC-4a5e9261).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/sessions/plan-review.test.ts src/libraries/core/src/sessions/todos.test.ts src/libraries/core/src/sessions/bookmarks.test.ts exit 0 - 16 tests for draft CRUD/re-anchor/private metadata, exact UTF16/projection and CAS refusal, session/authority isolation, committed publication/rollback and real database reopen. This is the core portion of the ten comment requirements in the preceding red line; renderer/IPC and review branches remain incomplete.
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/apps/desktop/src/main/events.test.ts src/apps/cli/src/session-output.test.ts exit 1 - two expected nested-feedback disclosure failures; current snapshot/event output leaves new feedback strings unprojected (REQ-FUNC-a1040002).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/apps/desktop/src/main/events.test.ts src/apps/cli/src/session-output.test.ts src/libraries/shared/src/plan-review.test.ts exit 0 - 24 tests; typed feedback mapper now protects snapshot/events/export paths and CLI without scrubbing protocol identities or reapplying historical offsets (REQ-FUNC-a1040002). npm run typecheck exit 0.
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/shared/src/plan-review.test.ts exit 1 - editing feedback after a host-proven privacy-projection conflict incorrectly clears the live stale flag; a text edit must not imply re-anchor (REQ-UX-e86663cb, REQ-FUNC-566e4205, REQ-FUNC-a1040002).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/shared/src/plan-review.test.ts src/libraries/shared/src/session-state.test.ts src/libraries/core/src/sessions/plan-review.test.ts src/apps/desktop/src/main/events.test.ts src/apps/cli/src/session-output.test.ts exit 0 - 48 tests; structural target equality now conservatively preserves a host-proven stale flag for text edits while a newly validated target can clear it. No protocol fields or identity heuristics added (REQ-UX-e86663cb, REQ-FUNC-566e4205, REQ-FUNC-a1040002).
- 2026-11-19 build: Build regression evidence: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/shared/src/plan-review.test.ts src/libraries/shared/src/session-state.test.ts src/libraries/shared/src/todos.test.ts src/libraries/shared/src/events.test.ts src/libraries/core/src/sessions/plan-review.test.ts src/libraries/core/src/sessions/todos.test.ts src/libraries/core/src/sessions/bookmarks.test.ts src/libraries/core/src/sessions/service.test.ts src/libraries/core/src/sessions/masking.test.ts src/apps/desktop/src/main/events.test.ts src/apps/cli/src/session-output.test.ts exit 0 - 11 files/104 tests before the additional stale-edit regression. The five impacted files then passed 48 tests after that refinement; unchanged ordinary-session/masking/bookmark/todo proofs are reused rather than rerun at handover.
- 2026-11-19 build: Build static evidence: in 05_Software via python ../02_Tools/environment/npmw.py, npm run lint, npm run typecheck, npm run check:i18n, npm run check:help and npm run check:release-notes all exited 0. Final typecheck was repeated after the shared reducer refinement and passed. Lint retained 7 warnings/23 informational diagnostics in unchanged baseline files; no unrelated lint fixes. Biome check --write passed for all touched source/test files. No full suite, plugin suite, browser/native acceptance, evolution completion or independent review was claimed.
- 2026-11-19 build: Traceability checkpoint: linked focused tests on 12 new requirement records and the existing masking requirement; added explicit affected test paths where strict source tracing also treats colocated tests as source. New requirements remain draft because their IPC/renderer or full review lifecycle verification is not implemented yet; no partial feature is declared active/complete. Existing requirement prose/status and original Frame/Design/Rulings are unchanged. Build checklist records only completed increment evidence and current focused-green scope.
- 2026-11-19 build: DEVIATION build: strict check still reports 36 stale-paths findings for the planned desktop main/plan-review.ts and renderer/components/session/plan-feedback.tsx modules - temporary only in this incomplete checkpoint; both modules and their tests remain required before build can advance. python .agentic/aegis.py check --task TASK-c33386cb --strict --json exited 0: errors=0, warnings=61, notes=39, no promoted warnings. Remaining 25 warnings are the unchanged 12 ticket-ref and 13 journal-header baseline findings; repo-evolution is pending until all requirements are green, as required by build step 7.
- 2026-11-19 build: Bounded build checkpoint, not stage completion: implemented shared schemas/projection/mappers, replay/copy-on-write counters/comment/review state, session user review association, and core synchronous transactional draft create/edit/delete/re-anchor with CAS/authority/anchor checks and live projection staleness; wired nested desktop/CLI disclosure. No IPC review/comment routes, review runtime/submission, restore method or feedback UI exists yet. Resume D3-D5 with test-first core admission (atomic envelope/message/turn persistence, precommitted runtime IDs/echo suppression, tuple idempotency, restrictive built-in-todo-only execution, no steering and review-only Stop), explicit restore/recovery; then captured-database/probe-free main handlers and strict four-channel IPC, D1 live privacy refresh, D6 editor/selection/history/Retry, mocks/four locales/help/changelog/release notes, remaining requirement activation/tests, evolution and build checklist. Both independent reviews and browser/native acceptance remain unperformed. No human product decision is required.
- 2026-11-19 build: Build continuation: clean ADORE checkpoint 3d0f3d2e on the recorded branch; setup.py --check passes with pinned Node 24.21.0, dependencies and Electron libraries still available. Original pre-implementation anchor remains present; do not replace it. Prior unchanged foundation proofs are reused.
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/agent/request-identity.test.ts exit 1 - runtime ignores precommitted request identity and generates different initial event IDs (REQ-DATA-0f69ffdd).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/agent/request-identity.test.ts src/libraries/core/src/agent/steering.test.ts exit 0 - four tests; precommitted initial IDs are one-shot and ordinary identity/steering defaults remain unchanged (REQ-DATA-0f69ffdd foundation).
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/sessions/review-turn.test.ts exit 1 - ten expected missing reviewPlan failures after real-DB fixtures succeed: atomic exact-envelope admission/receipt/reopen, rollback, INVALID/CONFLICT/BUSY/DENIED guards, built-in-todo-only boundary in four modes, no steering/background Stop and unsuccessful startup/identity handling (REQ-FUNC-5536a651, REQ-DATA-0f69ffdd, REQ-REL-e048aed0, REQ-REL-2e0ba7fb, REQ-REL-239f8647, REQ-REL-5b02ea0b, REQ-SEC-bb8e4dce, REQ-SEC-5f675c2f, REQ-SEC-4a5e9261, REQ-REL-02c0e68e, REQ-REL-e50514e6, REQ-FUNC-461d6eb1, REQ-FUNC-bf4758a4).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/sessions/review-turn.test.ts exit 0 - ten tests; npm run typecheck exit 0. Atomic review admission/tuple receipts/reopen/rollback and restricted built-in-todo execution in all four modes now pass, including guarded ordinary sends, disabled todo, isolated Stop and startup/identity failure. Captured main-host/probe-free IPC and UI acceptance remain outstanding for these cross-layer requirements.
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/sessions/review-recovery.test.ts exit 1 - six missing restorePlanReview failures and one logger-containment failure; tests cover scoped CAS/authority, rollback, durable restore receipts/linked edits, partial-plan re-anchor, complete CONTEXT_LIMIT feedback and explicit retry, interruption recovery/no auto-dispatch (REQ-REL-0dca1c44, REQ-DATA-cb383f59, REQ-SEC-e412df5e, REQ-SEC-4a5e9261, REQ-REL-02c0e68e, REQ-REL-e50514e6).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/sessions/review-recovery.test.ts exit 0 - seven tests; npm run typecheck exit 0. Explicit restore persists source-linked missing drafts with CAS/scoped authority, reconciles lost acknowledgements across reopen and never overwrites linked edits; failure/limit/interruption preserve immutable history with no auto-dispatch. Oversized unanswered transcript context remains protected on later retries; shortening retry feedback does not silently remove earlier context or promise the retry fits the unchanged budget policy.
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/sessions/review-boundary.test.ts exit 1 - two expected boundary defects: shutdown BUSY precedes an already accepted receipt, and disabling todo during an awaited host-policy check is not rechecked at the final mutation boundary. Three additional tests already pass for reentrant seed Stop, summary/finalization BUSY plus fabricated gateway capabilities, and denied host policy (REQ-REL-e048aed0, REQ-SEC-bb8e4dce, REQ-SEC-5f675c2f).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/libraries/core/src/sessions/review-boundary.test.ts src/libraries/core/src/sessions/review-recovery.test.ts src/libraries/core/src/sessions/review-turn.test.ts src/libraries/core/src/sessions/service.test.ts src/libraries/core/src/sessions/plan-review.test.ts src/libraries/core/src/sessions/masking.test.ts src/libraries/core/src/sessions/programs.test.ts src/libraries/core/src/sessions/approvals.test.ts src/libraries/core/src/agent/request-identity.test.ts src/libraries/core/src/agent/steering.test.ts exit 0 - 10 files/120 tests; npm run typecheck exit 0. Receipt replay now precedes lifecycle busy checks (authority still first), and todo rechecks live availability at final transactional host guard. Summary/finalization/prepublication Stop and ordinary program/approval/steering regressions pass.
- 2026-11-19 build: red: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/apps/desktop/src/main/plan-review.test.ts exit 1 - eight expected missing contracts/handler failures after real two-database fixtures initialize; no import/setup failure. Coverage includes strict four-channel user scope, authorized mutation/secret/target refusals, probe-free canonical review preparation, origin DB captured before queued lifecycle work (including identical workbench/session IDs), post-await scope validation and ordinary preflight before probes (REQ-SEC-292daffe, REQ-SEC-bb8e4dce, REQ-SEC-5f675c2f, REQ-REL-ce1e5319, REQ-SEC-e412df5e and review/comment IPC portions).
- 2026-11-19 build: green: pinned vitest desktop main {plan-review,sessions,ipc-router} and preload bridge exit 0 (4 files/46 tests), then strengthened empty/deleted-last/submitted-only rejection, awaited counter races, lost-owner late callbacks and two-comment atomic rollback/reopen in desktop {plan-review,plan-review-boundary} and core review-turn: exit 0 (3 files/21 tests); typecheck exit 0. Four strict scoped IPC channels now wired; default metadata and review preparations do not list skills/plugins/programs, ordinary-send BUSY preflight precedes execution preparation, and captured database checks cover enqueue/await/effect barriers. REQ-DATA-0f69ffdd, REQ-REL-{2e0ba7fb,239f8647,02c0e68e,ce1e5319}, REQ-SEC-{292daffe,bb8e4dce,5f675c2f,e412df5e,9467cfbc}. Renderer controls/live privacy reconciliation/Retry remain unimplemented; no UI or native acceptance claimed.
- 2026-11-19 build: red: pinned vitest renderer/components/session/plan-review-retry.test.ts exit 1 - four expected behavior failures after fixtures succeed: generic review Retry ordinary-sends instead of scoped restore, fails to retain restore errors/ack guards, permits archived Retry, and leaves running-review text enabled. Covers REQ-REL-0dca1c44, REQ-SEC-5f675c2f, REQ-SEC-292daffe and REQ-SEC-4a5e9261; existing ordinary Retry must stay unchanged.
- 2026-11-19 build: green: pinned vitest renderer/components/session/plan-review-retry.test.ts exit 0 (4 tests); typecheck exit 0. Review-associated transcript Retry now restores scoped feedback with synchronous duplicate/authority/unmount guards and en/ro/de/fr notice, never ordinary-sends; active-review text locks while Stop stays enabled, ordinary Retry unchanged (REQ-REL-0dca1c44, REQ-SEC-5f675c2f, REQ-SEC-292daffe). red: pinned vitest renderer/hooks/session-privacy.test.ts exit 1 (three expected missing privacy-refresh failures, one existing keyed-context control passes): unchanged-seq settings/config/model disclosure refresh does not happen and old projected content remains visible; shared two-consumer/in-flight/frame isolation proof targets REQ-FUNC-a1040002 and REQ-REL-4bea0006.
- 2026-11-19 build: red: privacy increment exposed a model-picker consumer regression, and pinned vitest plan-review-retry.test.ts now explicitly proves composer unmount loses unsent input while projection is hidden (1 failed/4 passed). Preserve only composer control metadata and its mounted local draft while removing disclosed transcript/plan content; retain disabled sending and usable Stop. Existing hook/Plan/Changes tests also require topic-specific subscription accounting now that privacy notifications are subscribed separately, not additional session loops (REQ-FUNC-a1040002, REQ-REL-4bea0006).
- 2026-11-19 build: green: cd 05_Software && python ../02_Tools/environment/npmw.py npx vitest run src/apps/desktop/src/renderer/hooks/{session-privacy,use-session-events}.test.ts src/apps/desktop/src/renderer/components/session/{plan-tab,changes-tab,artifacts-tab,plan-review-retry,workspace}.test.ts exit 0 (7 files/87 tests). After narrowing composer/reasoning metadata types and retaining the reasoning control value, final focused command: npmw.py npx vitest run src/apps/desktop/src/renderer/components/session/workspace.test.ts src/apps/desktop/src/renderer/components/session/plan-review-retry.test.ts src/apps/desktop/src/renderer/hooks/session-privacy.test.ts tests/tooling/boundaries.test.ts exit 0 (4 files/75 tests); npm run typecheck exit 0. Shared privacy epoch now hides obsolete disclosure at unchanged seq, invalidates in-flight replies/frames and model/config changes, with one session loop. Composer keeps only control metadata plus its local unsent draft; sending locks during refresh/review, Stop remains available. Existing jsdom canvas notices are not browser/native proof. ReasoningPicker changed only its consumed metadata type, an immediate composer consumer within the existing chat-ui component.
- 2026-11-19 build: Traceability/docs checkpoint: activated six fully verified backend contracts (REQ-DATA-0f69ffdd, REQ-REL-2e0ba7fb/239f8647/ce1e5319/02c0e68e, REQ-SEC-e412df5e); remaining 23 new cross-layer records stay draft. Added owned source/test links, current runtime/session/Plan/chat knowledge and changed API docstrings. Added one CHANGELOG line and four-language safe-Retry release entry; consolidated the two related Files new entries as required to retain the release-note ten-entry category cap. Final pinned npm run lint, typecheck, check:i18n, check:help and check:release-notes all exit 0; lint has the same seven warnings/23 infos in unchanged baseline files. git diff --check exits 0. Existing core 10-file/120-test and main/preload 4-file/46-test proofs are reused; later core/main three-file/21-test proof strengthens two-comment atomic rollback/reopen and admission races. No complete/plugin suite, real browser/native acceptance, live-model compliance or independent review is claimed.
- 2026-11-19 build: DEVIATION build: accept 19 remaining stale-paths findings only for the still-unimplemented renderer plan-feedback.tsx at this bounded incomplete checkpoint - editor/selection/indicators/history, mocks, complete locales/help/notes and browser acceptance must be completed before build advances. Final strict AEGIS JSON exits 0 (errors=0, warnings=46, notes=39, no uncovered-source/context-size findings); other warnings are 12 baseline ticket-ref, 13 baseline journal-header and two outside-layout findings for root-mandated CHANGELOG/release-notes files not covered by existing AEGIS globs. No suppression/config/payload changes. Evolution waits until all requirements are green; both independent reviews remain unrecorded. Scratch JSON was removed. No commits/publication, human decision or sandbox weakening.
- 2026-11-19 build: Build continuation at clean ADORE checkpoint 80ac65b2 on recorded branch; setup.py --check exit 0, original anchor retained and unchanged backend proof reused. red: pinned vitest renderer/components/session/plan-feedback.test.ts exit 1 - six expected missing live controls/editor failures, after snapshot/subscription fixtures initialize: exact duplicate/Unicode CRUD, fragment/empty-step selection, stale resolution, same-tick/lost-ack review identity, editor privacy capture invalidation and authority disables (REQ-FUNC-dfa01734/566e4205/10533e00/14c661ce/5536a651, REQ-UX-e86663cb/98d58422, REQ-REL-e048aed0, REQ-SEC-4a5e9261, REQ-FUNC-a1040002).
- 2026-11-19 build: green: pinned vitest renderer/components/session/plan-feedback.test.ts exit 0 (six tests); typecheck exit 0. Added live PlanFeedback with exact occurrence/UTF16 targets and keyboard selector, native retained editor, draft CRUD/re-anchor, separate current draft/submitted indicators, stale list, collapsed paged immutable history/restore, scoped synchronous duplicate/completion guards, and original-pair lost-ack reconciliation. PlanItems factored into its own shared readonly/live-slot module to avoid a circular dependency, preserving the existing export for historical consumers. Integrated current workbench/archive gates and en/ro/de/fr labels. One fixture interaction now explicitly reopens a collapsed draft disclosure after successful snapshot refresh. Browser mocks/real-browser checks and remaining cross-layer traceability/docs/reviews remain incomplete; this is focused component proof only.
- 2026-11-19 build: red: strengthened plan-feedback.test.ts exposes lost-ack UI defect after creating a later draft: fresh Review remains enabled and an unrelated successful draft mutation clears the Retry control. Original-pair reconciliation must stay explicit/visible until settled, separate from later draft success (REQ-REL-e048aed0, REQ-DATA-0f69ffdd). Five other editor foundation cases still pass.
- 2026-11-19 build: green: pinned vitest renderer/components/session/{plan-feedback,plan-tab}.test.ts exit 0, 2 files/15 tests; typecheck exit 0. Original-pair Retry remains visible independently of later draft success; fresh Review is blocked until acknowledgement settles. Added pointer/backwards/cross-row selection and same-tick save, conflict retain/recapture, empty-plan immutable history/restore, navigation late-ack isolation and Escape/focus tests. red: pinned vitest renderer/mocks/plan-feedback.test.ts exit 1 (two NOT_FOUND failures at new feedback routes after existing ordinary-plan fixtures complete). Browser mocks still lack scoped CRUD/review/restore/receipts and review-specific no-steering behavior (REQ-FUNC-5536a651, REQ-REL-e048aed0/0dca1c44, REQ-SEC-292daffe/5f675c2f).
- 2026-11-19 build: green: pinned vitest renderer/mocks/{plan-feedback,sessions,mockApi}.test.ts exit 0 (3 files/29 tests); typecheck exit 0. Mock channels use shared strict schemas/events, original-pair receipts, source-linked restore, current scope/CAS/authority and todo-only response; ordinary review steering is BUSY. Installed pinned Playwright Chromium into the container's standard browser cache, without dependency/lockfile or application sandbox changes. red: pinned Playwright tests/e2e/plan-review.spec.ts exit 1 at native keyboard fragment selection: focused HTML-readonly textarea stays [0,0] after ArrowRight/Shift+ArrowRight. A standalone Chromium readonly textarea reproduces it (Ctrl+A works, caret navigation does not). Replace the DOM readonly attribute with equivalent aria-readonly plus cancelable native beforeinput/edit guards so standard native Shift navigation works; preserve exact displayed text. This adjusts the private selector mechanism, not the D6 readonly/exact-selection contract (REQ-UX-98d58422, REQ-FUNC-14c661ce). Initial explicit output-directory choice was safely refused by the installed cleanup reporter; corrected to its required vera-e2e-output-* prefix; owned run output auto-cleans.
- 2026-11-19 build: green: pinned Playwright plan-review.spec.ts exit 0 (one real Chromium test, 12s): four languages, two themes/five text scales at minimum viewport/panel geometry; exact native keyboard UTF16 emoji capture and readonly edit guards, multiline/whitespace, duplicate/empty occurrences, private draft metadata, explicit todo-only same-chat response/history and zero observed outbound requests. Corrected the browser snapshot helper to the existing session.get request shape (sessionId only); public strict schema correctly rejected extra workbenchId. Native Electron/Windows/live-model proof is not claimed. Extended browser coverage to mouse selection/Escape/lost acknowledgements; its current pointer-coordinate failure follows opener focus scrolling and needs fixture repair, not weaker selection checks. red: pinned component plan-feedback.test.ts exit 1 (11 pass/one new failure): feedback remains editable during a held save, so later typing could be discarded on acknowledgement. Lock edits while saving and retain text on failure (REQ-REL-e048aed0, REQ-UX-98d58422).
- 2026-11-19 build: Recovery after conductor timeout: same HEAD 80ac65b2 and intact uncommitted D6 candidate; no checkpoint/integration change. green from preceding process: pinned biome check --write exit 0 for 18 owned files; typecheck exit 0; vitest renderer/components/session/{plan-feedback,plan-tab,plan-review-retry,workspace}.test.ts hooks/session-privacy.test.ts mocks/{plan-feedback,sessions,mockApi}.test.ts tests/tooling/boundaries.test.ts exit 0 (9 files/128 tests). Held-save feedback now locks until acknowledgement/failure; explicit errors retain its text. Browser pointer coordinates are freshly measured after each focus scroll rather than weakening quote checks. VERA_E2E_OUTPUT_DIR=/tmp/vera-e2e-output-TASK-c33386cb-browser pinned playwright test tests/e2e/plan-review.spec.ts --workers=1 exit 0 (2 tests, 19.6s): all four languages, both themes/all six text scales, minimum geometry, native forward/backwards Unicode Shift selection, mouse selection before focus, Escape focus return, strict readonly selector guards, keyboard-only CRUD/re-anchor/review, immutable history and unknown-ack original-pair reconciliation. No native Electron/Windows/live-model or independent-review proof claimed. Current four-language help, README inventory and expanded release entry await final static checks and traceability activation.
- 2026-11-19 build: Final build coverage strengthening: pinned vitest components/session/plan-feedback.test.ts and core sessions/{plan-review,review-turn}.test.ts exit 0 (3 files/40 tests), typecheck exit 0. Explicitly proved distinct current draft/submitted indicators and removed context, preacceptance visible refusal/navigation/retry, two independent Unicode/stale draft sets through real SQLite reopen, durable undelivered queue rejection after reopen, and actual same-session clarification/explanation text. Calibrated explanation assertion to the existing two-step replay's legitimate empty tool-call assistant item plus final prose; no production change. Pinned Playwright plan-review.spec.ts --grep keyboard-only exit 0: enlarged minimum panel, reduced-motion media, real Tab order/named controls, computed focus outline, backwards Unicode selection and full keyboard CRUD/re-anchor/review. Unchanged four-language/theme/six-scale/pointer/lost-ack browser proof reused. Final npm run lint, check:i18n, check:help, check:release-notes and git diff --check exit 0 (baseline lint seven warnings/23 infos). Requirement verifications were reread against linked evidence; complete new cross-layer contracts can now be activated; native Electron/Windows and independent reviews remain validate/platform work, not claimed from browser fixtures.
- 2026-11-19 build: red: pinned vitest plan-feedback.test.ts -t CRLF exit 1 (one expected missing-behavior failure, 22 unrelated cases skipped). Native textarea normalizes CRLF/lone CR for display; using its offsets against original text drops an emoji fragment to whole-step instead of preserving exact source UTF16 offsets. Add explicit view-to-source offset mapping without changing stored step/quote strings, and derive pointer quotes from the verified exact text span rather than Selection's rendered-text normalization (REQ-DATA-fa8543aa, REQ-FUNC-dfa01734, REQ-UX-f205aabf). No requirement or numeric bound changes.
- 2026-11-19 build: green: pinned vitest components/session/{plan-feedback,plan-tab}.test.ts exit 0 (2 files/27 tests), typecheck exit 0; pinned Playwright tests/e2e/{plan-review,plan-fragments}.spec.ts --workers=1 exit 0 (3 real Chromium tests, 22.7s). CRLF/lone-CR native offsets now map to unchanged original UTF16 strings; pointer quotes come from verified exact DOM text ranges. Native forward/backward Unicode selection, whole multiline ranges and rendered-versus-source newline handling preserve exact targets. Current four-language/theme/all-six-scale, pointer/Escape/ack and keyboard CRUD proofs reran green after this selector change. No dependency/schema/format/quota changes. Initial documented native selector red also covers REQ-UX-f205aabf, not just the disable/re-anchor records named there.
- 2026-11-19 build: DEVIATION build: D6 history/indicator/restore presentation branch assertions were completed after the initial six missing-controls/editor red tests, rather than each having an isolated preimplementation red - accepted as a test-order limitation, not missing functional proof; current component, real-browser and earlier durable-history/restore core tests pass. No historical red/green events were fabricated or rewritten. Both independent reviews and native/platform validation remain separate next-stage obligations.
- 2026-11-19 build: Build traceability/evolution complete: all 37 header requirements (29 new plus eight reused) are active with current existing affected paths and linked tests; inline TOML/path audit exit 0. Updated the active protocol and baseline Plan spec to remove the superseded display-only limitation, document guarded native selection/source-newline mapping, and retain bounded todo/atomicity/privacy contracts. Updated Plan/chat knowledge, README inventory, four-language help and one complete four-language release entry; existing CHANGELOG line retained. Final evolution --task TASK-c33386cb reports 67 paths (24 added/43 modified/0 removed); reviewed every path against D1-D6: shared events/targets, core review/runtime, captured/probe-free main IPC, keyed renderer/editor/privacy/Retry, private mock/selection/history helpers, focused tests and feature docs. No unplanned product area, dependency/lockfile, plugin/version, migration or schema change. Original anchor retained; refreshed evolution includes the CRLF refinement and extra browser scenario.
- 2026-11-19 build: Final strict check --task TASK-c33386cb --strict --json exit 0: errors=0 warnings=31 notes=38, promoted=0; no uncovered-source, stale-paths or context-size findings. Warnings explained: 12 pre-existing ticket-ref and 13 pre-existing journal-header findings outside this task; six outside-layout findings are mandated CHANGELOG/release-notes plus four existing app help pages, accepted in their responsibility-owned locations without weakening AEGIS globs. git diff --check exit 0. Prior backend/core/main/preload proof remains valid; focused new/refined component/core/real-browser proof and statics are logged above. Full/plugin suites, native Electron/Windows acceptance, live-model quality and both independent review verdicts were not run/claimed in build; carry relevant platform checks and separate-context reviews into validate under verification-policy.md, without routine full-suite retesting. No commit/publication or sandbox weakening.
- 2026-11-19 build: completed; next validate
- 2026-11-19 validate: Validate integration recovery: HEAD d2ea268766d62bc6911198849cd90e78c94fb9f4 on the recorded branch contains an in-progress origin/master integration. Reconciled all nine conflicted worktree files, retaining Plan review admission/receipt/Stop/privacy safeguards together with target delegation staging and image support. Updated new input-capability test fixtures and metadata run callsites; added image-review no-file-read/no-steering and ordinary image-Retry regressions. Updated project/Plan knowledge and consolidated related indexing release notes to retain the ten-new-entry limit. Conflict markers absent and git diff --check exit 0. Index deliberately not staged under repository handover policy; conductor owns integration index/checkpoint. No commit/publication or sandbox change.
- 2026-11-19 validate: Integration evidence: setup.py --check initially reported dependencies older than the integrated lockfile; setup.py ran pinned npm ci successfully (exit 0; eight moderate audit advisories unchanged/out of scope). Pinned npm run typecheck exit 0 after input/callsite reconciliation. Focused integrated Vitest run exit 0: 19 files/234 tests covering shared state/anchors, core review/restore/delegation/images/service, main review/host and renderer feedback/Retry/mocks. Added seam regressions then passed 2 files/13 tests (review-boundary and plan-review-retry); release-note check exit 0. No full or plugin suite run.
- 2026-11-19 validate: Validate finding: pinned npm run test:e2e -- tests/e2e/plan.spec.ts tests/e2e/plan-review.spec.ts tests/e2e/plan-fragments.spec.ts exit 1. All three real Chromium feedback/fragment cases passed; sandboxed native Electron live replacement and real restart case passed in this Linux container (not Windows/native Ubuntu acceptance). Existing browser Plan translated-status case failed at plan.spec.ts:349: an extra initial Plan feedback targets list precedes the three expected replacements. Inspection of mocks/sessions.ts session.create reuseEmpty and session-fixtures.ts shows the new feedback fixture has todo metadata but no user event and is eligible as an unused session, so New session reuses a nonempty Plan fixture. This is a ticket-introduced fixture/admission assumption defect, not a test to weaken. Return to build for a focused mock fixture/reuse correction and regression, then rerun affected browser Plan proof. Two separate read-only reviewer contexts were started but stopped when this failure required backrouting; neither returned a verdict, so none is recorded. Final strict proof/report/closure were not performed.
- 2026-11-19 validate: returned to build - Existing browser Plan acceptance fails because the new Plan feedback targets mock fixture is eligible for unused-session reuse despite its seeded todo list; correct fixture/reuse behavior with a focused regression, preserve the nine prepared integration resolutions, and rerun affected Plan acceptance before returning to validate.

## Rulings

- RULING-001 | date=2026-11-19 | decision=Review admission excludes active and recovered queued work; ordinary sends during a review return BUSY, and all review phases including preparation are revision-only. | reason=The requested no-execution guarantee cannot be enforced by sending review text through ordinary execution-capable steering; observed SessionsHost preparation may also probe programs. | source=technical | supersedes=none
- RULING-002 | date=2026-11-19 | decision=Use revision/occurrence/quoted-context anchors with exact validated-projection UTF16 ranges; invalid targets use INVALID, stale snapshots CONFLICT, busy admission BUSY, unwritable/archive DENIED and foreign feedback NOT_FOUND. | reason=Optional and repeated IDs are not identity, renderer text may be projected, and the existing shared error vocabulary supports explicit testable refusals without a new transport. | source=technical | supersedes=none
- RULING-003 | date=2026-11-19 | decision=Distinguish unsent drafts, atomic submitted acceptance and retained unsuccessful review history; reconcile acknowledgement retries idempotently and revalidate explicit failed-turn retries against the current plan. | reason=Ticket lifecycle requires failure retention, a visible submitted/draft distinction, no duplicates and preservation of previously reviewed text; acceptance failure and post-acceptance model failure are different durable states. | source=technical | supersedes=none
- RULING-004 | date=2026-11-19 | decision=D1-D2 use replayed plan/feedback counters and existing format-1 session events; all later whole-plan replacements stale old anchors, and host validation shares the exact projected todo text with desktop presentation. | reason=Whole-list todo updates provide no reliable occurrence continuity, duplicate or absent item IDs cannot identify steps, and the existing event store already supplies durable scoped snapshots without schema changes. | source=technical | supersedes=none
- RULING-005 | date=2026-11-19 | decision=D3-D5 introduce scoped metadata/review IPC, capture the originating DB before serial enqueue, and use probe-free review preparation plus a built-in-todo-only runtime; generic review Retry restores feedback instead of calling ordinary send. | reason=Observed SessionsHost ordinary preparation can probe programs, queued operations otherwise acquire a later workbench, and Workspace Retry currently resends last.text through execution-capable send; all three seams need explicit guards. | source=technical | supersedes=none
- RULING-006 | date=2026-11-19 | decision=D4 atomically records the submitted envelope, one user message and the started turn before dispatch; scoped expected plan/feedback counter pairs are durable receipts, with optional runtime requestIdentity preventing duplicate initial persistence. | reason=Acceptance changes the feedback counter, making an accepted pair unique across reopen; precommitted identities avoid replaying model requests after lost acknowledgements or exposing partial submission state to reentrant observers. | source=technical | supersedes=none


## State

status: waiting
reported: build - paused
next: continue build: Existing browser Plan acceptance fails because the new Plan feedback targets mock fixture is eligible for unused-session reuse despite its seeded todo list; correct fixture/reuse behavior with a focused regression, preserve the nine prepared integration resolutions, and rerun affected Plan acceptance before returning to validate.
must_read: .agentic/tasks/TASK-c33386cb.md, .agentic/steps/4_build.md
changed: Prepared nine integration conflict resolutions plus scoped image/delegation seam tests, capability fixtures, metadata run callsites, Plan/project knowledge and release-note reconciliation; preserved all target changes without staging or committing.
evidence: Typecheck exit 0; integrated focused Vitest 19 files/234 tests exit 0; new seam regressions 2 files/13 tests exit 0; release-note check exit 0; E2E exit 1: three Chromium feedback cases and native Electron restart passed, existing browser Plan status case failed.
issues: Build must correct seeded Plan fixture unused-session reuse and rerun affected browser Plan acceptance. Unmerged index awaits conductor staging of prepared resolutions. Both independent verdicts, final strict proof/report and Windows/native Ubuntu acceptance remain unperformed; no full/plugin/live-model proof claimed.
spec_compliance:
implementation_quality:
review_round:
