# M5 — Version 1.0

PURPOSE: the finish that makes VERA usable every day — long sessions, interaction during a turn,
export, fictional verification fixtures, accessibility and reviewed translations.
STATE: 2026-11-01 — implemented; WP-34…WP-38 and the M5 epic are closed in Gitea (WP-37 is still
titled "Demo workbench, sample skills, onboarding" there). This file is now a historical record of
the plan: the WP text below is unchanged, and [Implementation notes](#implementation-notes-2026-11-01)
record what the code does. In "Start from" lines, read `09_Others/benchpilot-reference/src/apps/…`
as `…/apps/…`.
DONE-WHEN: long sessions survive context limits; messages can be sent during a turn; sessions export;
the fictional workbench remains a verification fixture; `ro` and `de` are reviewed; the clean-machine run of WP-33
passes on the 1.0 build.

## WP-34 Advanced context compaction

**Goal:** retain useful historical context in long sessions, extending the budget protection already
working in M1.
**Depends on:** WP-10, WP-13, WP-14. **Specs:** 03 §2 (M1 budget and M5 compaction), §7; 04 §7.

Scope:
- Above 80 % of the input budget, summarise completed historical exchanges while preserving current
  instructions, decisions, source refs and outstanding work. The full history stays in the database
  and transcript; summaries are derived context, not replacements for persisted messages.
- Summary requests themselves pass the M1 context policy and output reserve. Limit compaction to
  one attempt per normal model request; then recheck the budget. If there is no historical exchange
  to summarise, use the M1 current-turn reduction and explicit context-limit outcome.
- Extend the M1 context meter with compaction status and the size of the resulting request view.

Done when:
- [ ] Integration: a multi-turn replay session exceeds a small window and continues with a summary
  that preserves decisions and refs; every normal and summary request meets its input budget.
- [ ] Integration: a long first turn, an oversized current instruction, a smaller-model switch and a
  failed summary retain the M1 budget and limit semantics; no unbounded compaction retry occurs.
- [ ] The transcript still shows the full history after compaction.

## WP-35 Messages during a running turn

**Goal:** the user can steer the agent while it works.
**Depends on:** WP-13, WP-14. **Specs:** 03 §2 (steering).

Scope:
- The composer stays enabled during a turn (except while an approval waits); a message sent then is
  queued and given to the model before its next call.
- Queued messages show as pending in the transcript until delivered.

Done when:
- [ ] Integration: a message sent between two tool calls reaches the next model call.
- [ ] e2e: the pending marker disappears when the message is delivered.

## WP-36 Session export and search

**Goal:** sessions can leave VERA and be found again.
**Depends on:** WP-13. **Specs:** 02 §10; 06 §3.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/reports/export.ts` (Markdown export).

Scope:
- Export a session as Markdown (messages, tool summaries, citations, changes) or JSON (events).
- Search sessions by title and message text.

Done when:
- [ ] Unit: the Markdown export of a fixture session matches its snapshot; the JSON export round-trips.
- [ ] e2e: search finds a session by a word from its messages.

## WP-37 Fictional verification fixtures

**Goal:** verification uses a complete fictional workbench while users create or open their own projects.
**Depends on:** WP-29. **Specs:** 02; 06 §2.

Scope:
- Keep VERA-DEMO-01 documents, logs and pinout only under `tests/fixtures/workbenches/`.
- Welcome provides normal create/open/recent project flows and sessions use explicit user input.
- Runtime IPC, compiled UI and package resources contain no example-opening or guided-prompt facility.

Done when:
- [ ] Fresh userData exposes only ordinary project entry and explicit session composition.
- [ ] Fixtures remain usable by verification and are excluded from the distributed application.

## WP-38 Accessibility and translation pass

**Goal:** VERA meets its accessibility rules and speaks Romanian and German properly.
**Depends on:** every UI package. **Specs:** 06 §6, §7.

Scope:
- A WCAG 2.1 AA review of every screen in both themes; the shortcuts of 06 §7.
- Human review of the `ro` and `de` catalogs.

Done when:
- [ ] The review findings are fixed or recorded.
- [ ] `check:i18n` passes and the reviewed catalogs are in place.

## Implementation notes (2026-11-01)

Checked against the working tree on `master` (33e72b8 plus uncommitted changes) by reading code and
tests; nothing was run. Paths are relative to `05_Software/`: `core/` = `src/libraries/core/src/`,
`shared/` = `src/libraries/shared/src/`, `renderer/` = `src/apps/desktop/src/renderer/`.

- WP-34: implemented as planned: summary above 80 % of the budget, one attempt per request, budget
  rechecked (`core/agent/compaction.ts:92,125-129`, `core/agent/runtime.ts:218-249`); the meter shows the
  compaction status (`renderer/components/session/usage-meter.tsx:10-13`). The tests
  (`core/agent/compaction.test.ts`) carry a "runtime execution deferred" header.
- WP-35: implemented as planned (`renderer/components/session/composer.tsx:61`, `shared/events.ts:83,88`,
  `core/agent/steering.test.ts:58-113`, `tests/e2e/chat-ui.spec.ts:71-89`); it replaced WP-13's `BUSY`
  for sends during a turn.
- WP-36: implemented with deviation: Markdown and JSON export as planned (`core/sessions/export.ts`,
  `core/sessions/export.test.ts:32,100`); search exists only as the `session.search` channel
  (`core/sessions/service.ts:205`) — the sidebar search box is never rendered because `App.tsx` passes
  no `searchChanged` (`renderer/components/session/session-list.tsx:315`), and the e2e asserts its
  absence and searches over IPC (`tests/e2e/session-search.spec.ts:60-66`).
- WP-37: implemented as planned in this file's version: no demo-opening IPC
  (`shared/workbench-entry.test.ts:5-10`), no demo or guided prompts on Welcome
  (`renderer/components/session/workspace.test.ts:356-394`), fixtures kept out of packages
  (`tests/packaging/packaging.test.ts:263-269`). The demo workbench, sample skills and onboarding first
  built for WP-37 (commit d579d77, 2026-10-13) were removed on 2026-10-26 (commit 1d016b0).
- WP-38: partly implemented: the shortcuts of 06 §7 and `check:i18n` exist
  (`shared/keyboard-shortcuts.ts:17-25`, `02_Tools/build/check-i18n.mjs`); missing: a review beyond source
  reading — the record (`.agentic/specs/REQ-UX-52f83eb7.md`) has no keyboard, assistive-technology or
  screenshot pass — and the human `ro`/`de` review, which the same record says is still required.

Not in the plan, implemented in this area:
- Session archive and manual ordering beside export (`shared/ipc.ts:269-315`,
  `tests/e2e/sidebar-order.spec.ts`); search inside the open transcript.
- Remappable, persisted keyboard shortcuts and a confirmation before Escape stops a turn
  (`tests/e2e/keyboard-shortcuts.spec.ts`, `renderer/components/session/workspace.tsx:103-115`).
- An Activity dialog with per-prompt token and context statistics (`tests/e2e/prompt-usage.spec.ts`).
