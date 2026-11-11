# CHAT-NAV-01 User-message markers in the conversation scroll rail

PURPOSE: a compact map of the user's messages beside the conversation, so a question and its answer can
be reached again in one step.
SPEC: Gitea issue #89 holds the complete specification (behaviour, geometry, grouping, accessibility,
auto-follow, acceptance matrix AC01–AC20). This page records only scope, placement and delivery so the
two never diverge; change the issue, not a copy here.
STATE: implemented 2026-11-11 on branch `feature/89-chat-nav-markers` from `origin/master` 22a0d20
(AEGIS TASK-d0a44d9c, both reviews approved); one commit, pull request into `master`. AC01–AC20 are
proven by unit, component and browser tests on Windows; the native Ubuntu run (REQ-PLAT-bed960f3) is
still open.

## Scope

- One marker per displayed user message (pending ones included) in a lane beside the existing rail;
  proportional positions, deterministic grouping of markers that would overlap, a group selector, a
  plain-text preview on hover and focus, current-position marking and a short highlight of the target.
- Keyboard: one Tab stop with roving focus, arrows, Home/End, Enter/Space; Escape closes preview and
  selector. The scrollbar keeps its role and keys; markers are not inside it.
- A jump suspends auto-follow until the user explicitly returns to the end; a streaming reply never
  pulls the reader back.
- Geometry follows streaming, layout, detail level, text size, session switches; scrolling reuses
  measured positions.
- Out of scope: cross-session navigation, bookmarks, new search, AI summaries, tool or reply markers,
  virtualization, backend/IPC/export or schema changes.

## Delivery

| Step | Result |
|---|---|
| 1 | Pure helpers for preview text, marker mapping, grouping, current message and scroll target, with unit tests |
| 2 | Transcript anchor registry, navigator lane, jump with highlight and explicit auto-follow suspension |
| 3 | Group selector, roving focus, preview, ARIA, en/ro/de texts |
| 4 | Invalidation on resize, fonts, detail level, disclosures, streaming and session switches |
| 5 | Acceptance AC01–AC20 per `02_Tools/verification-policy.md`, both reviews, AEGIS journal |

Files: `05_Software/src/apps/desktop/src/renderer/components/session/` (`transcript.tsx`,
`transcript-scroll.tsx`, a navigator component and a pure helper), `styles.css`, `locales/{en,ro,de}.json`,
the renderer mock for a slow stream, `tests/e2e/session-scroll.spec.ts` or a sibling spec.
