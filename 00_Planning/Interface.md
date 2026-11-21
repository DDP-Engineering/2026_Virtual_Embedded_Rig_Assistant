# User interface

The desktop interface of VERA: layout, screens, the session view, appearance, languages and help,
accessibility and the UI rules every screen follows. The renderer is React in
`05_Software/src/apps/desktop/src/renderer/`; window chrome is in
`05_Software/src/apps/desktop/src/main/window-chrome.ts`. The help pages under
[`05_Software/help/en/`](../05_Software/help/en/index.md) describe the same UI for users.

## Layout

```
+----------------------------------------------------------------------------------+
| [sidebar] File Edit View                          [?] [panel]   native min max x | 40 px
+-------------+-----------------------------------------------+--------------------+
| Sidebar     | Main area                                     | Right panel (tabs) |
| VERA        | page title + page (overview, editor, settings,| collapsed by       |
| New / Open  | plugins, help)                                | default            |
| Plugins     | - or -                                        |                    |
| workbenches | session: Chat tab + document tabs             |                    |
|  - sessions |   transcript, rail, composer                  |                    |
| Settings    |                                               |                    |
+-------------+-----------------------------------------------+--------------------+
```

- **Window chrome.** No native application menu and a hidden title bar; a themed 40 px title-bar
  overlay holds the native window controls and follows the theme. The top bar has the sidebar
  toggle, the File, Edit and View buttons (native role menus popped up through the `window.menu`
  IPC; a packaged View menu offers only zoom reset, zoom in, zoom out and full screen), the Help
  button (?) and the right-panel toggle. F10 focuses File; Left/Right/Home/End move between the
  menus and Down opens one.
- **Left sidebar.** VERA brand; New Workbench, Open Workbench, Plugins; the list of recent
  workbenches (pinned first, expandable, the active workbench's sessions nested under it);
  Settings and the maker's logo at the bottom. A row menu offers Pin/Unpin, Move up/down
  (also Alt+Shift+Up/Down), Edit workbench, Open in Explorer, Close workbench and Remove from list;
  a missing folder is marked "Folder missing". In Settings the sidebar shows "Back to workbenches"
  and the settings page list instead. Collapsed, it is an icon rail with the same actions and a
  Workbenches button that expands it.
- **Session list** (under the active workbench): New session, search, archived view; each row
  shows title and last activity, with a menu for export (Markdown, JSON), rename, move up/down,
  archive or restore, and delete with confirmation. The session
  state (idle, running, awaiting approval, error) is screen-reader text only; there is no visible
  status badge.
- **Centre.** Either a page (with its title) or the session. The session area has tabs: Chat
  first, never closed, then one tab per opened document (the file viewer, with Rendered, Text and
  Hex modes where they apply). Document tabs reorder by drag and drop, switch with Ctrl+Tab, close
  with Ctrl+W or a middle click, and have a context menu; Esc returns to Chat. Each session keeps
  its own tabs and their places across restarts.
- **Right panel.** Tabs in this order: Instructions and skills, Files, Changes, Artifacts, Plan,
  Bookmarks, Runs, Terminal. A workbench chooses the visible tabs in Edit workbench > Interface >
  Right panel tabs (`interface.right_panel_tabs`); all are on by default except Bookmarks. Hiding
  every tab removes the panel and its toggle; the main area then offers a Right panel tabs link,
  and the terminal shortcut offers the same link instead of revealing a hidden tab. Instructions
  and skills, Changes, Artifacts, Plan and Bookmarks need an open session; Files, Runs and Terminal
  work with any open workbench. A tab without content shows a placeholder. Close is a control, not a
  tab.
- **Sizes.** Sidebar and right panel are resizable by pointer and keyboard (arrows, Home/End) from
  12 rem (sidebar, default 17) and 14 rem (panel, default 22) up to half the window, and
  collapsible. Widths and collapsed states persist in renderer storage (`vera.ui.layout`); invalid
  data gives the defaults. Theme and language live in the settings file.
- **Window.** Minimum 1024x640; first launch up to 1200x800; bounds persist in
  `window-state.json`, and an invalid or off-screen record gives centred defaults.
- **Responsive.** Below 1280 px width the right panel overlays the main area (at most 50 vw)
  instead of docking; its Close button or the toggle closes it.
- **Fixed viewport.** The document never scrolls (`html`, `body` and `#root` hide overflow); the
  sidebar, page content, transcript, viewer and panel tabs scroll internally.
- The renderer is one page at `vera://app/index.html` with in-memory navigation.
  `VITE_API=mock npm run dev:renderer` serves it alone against a mock API with fixture data.

## Screens

| Screen | Content |
|---|---|
| Welcome | There is no separate welcome screen. With no workbench open the main area shows the VERA mark; the sidebar's workbench list, New Workbench and Open Workbench are the entry points |
| New Workbench | Choose folder, then the editor sections below with Create a workbench at the top right; detects an existing workbench and offers Open this workbench; the draft survives navigation |
| Open Workbench | System folder picker for a folder that already has `.vera/workbench.yaml` |
| Workbench overview | The active workbench: model, permission mode, indexed and excluded sources, additional folders, storage, a paged sessions table, Edit; read-only and lock warnings |
| Workbench editor | In the main area, left section list and content: General, Interface, Instructions, Documents & RAG, Indexing, Agent and chat, Skills, Tools, Plugins, Data & privacy. Cancel and Save at the top right; Esc closes; leaving with unsaved edits asks first; a Plugins detour keeps the draft |
| Session workspace | Chat and document tabs in the centre, right panel beside it (see Session UI) |
| App settings | One page at a time from a vertical tab list, opening on Appearance and language: Providers, Web access, Appearance and language, Commands, Notifications, Keyboard shortcuts, Updates, Data & privacy, About. Commands and Data & privacy keep a draft with Cancel and Save; Providers and Web access save through their own forms; Appearance and language, Updates and Keyboard shortcuts apply each change at once. Notifications shows only a placeholder |
| Plugins | Management toolbar (install from folder or ZIP, packs, Check all dependencies, Refresh) and catalog settings; then filters on the left (search, state, ecosystem, activity, provenance, maturity, sort) and the plugin list on the right, 6, 12 or 24 per page. Browsing never enables a plugin; activation is in Edit workbench > Plugins (see [Plugins.md](Plugins.md)) |
| Help | The selected page on the left, the page list and the paged list of plugin help pages on the right |
| About | Settings > About: version, platform, architecture, portable or not, system locale, runtime versions, release notes, license and third-party components. The version appears only here |

## Session UI

- **Transcript.** User and assistant messages as GitHub-flavoured Markdown with highlighted code;
  raw HTML is skipped; http(s) links open in the system browser after a confirmation; citation
  chips open the cited document tab at its locator, and an invalid citation renders as an inert
  warning chip. Errors offer Retry. Replies and code blocks have Copy; a completed, labelled
  PowerShell or Bash block also has Run, which sends it to a clean user terminal. Delegated
  sessions are listed in the parent chat with links both ways. Ctrl+F opens a search that marks and
  counts matching messages.
- **Tool activity and detail levels.** A workbench setting (Edit workbench > Agent and chat),
  display only; the saved session and exports are always complete.

  | Level | Shows |
  |---|---|
  | Verbose | Every tool call with arguments and output, reasoning, and under each user message its send time and token statistics |
  | Normal (default) | Routine tool calls grouped into an expandable Operations line |
  | Minimal | The conversation only, with a working indicator while the agent works |

  Pending approvals, errors and download cards show at every level. A tool row has a short action,
  the affected file, page or command, and its status; expanding it shows the result, and
  Technical details holds the tool name, duration, raw arguments and raw result.
- **Approval card** (inline). Tool, path, unified diff with added and removed lines coloured, size;
  for programs the command line, working folder, risk badge (safe, device read, device write,
  irreversible, blocked) and files. Buttons Approve, Deny, Approve and switch to auto-edit, and
  Always allow with a command prefix where allowed. An irreversible action asks the user to type a
  word. With the card focused, `A` approves and `D` denies. A decided card shows the outcome and
  whether the user or the mode decided. Sending is paused while an approval waits.
- **Composer.** Auto-growing input (Enter sends, Shift+Enter adds a line; `@` completes workbench
  paths); model picker; reasoning picker when the model declares levels; permission picker
  (Read-only, Ask, Auto-edit, Bypass; Bypass warns first); the context indicator (percent of the
  context window, a spinner while history is summarized), which opens the Context window dialog
  with token usage and limits; Attach image (paste, drop or pick, up to
  eight per message, shown as thumbnails); file chips added with Attach as context in Files; Send,
  and Stop while a turn runs. Messages sent during a turn show Pending delivery. Esc during a turn
  asks to stop it.
- **Conversation rail.** One marker per user message on the left edge of the conversation, grouped
  when dense. Hover or focus shows a preview card with the first line of the message and the start
  of the reply, plus the bookmark action; a click or Enter jumps to the message.
- **Bookmarks.** A bookmark icon on each user message (on hover or focus) and in the rail card
  sets or clears a bookmark; it is saved with the session, kept in exports and never sent to the
  agent. Bookmarked markers are filled in the primary colour and longer. Next and Previous bookmark
  (Ctrl+Alt+N, Ctrl+Alt+P) jump and stop at the ends. The optional Bookmarks tab lists them with a
  filter, jump, select, remove and Clear all. Archived sessions and read-only workbenches only view.
- **Runs tab.** Plugin program runs and shell commands of the workbench, refreshed every second,
  with filters (session, current by default, plugin, state, date) and sorting. A row shows state,
  duration, exit code, session, start time, folder and live output. Stop ends a running run; Open log
  opens a finished run's log in the viewer, or for a running one a dialog with its last 1 MiB.
- **Terminal tab.** The user's interactive shells (xterm.js over node-pty), several tabs with New
  terminal and Close terminal, started in the workbench folder with the shell from Settings >
  Commands. Ctrl+Shift+T opens and focuses it. Each terminal has its own "Allow agent to read this
  terminal" switch, off at start; the agent never types into it. Terminals keep running when a
  session stops and close with the workbench or the app.
- The other tabs: Instructions and skills (`.vera/WORKBENCH.md` and skills), Files (tree, search,
  index status, Reindex, downloaded files), Changes (this session's file changes with diffs),
  Artifacts (open, reveal, export), Plan (the agent's task list).

## Appearance

- **Themes:** Light, Dark or System (default). The renderer sets `data-theme` and follows OS
  changes under System; main sets `nativeTheme.themeSource` and recolours the title-bar overlay.
- **Text sizes**, each with a sample line and applied on change, with Restore default text sizes:
  - Interface text size, Extra small to Largest: 75, 87.5, 100 (default, 14 px root), 112.5, 125
    or 150 %, applied to the root font size; layout sizes are in `rem`.
  - Conversation text size and Code and output text size: 10, 12, 14 (default), 16, 20 or 24 px,
    as `--chat-font-size` and `--code-font-size`, not scaled by the interface size.
- **Tokens:** CSS variables named after the shadcn/ui token set in `renderer/styles/themes.css`;
  a theme is a token block, never new components. Components are hand-written CSS in
  `renderer/styles.css`.

  | Token | Light | Dark | Use |
  |---|---|---|---|
  | `--primary` | `#076e68` | `#51d0c3` | green primary buttons, focus ring, selection, added diff lines, bookmarked markers |
  | `--background` | `#f5f5f3` | `#101316` | window and page background |
  | `--card` | `#ffffff` | `#181d20` | controls, dialogs, panels |
  | `--accent` | `#e0f1ef` | `#1b3b38` | hover and selected rows |
  | `--destructive` | `#b42318` | `#ffa398` | errors, removed lines, irreversible risk |
  | `--radius` | 0.8 rem | | corners |

  Density is fixed.

## Languages and help

- **Interface languages:** English, Română, Deutsch and Français, plus System (default), which uses
  the OS locale when it is one of the four and English otherwise. Dates and numbers follow the
  interface language.
- **i18n rule:** every user-visible string goes through i18next and the catalogs
  `renderer/locales/{en,ro,de,fr}.json`; `en` is the source and the fallback. Core errors arrive as
  a message key with parameters and are translated in the renderer. `npm run check:i18n`
  (`02_Tools/build/check-i18n.mjs`) fails on keys missing from `en`, unused keys, keys missing
  from or only present in a translation, and unregistered dynamic keys.
- **In-app help:** Markdown pages in `05_Software/help/<en|ro|de|fr>/` (the same 12 pages in each
  language), shipped as `<resources>/help/` and readable offline. The ? button opens Help at the
  index in the interface language; a page missing in that language shows the English one; links
  between help pages open inside Help. F1 opens the page of the current screen (Getting started,
  Workbenches, Chat and sessions, Providers, Keyboard shortcuts, Settings, Plugins). The agent's
  read-only `help` tool reads the same pages, and its citations open them in Help.
- **Plugin help:** each plugin can ship `help/<lang>.md`; Help lists the pages of installed plugins
  without issues, and the plugin page opens its page there, with English fallback.
- `npm run check:help` (`02_Tools/build/check-help.mjs`) requires the same app page set in all
  four languages, all four languages for official plugins, valid internal links and no empty page.
  `shortcuts.md` is generated from the shortcut registry
  (`02_Tools/build/generate-help-shortcuts.mjs`).

## Accessibility and keyboard

- Every control is reachable by keyboard with a visible focus ring (`--ring`): a skip-to-content
  button, arrow-key tab lists (right panel, settings pages, window menus), keyboard resizers, and
  dialogs that return focus to their opener. Focus moves to the page title on navigation; when a focused panel tab disappears, focus moves to the
  remaining tab or the panel toggle.
- Icon buttons carry accessible names; state is not conveyed by colour alone; text contrast meets
  WCAG 2.1 AA in both themes. The mock-mode e2e checks contrast and the absence of horizontal
  overflow at 1280, 1279 and 1024 px per theme and text size.
- `prefers-reduced-motion` turns animations and transitions off.
- **Shortcuts** come from the registry in
  [`keyboard-shortcuts.ts`](../05_Software/src/libraries/shared/src/keyboard-shortcuts.ts). Each
  command takes up to four combinations of Ctrl, optionally Alt and Shift, and a letter, digit,
  comma or slash. Settings > Keyboard shortcuts edits them and refuses conflicts and reserved
  native combinations (copy, paste, cut, undo, redo, select all, close, reload, quit, developer
  tools); Restore default works per command or for all. Fixed keys: F1, F10, Esc, Enter and
  Shift+Enter in the composer, `A`/`D` on an approval card, Alt+Shift+Up/Down on sidebar rows. The
  defaults are listed in [`05_Software/help/en/shortcuts.md`](../05_Software/help/en/shortcuts.md).

## UI rules

These apply to every screen:

- The primary action (Save, Create) is a green button (`button.primary`, `--primary`); other
  buttons are neutral.
- Actions on the left, outputs and lists on the right (for example the Plugins filters and list,
  Help, Documents & RAG).
- Tables and long lists have a rows-per-page selector and page navigation: the shared `Pager`
  (`renderer/components/pager.tsx`, 10, 20 or 50 rows, hidden for ten rows or fewer); the
  Plugins list uses 6, 12 or 24.
- Cancel and Save (or Create) sit at the top right of a page that keeps a draft; Save is disabled
  while nothing changed.
- No helper or explanatory text under controls; only state, errors and empty-state messages.
  Help lives in the help pages.
- No tinted card backgrounds in settings pages, the workbench editor or the Workbench overview:
  plain columns of controls. Editors use a left section list with the content beside it.
