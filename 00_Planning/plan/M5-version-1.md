# M5 — Version 1.0

PURPOSE: the finish that makes VERA usable every day — long sessions, interaction during a turn,
export, fictional verification fixtures, accessibility and reviewed translations.
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
