# UI reference

Layout A, the three-pane workspace of `../architecture/06-ui.md` §1, chosen on 2026-10-09 for being
simple and clear in its menus. These files are historical visual references made before the
implementation, not a specification: as of 2026-11-01 the implemented UI differs in the points listed
below, and `06-ui.md` together with the code wins.

Each screen exists as a PNG and as static HTML, in a light and a dark theme (`-light`, `-dark`).
Open the HTML in a browser to inspect sizes and colours.

| Screen | Files | Content |
|---|---|---|
| Session workspace, 1440×900 | `layout-a-workspace-*` | session list with status badges, a turn with tool rows and citation chips, an edit waiting for approval with its diff and `A`/`D` keys, the composer disabled during the wait, the Docs tab with index status |
| Welcome, 1440×900 | `layout-a-welcome-*` | create a workbench (name, folder), open an existing one, the demo link, recent workbenches including a missing folder |
| Settings — Providers, 1440×900 | `layout-a-settings-providers-*` | default model, ChatGPT subscription, OpenAI API key (masked), custom endpoints, a four-step connection test with a failed tool-calling step |
| Settings — Appearance, Language, Updates, 1440×900 | `layout-a-settings-appearance-*` | theme cards, five text sizes, interface language, a downloaded update with mode, channel and release notes |
| Narrow window, 1024×640 | `layout-a-narrow-*` | the right panel opened over the conversation (Changes tab), closed with Esc or the Panel button |

## How the implementation differs (2026-11-01)

| Area | Mockup | Implemented |
|---|---|---|
| Window chrome | breadcrumb header, global search (Ctrl+K) | hidden title bar with File/Edit/View/Help popup menus and panel toggles; no global search |
| Sidebar | workbench switcher, filtered session list with visible status badges | New / Open Workbench, Plugins, expandable workbench list with nested sessions, Settings at the bottom; session status is screen-reader text only, rows show last activity |
| Welcome | dedicated screen with create, open, demo link, recent list with Locate… | Workbench overview of the active workbench; New Workbench form with the workbench editor sections; recent workbenches live in the sidebar; no demo link, missing folders can only be removed |
| Session | header with provider, mode and Export; usage in a footer | export in the session row menu; composer adds reasoning picker, context gauge and Agent activity button; usage in a Context window dialog |
| Right panel | Context, Docs, Changes, Artifacts, Plan | adds a Source tab (the document viewer); collapsed by default; the Docs tab also lists downloaded files |
| Settings | one scrolling page, six sections, "Back to {workbench}" | one section at a time from eleven (adds Web access, Notifications, Keyboard shortcuts, Storage, Configuration; four are placeholders); "Back to workbenches" |
| Providers | default-model selector; endpoint list with tool badges; Test on ChatGPT | no default-model control; groups "Subscriptions" and "API / local connections", presets OpenAI, LM Studio (model discovery), Ollama, Other; no ChatGPT Test button |
| Appearance | five text sizes, Ctrl+/Ctrl− | six interface sizes (75–150 %) plus separate chat and code font sizes; no zoom shortcut |
| Narrow window | Esc or the Panel button closes the overlay | the panel's Close button or the toggle closes it; Esc closes only an open source |

Design canvas with the source of these mockups and the two rejected alternatives (B document-first,
C workbench cockpit): https://claude.ai/artifact/Nb6LL9Lknjho2KEzcLkXsC (private to its owner).
