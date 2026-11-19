# TASK-c33386cb - Plan: add comments and Review plan to request an agent revision

stage: specify
type: feature
interaction: autopilot
requirements: REQ-FUNC-2e8a54c7, REQ-DATA-d968385c, REQ-UX-8d3039aa, REQ-REL-4bea0006
parent:
branch: adore/gitea-dpasare-2026_Virtual_Embedded_Rig_Assistant-318-p9fda84577701
base: 52cf2a57c0314d8937a4402df10763548efce498
opened: 2026-11-19

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] every accepted behavior is one coverage row with exactly one requirement
- [ ] each error or failure response has its own requirement
- [ ] each requirement is one self-contained "shall" sentence
- [ ] verification names setup, trigger, oracle and a boundary or failure
- [ ] specs written only where the requirement cannot carry the detail
- [ ] conflicts, assumptions and unknowns resolved or recorded
- [ ] every ID on the journal's `requirements:` line; `check` shows no
      format errors

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


## Design


## Log

- 2026-11-19 frame: journal opened
- 2026-11-19 frame: Framed ticket #318 as one cross-layer Plan comments/review feature; retained baseline todo bounds/atomicity/shared-view requirements and identified new coverage for specify. Explicit conductor authority sets autopilot and frame-only execution; no child tasks or commits, with publication approval reserved to ADORE. Existing read-only Plan UI limitation is explicitly changed by the ticket, not a reason to weaken execution restrictions.
- 2026-11-19 frame: completed; next specify - Frame completed and scope recorded under conductor-authorized autopilot; no decision-blocking question; stop at this stage boundary.

## Rulings


## State

status: ready
reported: frame - completed
next: start specify: read .agentic/steps/2_specify.md
must_read: .agentic/tasks/TASK-c33386cb.md, .agentic/steps/2_specify.md
changed: Completed Frame and seven-item audit in .agentic/tasks/TASK-c33386cb.md; recorded four existing baseline requirement IDs, ticket scope, safety/lifecycle constraints, evidence and implementation unknowns. No product changes.
evidence: git diff --check: exit 0; python .agentic/aegis.py check --task TASK-c33386cb --full: exit 0, errors=0 warnings=25 notes=39. Current branch matches journal; source/test definitions inspected only.
issues: Advisory warnings concern unchanged requirements/other journals; this task has only a no-anchor note expected before build. Product tests, statics, independent reviews and platform/browser acceptance not run in frame; new comment/review requirements remain for specify.
spec_compliance:
implementation_quality:
review_round:
