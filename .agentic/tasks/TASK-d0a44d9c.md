# TASK-d0a44d9c - CHAT-NAV-01 user-message markers in the conversation scroll rail (#89)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-b2f6ffa8, REQ-UX-2bbfd052, REQ-UX-a3be2b11, REQ-UX-7b49305a, REQ-UX-958b58c2, REQ-FUNC-1219a1e4, REQ-REL-47308c01, REQ-REL-c8ac2ecc, REQ-TEST-ef975c5d, REQ-PLAT-bed960f3
parent:
branch: feature/89-chat-nav-markers
base: 22a0d201af90433a18eb1a604de2c21d695f2d56
opened: 2026-11-11

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

Problem: STATED (#89 CHAT-NAV-01): in long conversations the user cannot get back to an earlier question; the left rail only shows the scroll position with decorative dots.
Desired outcome: STATED: a lane of markers, one per displayed user message (grouped when close), with plain-text preview, jump with short highlight, current-position marking, keyboard access and auto-follow suspended after a jump, following layout, streaming and session changes.
Actors: STATED: the user reading a session conversation in the desktop renderer (pointer, keyboard, screen reader).
Primary scenario: STATED: the user hovers or focuses markers, reads previews, activates one and lands on that question near the top while a reply may still stream.
Examples: STATED: preview "Message 7 — Și acum, poți să îmi listezi fișierele…"; 500 user messages remain reachable through groups.
Counterexamples: STATED: no markers without overflow or without user messages; markers never cover text; a jump near the end must not re-enable auto-follow; OBSERVED: `Transcript` is not keyed by session inside workspace.tsx:199, but App.tsx:659 keys `SessionWorkspace` by workbench and session, so a session switch remounts it; the navigator key and the in-place reset in Transcript are defensive.
In scope: STATED: renderer only — transcript.tsx, transcript-scroll.tsx (rail kept), a navigator component, a pure geometry helper, styles, en/ro/de locales, mock and e2e tests.
Out of scope: STATED: cross-session navigation, bookmarks, new search, editing, AI summaries, tool/reply markers, virtualization, backend/IPC/export/database, new dependencies, schema versions.
Constraints: STATED: branch feature/89-chat-nav-markers from origin/master 22a0d201af90433a18eb1a604de2c21d695f2d56 (user choice 2026-11-11); one validated commit, PR to master. Plan integrated in 00_Planning/plan/chat-navigation.md (issue #89 is the spec). Verification per 02_Tools/verification-policy.md; native Ubuntu not available here.
Success signals: STATED: AC01–AC20 of #89, focused unit/component/browser tests, lint/typecheck/i18n, both reviews.
Evidence: OBSERVED: transcript-scroll.tsx (rail, ResizeObserver, pointer capture, keys), transcript.tsx (auto-follow ref with 80 px threshold, articles keyed by item.id), styles.css rail and padding, session-scroll.spec.ts mock flow, mocks/sessions.ts single immediate delta.
Assumptions: INFERRED: a slow-stream trigger in the renderer mock is acceptable test scaffolding; jsdom component tests stub layout.
Unknowns: UNKNOWN: native Ubuntu behaviour (no host); screen-reader announcement wording beyond the spec.
Decision-blocking questions: None (branch decided by the user).
Proposed behaviors: STATED by #89; INFERRED details: marker shape (short horizontal bar, outlined when not current), lane at the left of the rail.
Path and reason:

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | STATED: new navigator |
| no new interface or data format | no | INFERRED: new component props and DOM semantics |
| no new dependency | yes | STATED: none needed |
| an existing requirement already covers the behavior | no | OBSERVED: REQ-UX-1676bc64 covers the rail only |
| no security or data-handling change | yes | STATED: preview stays local plain text |

## Requirement coverage

| Requirement | Accepted behavior | Design | Proof |
| --- | --- | --- | --- |
| REQ-UX-b2f6ffa8 | STATED: markers in a separate lane, proportional, hidden without overflow | geometry helper + navigator lane + padding | unit + browser |
| REQ-UX-2bbfd052 | STATED: jump near top, highlight 1.5 s, announce, focus stays | navigator → Transcript.navigate | browser + component |
| REQ-UX-a3be2b11 | STATED: preview ≤140 chars, empty/pending labels, Escape | previewText + tooltip | unit + component + browser |
| REQ-UX-7b49305a | STATED: deterministic grouping, selector | groupMarkers + selector | unit + component + browser |
| REQ-UX-958b58c2 | STATED: roving focus, keys, aria-current, en/ro/de | navigator keyboard model | component + browser + i18n |
| REQ-FUNC-1219a1e4 | STATED: reading-line current marker | currentIndex on memorized positions | unit + browser |
| REQ-REL-47308c01 | STATED: auto-follow suspended until explicit return | Transcript suspension ref | browser (slow mock stream) |
| REQ-REL-c8ac2ecc | STATED: invalidation and session isolation, cleanup | rAF-coalesced measure, keyed navigator | component + browser |
| REQ-TEST-ef975c5d | STATED: browser acceptance + screenshots | session-navigation.spec.ts | Windows run |
| REQ-PLAT-bed960f3 | STATED: Windows and native Ubuntu | manual | Ubuntu pending |

## Design

Diagrams: [TASK-d0a44d9c diagrams](diagram_TASK-d0a44d9c.md)

### Approach

Renderer-only. A pure module `transcript-navigation.ts` holds the math (REQ-UX-b2f6ffa8, REQ-UX-7b49305a, REQ-FUNC-1219a1e4, REQ-UX-a3be2b11): `previewText`, `markerCenter`, `groupMarkers`, `currentIndex`, `scrollTarget`. A component `TranscriptNavigator` (`transcript-navigator.tsx`) renders a lane beside the existing rail with buttons, preview, group selector and status; it measures anchors through a callback from `Transcript`. `Transcript` keeps a registry `Map<item.id, HTMLElement>` of user articles, renders the navigator keyed by `sessionId`, owns navigation (scroll, highlight, auto-follow suspension; REQ-UX-2bbfd052, REQ-REL-47308c01). The rail (`transcript-scroll.tsx`) stays as is (REQ-UX-1676bc64). Rejected: putting markers inside role=scrollbar (ARIA), offsetTop (wrong offset parent).

### Interfaces and data

- Anchor y = rect(el).top - rect(viewport).top - viewport.clientTop + viewport.scrollTop. Lane centre = 12 + clamp(y / max(S,1), 0, 1) × max(0, H - 24); groups merge adjacent targets closer than 24 px (centre = mean of members, clamped to [12, H-12]) until none overlap; a lane under 24 px is one group. Scroll target clamp(y - 16, 0, max(0, S - V)). Current = last anchor with y ≤ scrollTop + min(80, V/4), else first.
- Messages for the navigator: displayed user rows from `transcriptRows` (all detail levels keep user messages) as `{id, ordinal, text, pending}`.
- Measurement: ResizeObserver on viewport and content, MutationObserver on content (child list, text, `hidden`, `open`), `document.fonts` loadingdone, captured `load` events and window resize, plus a changed message list, schedule one rAF measure; scroll only updates the current index from memorized ys. Popups are sized by CSS from the measured frame width (`--navigator-frame`), then one read (offsetHeight) and one write (top).
- Navigation: `Transcript.navigate(id)` sets `following=false`, `suspended=true`, remembers the target scrollTop, scrolls, sets `highlight` (1.5 s timer, replaced on next jump). `onScroll` keeps the suspension until the user moves to within 80 px of the end away from the jump target; otherwise behaviour unchanged.
- Keyboard: one focusable button at a time (roving tabindex), ArrowUp/Down, Home/End move focus only; Enter/Space activate; Escape closes preview/selector and is consumed (preventDefault) so workspace Escape shortcuts yield. Selector: non-modal fieldset whose legend names the group, arrows/Home/End between entries; Escape/outside press/focus leaving close it; presses on its legend or gaps keep focus; the lane forwards wheel to the conversation except over the open selector.
- CSS: transcript left padding reserves rail (1.25 rem) + lane (1.5 rem); markers 24×24 px targets with an inner bar; current, focus and highlight are distinct styles; no animations.
- Locales `chat.navigator.*` in en/ro/de. Mock: a user message starting `stream slowly` streams a long reply in timed deltas.

### Files and test seams

New: `transcript-navigation.ts` (+ `.test.ts`), `transcript-navigator.tsx` (+ jsdom `.test.ts`), `tests/e2e/session-navigation.spec.ts`. Changed: `transcript.tsx`, `styles.css`, `locales/{en,ro,de}.json`, `mocks/sessions.ts`. Unit tests for helpers; component tests for keyboard, preview, selector, session reset and cleanup; browser spec for layout, jumps, streaming, grouping, resize/scale and screenshots.

### Risks and open decisions

jsdom has no layout, so geometry is proven in the browser spec. Native Ubuntu is not available here (REQ-PLAT-bed960f3 manual). 500-message browser scenario must stay reasonably fast; it checks behaviour, not timings.

### Requirement map

Each requirement ID is cited above; REQ-TEST-ef975c5d → browser spec; REQ-PLAT-bed960f3 → manual.

## Log

- 2026-11-11 frame: journal opened
- 2026-11-11 frame: completed; next specify - scope recorded (autopilot)
- 2026-11-11 specify: completed; next design
- 2026-11-11 design: completed; next build
- 2026-11-11 build: red: npx vitest run src/apps/desktop/src/renderer/components/session/transcript-navigation.test.ts exit 1 - 6/6 assertions fail against a signature-only stub (preview, lane mapping, scroll target, current index, grouping missing) (REQ-UX-b2f6ffa8 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-FUNC-1219a1e4 REQ-UX-2bbfd052)
- 2026-11-11 build: green: npx vitest run src/apps/desktop/src/renderer/components/session/transcript-navigation.test.ts exit 0 - 6 tests (two test expectations corrected before implementation: inclusive reading-line boundary at 819, stack-merge chain result per #89 section 5) (REQ-UX-b2f6ffa8 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-FUNC-1219a1e4 REQ-UX-2bbfd052)
- 2026-11-11 build: red: npx vitest run src/apps/desktop/src/renderer/components/session/transcript-navigator.test.ts exit 1 - 6/7 fail against a render-nothing stub (toolbar, roving focus, preview, group selector, 500-message reach, frame-coalesced measure and cleanup, Transcript jump/highlight/suspension/session reset missing); the hidden case passes trivially (REQ-UX-b2f6ffa8 REQ-UX-2bbfd052 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-UX-958b58c2 REQ-FUNC-1219a1e4 REQ-REL-47308c01 REQ-REL-c8ac2ecc)
- 2026-11-11 build: green: npx vitest run src/apps/desktop/src/renderer/components/session/transcript-navigator.test.ts transcript-navigation.test.ts transcript-detail.test.ts exit 0 - 22 tests; npm run typecheck exit 0; npm run check:i18n exit 0; biome errors 0, styles.css warnings unchanged at the 38 baseline (REQ-UX-b2f6ffa8 REQ-UX-2bbfd052 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-UX-958b58c2 REQ-FUNC-1219a1e4 REQ-REL-47308c01 REQ-REL-c8ac2ecc)
- 2026-11-11 build: red: tests/e2e/session-scroll.spec.ts 'fixed viewport' 0/5 on this branch vs 4/6 on base files (stash check): the rail End scroll event is dispatched after the next send's commit, so onScroll judged the old position against new content; pre-existing race that the extra render work made deterministic. Regression test 'keeps following after a return to the end whose scroll event arrives after the next commit' red without the fix (expected 3600 to be 4000) (REQ-REL-47308c01)
- 2026-11-11 build: green: Transcript follows when the position was at the end of the range settled at the last commit or scroll event, unless a marker jump suspended it; npx vitest run transcript-navigator.test.ts exit 0 (8 tests); npx playwright test tests/e2e/session-scroll.spec.ts -g 'fixed viewport' 5/5 passed (REQ-REL-47308c01)
- 2026-11-11 build: DEVIATION build: the browser acceptance spec tests/e2e/session-navigation.spec.ts was written after the component implementation, so it has no red run of its own - its behaviours were first proven red at unit/component level; first browser runs failed only on test assumptions (grouped adjacent messages, a streaming-moved scroll limit), recorded here
- 2026-11-11 build: observation: native Electron specs chat-detail.spec.ts (2 tests, create-workbench click timeout) and session-scroll.spec.ts native (page.evaluate session.model.set) fail identically on a base build with this change stashed - pre-existing environment failures on this Windows host, not caused by this task
- 2026-11-11 build: evolution reviewed: 11 files (3 added, 8 modified, 0 removed) - all named in the Design (helper, navigator, Transcript, styles, en/ro/de, renderer mock, browser spec); transcript-scroll.tsx unchanged as designed; one addition beyond the Design text: Transcript settledMax follow check for scroll events dispatched after the next commit (REQ-REL-47308c01), see the red/green above
- 2026-11-11 build: check --task: errors=0, warnings=50, notes=24 - none on TASK-d0a44d9c or its ten requirements (all on older requirements: stale-paths, ticket-ref, no-linked-tests, manual notes); REQ-PLAT-bed960f3 native Ubuntu run pending, no host available here
- 2026-11-11 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-11 validate: diff self-review fixed Escape closing an open selector from the toolbar, pressing reset on pointer leave, and an invisible literal no-break space (now NO_BREAK_SPACE escape); browser spec extended for the preview kept under the pointer, preview inside 1024x640, 1280x900 at 150% text and >=3:1 marker/focus-ring contrast in light and dark themes - npx playwright test tests/e2e/session-navigation.spec.ts 4/4 passed
- 2026-11-11 validate: manual REQ-PLAT-bed960f3: not performed - no native Ubuntu host is available in this session (Windows 11 only); the native Electron run on Windows is also blocked by the pre-existing create-workbench/session.model.set failures recorded above; browser acceptance ran on Windows Chromium only
- 2026-11-11 validate: review round 1: spec=changes_required, quality=changes_required. Blocking: (1) lane wheel forwarding also fires over the scrollable group selector (both); (2) document Escape for a hover preview does not preventDefault, so workspace Stop confirmation also opens during a running turn (quality); (3) AC18 reduced motion and AC15 image/font invalidation lack proof (spec). Non-blocking taken: click in selector padding or window blur closes it; measurement on id change not frame-coalesced and popup positioning writes then reads layout; stale focusWithin after the lane hides; unbounded previewText input; focus ring clipped at lane ends; group tooltip repeats the accessible name; weak timer and unmount-listener assertions; AC08 precondition, AC02 stability, resize focus, Ctrl+wheel, no text selection and browser AC06 label unasserted; REQ-UX-b2f6ffa8 verification wording; Frame/Design wording (App keys SessionWorkspace by session; selector is a fieldset).
- 2026-11-11 validate: returned to build - review round 1 findings: selector wheel forwarding, Escape preventDefault, reduced-motion and image/font proof, plus listed non-blocking fixes
- 2026-11-11 build: red (round 1 fixes): npx vitest run transcript-navigator.test.ts exit 1 - 4 failing: legend click closes the selector; wheel over a selector entry scrolls the conversation (240 vs 120); document Escape with a hover preview not defaultPrevented; id-change measurement runs outside the frame (reads 8 vs 4) (REQ-UX-7b49305a REQ-UX-a3be2b11 REQ-REL-c8ac2ecc)
- 2026-11-11 build: green (round 1 fixes): lane skips wheel forwarding over the open selector; document Escape for a preview attached in a layout effect and consumed with preventDefault; message-list changes measured on the next frame; popup sized by CSS from --navigator-frame (one read, one write); legend/gap presses keep selector focus; focusWithin reset when the lane hides; previewText bounded to a 4096-unit head; group tooltip no longer describes its own button; focus ring inset at the lane ends; anchors map via useState. npx vitest run components/session exit 0 (12 files, 107 tests); npx playwright test session-navigation.spec.ts + session-scroll 'fixed viewport' 3x 5/5 passed; typecheck, check:i18n, biome errors 0 (REQ-UX-7b49305a REQ-UX-a3be2b11 REQ-UX-958b58c2 REQ-REL-c8ac2ecc REQ-UX-2bbfd052)
- 2026-11-11 build: inspection AC18: browser test emulates prefers-reduced-motion: reduce, activates Message 7 and in the same task reads offset 16 +/- 1.5, scroll-behavior auto, highlight transition 0s and animation none; AC15: Markdown renders images inert (markdown.tsx) and the renderer declares no web fonts, so image/font loads cannot move anchors in the transcript today - the load and fonts loadingdone invalidation wiring is proven by the component test; screenshots sparse, dense, group, keyboard and narrow (VERA_NAV_SCREENSHOT) were generated and inspected: lane beside rail, outlined/filled markers, count groups, scrollable selector inside the frame, focus ring with preview, target outline
- 2026-11-11 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-11 validate: review round 2: spec=approved (AC01-AC20 proven; REQ-PLAT-bed960f3 manual pending), quality=changes_required. Blocking: the inset focus ring (round-1 change) is invisible on the current group marker, whose fill var(--primary) equals var(--ring) in both themes; the contrast e2e compared the ring only with the page surface. Notes taken: gate preview Escape on a visible preview and skip it inside an open dialog; reset the measured id key on effect cleanup (StrictMode remount); unit test for the 4096 head cap.
- 2026-11-11 validate: returned to build - review round 2: focus ring invisible on the filled current group marker
- 2026-11-11 build: red (round 2): npx playwright test session-navigation.spec.ts -g '500 messages' exit 1 - keyboard ring on the filled current group has contrast 1:1 against the marker fill (expected >= 3) (REQ-UX-958b58c2)
- 2026-11-11 build: green (round 2): filled current group gets outline-color var(--primary-foreground) when focus-visible; preview Escape listener gated on a shown preview and skipped inside an open dialog; measured id key reset on effect cleanup; unit test for the 4096 head cap. npx vitest run components/session exit 0 (12 files, 107 tests); playwright session-navigation + session-scroll 'fixed viewport' 3x 5/5 passed; typecheck exit 0; styles.css warnings at the 38 baseline (REQ-UX-958b58c2 REQ-UX-a3be2b11 REQ-REL-c8ac2ecc)
- 2026-11-11 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-11 validate: review round 3: spec=approved, quality=approved. Accepted non-blocking notes: a cut landing on a space keeps the space before the ellipsis (cosmetic); the 4096-unit head cap can under-fill or label as empty a message whose first 4096 units are almost all white space (pathological, bounded cost wins); filled-group ring contrast asserted in the starting theme only (CSS rule is theme-independent); REQ-PLAT-bed960f3 native Ubuntu run still pending.
- 2026-11-11 validate: final: python .agentic/aegis.py check --task TASK-d0a44d9c --strict --run exit 0 (strict: ok); ran lint, typecheck, i18n; errors=0, warnings=50, notes=24 - 48 warnings belong to older requirements and journals; 2 uncovered-source warnings name transcript-navigation.test.ts and transcript-navigator.test.ts, which are covered through linked_tests of the navigator requirements (the check counts test files under src as source). Focused proof after the last code edit: vitest components/session 107 tests exit 0; playwright session-navigation 4/4 and session-scroll 'fixed viewport' in three runs. Pre-existing, out of scope: native Electron chat-detail and session-scroll native specs fail identically on base on this host. Open limitation: REQ-PLAT-bed960f3 native Ubuntu run not performed.
- 2026-11-11 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-11 | decision=Implement #89 on branch feature/89-chat-nav-markers from origin/master, one validated commit, then a pull request into master | reason=User 2026-11-11 chose a separate branch from origin/master; issue #89 is the specification | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-d0a44d9c.md
changed: 10 created, 0 revised
evidence: aegis check --task TASK-d0a44d9c --strict --run exit 0
issues: REQ-PLAT-bed960f3 native Ubuntu run not performed (no host); native Electron chat-detail/session-scroll specs fail identically on base on this Windows host
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-11)

- stage: validate; type: feature; path: full; branch: feature/89-chat-nav-markers
- requirements:
  - REQ-UX-b2f6ffa8 - Show user-message markers beside the conversation rail
  - REQ-UX-2bbfd052 - Jump to a user message from its marker
  - REQ-UX-a3be2b11 - Preview a user message from its marker
  - REQ-UX-7b49305a - Group overlapping user-message markers with a selector
  - REQ-UX-958b58c2 - Operate the message navigator from the keyboard
  - REQ-FUNC-1219a1e4 - Mark the user message at the reading position
  - REQ-REL-47308c01 - Suspend auto-follow after a message jump
  - REQ-REL-c8ac2ecc - Keep navigator geometry and state current
  - REQ-TEST-ef975c5d - Browser acceptance for message navigation
  - REQ-PLAT-bed960f3 - Message navigation on native Windows and Ubuntu
- deviations: 1 recorded
  - build: the browser acceptance spec tests/e2e/session-navigation.spec.ts was written after the component implementation, so it has no red run of its own - its behaviours were first proven red at unit/component level; first browser runs failed only on test assumptions (grouped adjacent messages, a streaming-moved scroll limit), recorded here
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 22a0d20: 28 file(s) changed, 2479 line(s) added
- checks: errors=0 warnings=50 notes=24
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
