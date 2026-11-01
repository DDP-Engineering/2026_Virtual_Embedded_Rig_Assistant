# TASK-2fef1397 - Attach Docs tree entries as context to the chat

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-541a5bee, REQ-UX-b5edf930, REQ-UX-f8ec3a43, REQ-FUNC-47287974, REQ-FUNC-a2f48847, REQ-FUNC-9441c5d6
parent:
branch: master
base: b53d1420fbd9eb4c6d85373ce900d901c6e0bdb0
opened: 2026-11-01

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

Problem: STATED: the Docs tree's right-click menu should offer "attach as context", like Claude
  desktop. OBSERVED: session.send carries only text; the composer (session/composer.tsx) already
  completes `@` against `workbench.files` but inserts the bare path; the agent's instructions
  (core agent/prompt.ts) say nothing about attached files; the Docs tab is shown even when no
  chat is open (App.tsx renders SessionWorkspace only while `chat` is set).
Desired outcome: choosing Attach as context on a tree row adds the entry as a chip above the
  chat's message box (RULING-001); if no chat is open, VERA opens the active session, or creates
  or reuses an empty one, first (RULING-002); on send the message ends with `@path` mentions of
  the attached entries and the agent's instructions say that `@path` names a workbench entry the
  user attached for it to read with its tools (RULING-003). Ignored entries cannot be attached
  (TASK-b34f2cc7 RULING-002).
Actors: the desktop user; the Docs tree menu; the session composer; the agent runtime's prompt.
Primary scenario: on the workbench page the user right-clicks `docs/a.pdf` -> Attach as context;
  VERA shows the active session's chat with a chip "a.pdf" above the message box; the user types
  "Summarize this" and sends; the transcript shows "Summarize this" followed by `@docs/a.pdf`, and
  the agent reads the PDF with its document tools.
Examples: none beyond the scenario.
Counterexamples: an ignored `node_modules/x/README.md` shows Attach as context disabled; attaching
  the same entry twice keeps one chip; a read-only workbench cannot send, so Attach is disabled
  there (review round 1: the whole read-only workbench, not only without a session).
In scope:
- Attach as context item in the row menu (disabled for ignored entries).
- Per-session attachment chips above the message box, removable, kept until sent.
- Opening or creating the session when no chat is open.
- `@path` mentions appended on send; the agent instruction about them.
- Tests: renderer, core prompt, native or browser e2e.
Out of scope: changing the existing `@` completion (it keeps inserting bare paths); embedding file
  contents in the message (the user chose chips with mentions, RULING-001); Rename/Delete.
Constraints: on master, uncommitted; LF; en/ro/de; session.send stays text-only (no new wire
  format).
Success signals: a chip appears in the right chat after Attach; send produces text ending with
  the mentions and clears the chips; the agent prompt contains the mention rule; ignored entries
  cannot be attached.
Evidence: composer.tsx (`detect`, `choose`, `submit`), App.tsx (`chat`, `activeSession`,
  `create` with `reuseEmpty: true`, `openSession`, `composerFocus`), core agent/prompt.ts,
  shared ipc.ts `session.send {sessionId, text}`.
Assumptions: INFERRED: the agent can read any non-ignored workbench path the mention names with
  its existing file and document tools, subject to its permissions.
Unknowns: the mention syntax for paths with spaces; the number of chips allowed; where the
  mentions go when the message has no text.
Decision-blocking questions: none; the user chose chips, opening the chat and `@path` mentions.
Proposed behaviors (not accepted):
- A path with whitespace is written `@"path with spaces"`.
- At most 20 attachments per message; Attach is disabled once 20 are pending.
- With only attachments and no text, the message is the mentions alone.
- Chips show the entry's name with its path as tooltip and a remove button named after it.
- The mentions follow the text on a new line, separated by spaces.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new menu item, chips, message mentions |
| no new interface or data format | no | a mention convention in user messages |
| no new dependency | yes | none |
| an existing requirement already covers the behavior | no | no attachment requirement |
| no security or data-handling change | no | the agent prompt gains an instruction |

Full path: new behavior and an agent-facing convention.

## Requirement coverage

| Behavior | Requirement | Source in Frame |
|---|---|---|
| Attach as context in the row menu | REQ-UX-541a5bee (revised) | RULING-001 |
| attach adds a chip, opening or creating the chat; disabled for ignored, read-only, 20 pending | REQ-UX-b5edf930 | RULING-001, RULING-002 |
| chips with name, tooltip, remove button, per session until sent | REQ-UX-f8ec3a43 | RULING-001 |
| send appends @path mentions, clears on success, keeps on failure | REQ-FUNC-47287974 | RULING-003 |
| agent instruction about @path mentions | REQ-FUNC-a2f48847 | RULING-003 |
| the prompt holds nine canonical rules | REQ-FUNC-9441c5d6 (revised) | RULING-003 |

Revised: REQ-UX-541a5bee (Attach as context joins the row menu after Open); REQ-FUNC-9441c5d6 and its spec (nine rules instead of eight, review round 1). Accepted proposals:
`@"path"` for whitespace; at most 20 attachments; mentions alone when the text is empty; chips
with name, path tooltip and a named remove button; mentions on a new line after the text. The
existing `@` completion keeps inserting bare paths (Frame, out of scope).

## Design

**Approach.**
- `renderer/lib/attachments.ts` holds the pure rules: `ATTACHMENT_LIMIT = 20`,
  `addAttachment(list, path)` (no duplicates, nothing past the limit), `mention(path)` (`@path`,
  or `@"path"` when it contains whitespace) and `withMentions(text, paths)` (trimmed text, a new
  line, the mentions separated by spaces; the mentions alone for empty text) (REQ-FUNC-47287974,
  REQ-UX-b5edf930).
- `components/session/attachments.tsx` defines `AttachmentsContext` `{list(sessionId),
  remove(sessionId, path), clear(sessionId, paths), attach?(path), full}`. App provides it from a
  `Record<sessionId, string[]>` state. `attach(path)` adds the path to the active session and opens
  that session's chat with composer focus; with no active session it runs the existing `create`
  (session.create with reuseEmpty) and adds the path to the created session; App leaves `attach`
  undefined in a read-only workbench or without one, and `full` tells whether the target session
  holds 20 (REQ-UX-b5edf930, RULING-002).
- `DocsTree` adds "Attach as context" after Open when the context exists; it is disabled for
  ignored rows, without `attach` and when `full` (REQ-UX-541a5bee, REQ-UX-b5edf930,
  TASK-b34f2cc7 RULING-002). `TreeMenu` items gain `disabled`: `aria-disabled="true"`, still
  focusable and navigable, click, Enter and Space do nothing.
- `Composer` reads its session's attachments and shows them above the message box as a labelled
  list of chips: the entry's name, its path as title, and a remove button named "Remove
  attachment: <path>" (REQ-UX-f8ec3a43). Submit sends `withMentions(text, attached)`, is allowed
  with attachments and empty text, clears the sent paths when the send is accepted and keeps text
  and chips when it is not (REQ-FUNC-47287974).
- Core `agent/prompt.ts` gains a rule: an `@path` (or `@"path"`) in the user's message names a
  workbench file or folder the user attached; read it with the file or document tools before
  answering (REQ-FUNC-a2f48847).
- Rejected: a wire field for attachments on session.send (the user chose mentions; text keeps
  sessions and exports unchanged); embedding file contents (RULING-001).

**Interfaces and data.**
- No IPC change; session.send stays `{sessionId, text}`. Attachments live in renderer memory per
  session until sent or the app closes.
- Locales: `documents.attach` ("Attach as context"), `chat.attachments` ("Attached files"),
  `chat.removeAttachment` ("Remove attachment: {{path}}").

**Files and test seams.**
- lib/attachments.ts + attachments.test.ts (rules); components/session/attachments.tsx; App.tsx
  (state, provider, create continuation); composer.tsx; documents/docs-tree.tsx, tree-menu.tsx;
  styles.css; locales; core agent/prompt.ts + prompt.test.ts.
- docs-tree.test.ts with a stub context (item order, disabled for ignored, attach called);
  a new App-level components/session/attachments.test.ts with the chat mock (attach from the
  workbench page, duplicate, ignored, no session -> created, per-session chips, remove, send with
  mentions, failed send keeps chips).

**Risks and open decisions.**
- Attached paths are not re-checked until the agent reads them; a deleted file fails in the
  agent's tool call like any other path.
- `prompt-usage` counts may change with the new rule; they are updated, not loosened.
- No open product decisions.

**Requirement map.** As in the coverage table; each decision cites its requirement above.

Diagrams: [diagram_TASK-2fef1397.md](diagram_TASK-2fef1397.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: tests first: lib/attachments.test, session/attachments.test (App flow), docs-tree attach test, prompt rule test failed before implementation. green: lib 2, App flow 3, docs-tree, prompt 18 (6 snapshots updated for the new rule; the test's rule list extended) pass; only pre-existing 'bounds large text DOM' and 'Settings selects one page' fail; tsc -b, biome, check:i18n clean; e2e docs-tree (native Attach creates a session and shows the chip), documents, citations pass
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1 findings: REQ-FUNC-9441c5d6 and its spec still say eight prompt rules (and 00_Planning 03-agent-and-tools.md §3 lacks the @path rule); read-only and full gating untested through App; REQ-UX-f8ec3a43 verification exceeds the assertions (second chip, removing docs/a.pdf, a second session's own chip); affected_paths (workspace.tsx vs App.tsx, attachments.tsx); Frame counterexample on read-only; removing a chip drops focus; DocsTree header comment omits Attach; failed-send test uses mockImplementationOnce and can race with polls. Outside the task, on the user's request: the Docs tab label became Files (minor UI change, no AEGIS)
- 2026-11-01 validate: returned to build - review round 1: rule count, App gating tests, chip assertions, focus after remove, paths, flaky spy
- 2026-11-01 build: round 1 fixes green: chip removal keeps focus in the message box; App test asserts both chips, removes docs/a.pdf, gives the second session its own chip and fails send through a flag instead of mockImplementationOnce; new App-level read-only test (item disabled, nothing attached); REQ-FUNC-9441c5d6 + spec now nine rules (added to requirements and coverage), REQ-UX-b5edf930/f8ec3a43 verification and paths fixed, Frame counterexample updated; 00_Planning 03-agent-and-tools.md §3 gained the @path rule (outside AEGIS); DocsTree comment. Focused vitest pass except pre-existing; tsc clean. e2e rerun pending: port 5173 is used by the user's running VERA
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 2: spec - the read-only App test is not in REQ-UX-b5edf930 linked_tests; quality approved
- 2026-11-01 validate: returned to build - review round 2: link the read-only test
- 2026-11-01 build: round 2 fix: REQ-UX-b5edf930 links attachments-read-only.test.ts; no code change
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-2fef1397 --strict --run exit 0 (typecheck, lint, i18n ok; tests not in [check] run); full vitest after the last code edit: 1133 passed, 4 failed, all pre-existing and out of scope (sessions compaction transcript, write-edit registry, documents 'bounds large text DOM', workspace 'Settings selects one page'); e2e docs-tree, documents, citations, office-documents, pdf-download passed after the last code change; evolution lists 21 files, including the user-requested Docs->Files label change (locales, citations/office e2e selectors) made outside this task; 182 check warnings are repository-wide legacy notes
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-11-01 | decision=Attach as context adds the entry as a removable chip above the chat's message box; the agent reads it with its own tools | reason=user chose 'File chip in composer' | source=user | supersedes=none
- RULING-002 | date=2026-11-01 | decision=When no chat is open, Attach as context opens the active session, or a new or reused empty session, and adds the chip there | reason=user chose 'Opens the chat and adds the chip' | source=user | supersedes=none
- RULING-003 | date=2026-11-01 | decision=On send the message ends with @path mentions of the attached entries, and the agent's instructions explain that @path names an attached workbench entry to read | reason=user chose '@path mentions' | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-2fef1397.md
changed: 4 created, 1 revised (REQ-UX-541a5bee)
evidence: check --strict --run exit 0; e2e 5 passed; vitest only pre-existing failures
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-541a5bee - Offer a context menu on Docs tree items
  - REQ-UX-b5edf930 - Attach a Docs tree entry to the chat
  - REQ-UX-f8ec3a43 - Show and remove the entries attached to a chat
  - REQ-FUNC-47287974 - Send attached entries as @path mentions
  - REQ-FUNC-a2f48847 - Explain @path mentions to the agent
  - REQ-FUNC-9441c5d6 - Compose the canonical engineering system prompt
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base b53d142: 310 file(s) changed, 20852 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=182 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
