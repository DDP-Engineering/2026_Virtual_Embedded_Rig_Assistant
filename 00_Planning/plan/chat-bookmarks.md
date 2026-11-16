# BKM — Bookmarks in the conversation rail

PURPOSE: let the user mark the messages that matter in a long session and return to them in one step from the
conversation's left rail.
STATE: BKM-01 implemented 2026-11-16 (TASK-d20f7557), coordinator commit pending.
BKM-02 and BKM-03 remain planned. Product code follows AEGIS, one work package per task.

## Current state (2026-11-16)

CHAT-NAV-01 draws one marker per user message on the rail beside the conversation
(`renderer/components/session/transcript-navigator.tsx`). Hover or focus shows a tooltip with the start of the
message only (`previewText`, at most 140 characters); a click or the keyboard jumps to it. Bookmark persistence is implemented by BKM-01; controls, rail markers and navigation remain planned in
BKM-02/03. No action icons are exposed yet.

## Decisions (2026-11-15)

- **A bookmark belongs to one user message of one session.** It is set or cleared with a small bookmark icon on
  the message (shown on hover and keyboard focus, filled when set) and with the same icon in the rail's preview
  card.
- **The preview card grows into a card like Codex's:** the first line of the user message as its title, the start
  of the agent's reply below it, and the bookmark icon. The card shows only the user's text, never "Message N"
  (the number stays in the marker's accessible name). The card stays a preview: no other actions.
- **Bookmarked markers stand out on the rail:** filled, in the primary color and slightly longer than other
  markers, at every density the rail already handles (grouped markers show a bookmark when any member has one).
- **Next and previous bookmark** are two commands in the shortcut registry (`shared/src/keyboard-shortcuts.ts`),
  editable in Settings > Keyboard shortcuts like the others.
- **Durable and per session:** a `message.bookmarked {messageId, bookmarked}` session event in the workbench
  database, folded by the session state reducer (`shared/src/session-state.ts`); it survives restart and goes with
  a session export. The event format stays at version 1 (pre-release policy). The agent never sees bookmarks.
- **No helper text:** the icon has an accessible name (Bookmark / Remove bookmark) in en, ro, de and fr, nothing
  more on screen.

## Work packages

| WP | Title | Result |
|---|---|---|
| BKM-01 | Bookmark state | `message.bookmarked` event schema; `session.bookmark {sessionId, messageId, bookmarked}` IPC that refuses a message that is not a user message of that session; recorded and published through the session hub; folded into the snapshot as the set of bookmarked message ids; kept by session export; usable on an archived or read-only workbench only for reading |
| BKM-02 | Icon on messages and in the preview card | the bookmark icon on user messages and in the rail's card; the card shows the title line and the start of the reply; toggling is optimistic and rolls back with an error message when the IPC fails |
| BKM-03 | Rail markers and navigation | distinct bookmarked markers, including in grouped markers; next/previous bookmark commands with default keys and Settings > Keyboard shortcuts entries; the jump uses CHAT-NAV-01's scroll and focus behavior |

Order: BKM-01, then BKM-02 and BKM-03 (independent of each other). Help pages (Chat and sessions, Keyboard
shortcuts) and the four interface languages are updated inside each work package.

## Verification

- Unit: the reducer sets and clears a bookmark and ignores one for an unknown message; the IPC refuses an
  assistant message, a message of another session and a read-only workbench; export contains the bookmarks.
- Component: hover and keyboard focus show the icon; toggling from the message and from the card agree; a failed
  toggle rolls back; grouped markers show a bookmark.
- E2E (browser mock and native): bookmark three messages in a long session, restart, find them marked, and move
  between them with the next/previous keys in every interface language.

## Out of scope

- A bookmarks list in the right panel, bookmarks on agent replies, and bookmarks shared across sessions; each can
  follow as its own work package.
