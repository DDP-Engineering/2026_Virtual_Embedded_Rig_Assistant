# Transcript scrolling, navigator and bookmarks

## Routing

Select for the conversation scroll rail, the user-message navigator lane (markers, groups, preview,
jump, follow suspension), user-message bookmarks and the next/previous bookmark commands. Start under
05_Software/src/apps/desktop/src/renderer/components/session with transcript-scroll.tsx,
transcript-navigation.ts and transcript-navigator.tsx. Focused tests: transcript-navigation.test.ts,
transcript-navigator.test.ts; tests/e2e/session-scroll.spec.ts, session-navigation.spec.ts,
bookmarks.spec.ts and bookmark-navigation.spec.ts. [Chat UI](chat-ui.md) owns transcript rows,
progressive mounting, detail levels and the composer; [sessions](sessions.md) owns the durable
bookmark event and the reply ownership (`replyToMessageIds`) the preview reads.

## Purpose and boundaries

Renderer presentation over the transcript's native scroll viewport: a segmented scroll rail, a lane
with one marker per displayed user message, and bookmark controls on messages and markers. Bookmark
membership comes from the shared snapshot (`bookmarkedMessageIds`); the renderer adds an optimistic
overlay and sends changes through IPC.

## Public interface

- The transcript fills the remaining bounded session area; its native scrolling is controlled by a segmented left rail with a proportional position marker. The rail appears only for overflowing content, supports pointer dragging/track clicks and Arrow/Page/Home/End keys, and has an en/ro/de accessible label. Wheel and touch use the same native viewport.
- User-message navigator: a separate lane beside the rail (role=toolbar, not inside role=scrollbar)
  holds one marker per displayed user message, pending ones included, placed proportionally over
  the whole content (12 + clamp(y/S)·(H-24)); markers whose 24 px targets would overlap merge
  deterministically into count groups with a non-modal fieldset selector. Hover/focus shows a
  plain-text title/reply preview (each at most 140 code points, empty/pending labels, Escape, stays while hovered);
  activation scrolls the message 16 px below the top or to the native limit, outlines it for 1.5 s,
  announces "Moved to message N" and keeps focus in the lane. One roving Tab stop with arrows,
  Home/End; aria-current marks the last message at or above scrollTop + min(80, V/4). A jump
  suspends auto-follow until the reader returns to the end away from the jump target. Anchors are
  re-measured once per frame after resize, DOM/disclosure changes (child lists and `hidden`/`open`, not
  text) or new messages; while a turn is active (`live`) at most every 250 ms, and on the next frame
  when it ends; and after font or image load events (Markdown renders images inert and no
  web fonts are declared); scrolling reuses them. Escape on a preview or selector is consumed so
  the workspace Stop shortcut yields; the wheel over the open selector scrolls only its list. The navigator is keyed by session; Transcript clears highlight
  and suspension on a session change. The left padding reserves rail plus lane.
- Transcript owns useBookmarks, a per-session optimistic overlay on snapshot bookmarkedMessageIds. Message and single-marker preview share BookmarkButton and the same projected value/in-flight lock.
- Message buttons reveal on hover and focus-within, render a filled icon when set and have localized Bookmark/Remove bookmark names in en/ro/de/fr.
- Single-marker preview is an accessible group with first prompt line as title, start of the first nonempty assistant reply bound to that user by shared replyToMessageIds below, and only the bookmark action. Tool rows do not break association. Pending rows have no reply; delivery and replay preserve earlier reply ownership, and admitted batches may share a reply. Marker ordinals stay in accessible names. Tab enters the card action and Escape restores its marker. Group selectors retain existing navigation.
- Bookmarked markers use primary fill and a longer visual mark; grouped markers project any-member membership without changing the grouping geometry. use-bookmark-navigation.ts dispatches nextBookmark/previousBookmark through existing shortcut guards and visible Chat ownership. Commands choose strictly next/previous user-message order from the current reading message (or the last successful rail/shortcut target at the same scroll offset), stop at boundaries and reuse scroll/highlight/announcement/lane focus. Unmounted history is mounted and retried only after its anchors are measured; non-overflow conversations focus the transcript and retain the announcement live region.
- REQ-UX-f62a82bc, REQ-UX-5722a63f and REQ-UX-17662553 cover bookmarked rail appearance and configurable directional navigation.

## Invariants

- Content and viewport resize refresh rail metrics; new messages retain an older reading position until the reader returns to the bottom. A return to the end whose scroll event is dispatched after the next commit still follows (the range settled at the last commit or scroll event decides). Composer and shell stay in place.
- Successful IPC retains the optimistic value until the event/snapshot confirms it; failure restores the preceding value and shows ErrorMessage. Obsolete session/unmount completions are ignored.
- App supplies selected-summary archive state (locked until known); workspace combines it with readOnly for transcript mutation guards. IPC remains authoritative.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Conversation scroll rail | transcript.tsx, transcript-scroll.tsx, styles.css | tests/e2e/session-scroll.spec.ts |
| User-message navigator (lane, groups, preview, jump, follow suspension) | transcript-navigation.ts (pure geometry), transcript-navigator.tsx, use-bookmark-navigation.ts, transcript.tsx (anchors, navigate, follow), styles.css | transcript-navigation.test.ts; transcript-navigator.test.ts; tests/e2e/session-navigation.spec.ts (VERA_NAV_SCREENSHOT) |
| User-message bookmarks (button, overlay, marker preview) | bookmark-button.tsx, use-bookmarks.ts, transcript.tsx, transcript-navigator.tsx, styles.css | transcript-navigator.test.ts; tests/e2e/bookmarks.spec.ts |
| Next/previous bookmark commands | use-bookmark-navigation.ts | transcript-navigator.test.ts; tests/e2e/bookmark-navigation.spec.ts |

## Key behaviors

- REQ-UX-1676bc64 — independent accessible segmented left conversation scroll rail.
- REQ-UX-b2f6ffa8, REQ-UX-2bbfd052, REQ-UX-a3be2b11, REQ-UX-7b49305a, REQ-UX-958b58c2 — navigator lane, jump/highlight, preview, groups, keyboard and ARIA.
- REQ-FUNC-1219a1e4 — current message at the reading line from memorized positions.
- REQ-REL-47308c01, REQ-REL-c8ac2ecc — follow suspension after a jump; frame-coalesced invalidation, session isolation and cleanup.
- REQ-TEST-ef975c5d, REQ-PLAT-bed960f3 — browser acceptance with screenshots; native Ubuntu run (manual).

## Files

Paths relative to05_Software; `renderer/` is src/apps/desktop/src/renderer/.

- renderer/components/session/transcript-scroll.tsx — local native viewport metrics and accessible pointer/keyboard rail.
- renderer/components/session/transcript-navigation.ts — pure preview text, lane mapping, grouping, current index, scroll target and content offset.
- renderer/components/session/transcript-navigator.tsx — marker lane, preview, group selector, status and measurement; transcript-navigation.test.ts and transcript-navigator.test.ts (jsdom) cover them.
- tests/e2e/session-navigation.spec.ts — browser acceptance: mapping, jumps, keyboard, preview, streaming follow suspension, disclosures/detail levels, session switches, 500 messages, resize and text scale.
- tests/e2e/session-scroll.spec.ts — bounded chat/settings/banner geometry, pointer/keyboard/wheel/touch scrolling and reading/follow behavior in browser and native Electron.
- renderer/components/session/{bookmark-button.tsx,use-bookmarks.ts,use-bookmark-navigation.ts} — bookmark button, optimistic overlay and next/previous bookmark commands.
- tests/e2e/{bookmarks,bookmark-navigation}.spec.ts — bookmark and bookmark navigation acceptance.
