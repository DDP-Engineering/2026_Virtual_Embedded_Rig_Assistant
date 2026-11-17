# HELP — Help pages, French, and the agent's help tool

PURPOSE: user help for VERA and for every plugin, in English, Romanian, German and French, opened from
a Help button in the top bar, available offline, and readable by the agent.
STATE: implemented (HELP-01…HELP-08). Product code follows AEGIS, one work package per task; writing and
translating the pages is documentation inside those tasks.

## Decisions (agreed with the user, 2026-11-15)

- **Four languages everywhere: en, ro, de, fr.** French is added to the interface as well
  (`fr.json`, the `language` setting, `check:i18n`), not only to help.
- **App help lives in `05_Software/help/<en|ro|de|fr>/*.md`** and ships in the installer as
  `<resources>/help/`, so it works offline like the rest of the app. English is the source; each
  language has the same page set.
- **The top-bar About button (ⓘ, `data-action="show-about"` in `shell.tsx`) becomes a Help button (?)**,
  in the same place next to the right-panel toggle. About stays as the Settings → About page.
- **Help is pages, not hints.** No helper text is added to the interface (VERA UI rule); screens link
  to their help page at most.
- **Plugin help in all four languages:** each plugin has `help/<en|ro|de|fr>.md` in its own folder, so
  it travels in the plugin zip. `README.md` stays the technical reference. The catalog description in
  `plugin.yaml` gets per-language variants.
- **The agent uses help** through a read-only `help` tool: it lists and reads the app pages and the
  pages of enabled plugins, and its citations open the page in the Help view.
- **Fallback:** a page missing in the selected language shows the English page. The check script
  (HELP-07) requires all four for the app and for official plugins; community plugins may ship English
  only.

## Pages of the app help

One file per topic, the same file names in every language:

| File | Topic |
|---|---|
| `index.md` | What VERA is, how help is organised |
| `getting-started.md` | First start, a provider, a first workbench, a first question |
| `workbenches.md` | Create, open, recent and pinned workbenches, read-only workbenches, `.vera/` |
| `chat-and-sessions.md` | Sessions, steering during a turn, archive, export, detail levels, reasoning |
| `permissions.md` | Read-only, Ask, Auto-edit, Bypass; approvals, changes, risk levels of programs |
| `documents-and-search.md` | Documents, indexing, search, citations, the viewer, downloads |
| `providers.md` | OpenAI, ChatGPT subscription, LM Studio, Ollama and other endpoints; models |
| `plugins.md` | Catalog, install, review and trust, dependencies, parameters, packs, the offline kit |
| `settings.md` | Appearance (interface, conversation and code sizes), language, updates, web access |
| `shortcuts.md` | Keyboard shortcuts, generated from the app's shortcut registry |
| `offline-install.md` | Installing VERA and plugins without network (07_Delivery layout) |
| `troubleshooting.md` | Common problems, logs, where data lives |

## Work packages

| WP | Title | Result |
|---|---|---|
| HELP-01 | French interface | `renderer/locales/fr.json` with every key, `"fr"` in the `language` setting schema and picker, `check:i18n` over four catalogs, dates and numbers formatted for `fr` |
| HELP-02 | Help content loading | main reads `<resources>/help/<lang>/` (development: `05_Software/help/`) read-only through a strict IPC channel (`help.list`, `help.read`): page list with titles, one page by name and language with English fallback; no path outside the help folders; packaging copies `help/` into resources |
| HELP-03 | Help view and button | the top-bar ⓘ About button becomes ? Help next to the right-panel toggle; Help opens a view with the page list and the page rendered by the existing Markdown viewer, in the interface language; internal links between help pages work; F1 opens the page of the current screen; About stays in Settings |
| HELP-04 | Plugin help | `plugin.yaml` accepts per-language descriptions; the plugin page and the Help view show `help/<lang>.md` of an installed plugin with English fallback; the catalog build includes `help/` in each plugin zip |
| HELP-05 | Agent help tool | a read-only `help` tool in the tool registry: list topics, read an app page or the page of an enabled plugin in the requested language (default: the user's language, fallback English); results carry a citation that opens the page in the Help view; the system prompt names the tool for questions about VERA itself |
| HELP-06 | App help pages | the twelve pages above in en, then ro, de and fr; `shortcuts.md` generated from the shortcut registry by a build step so it never drifts |
| HELP-07 | Help checks | `02_Tools/build/check-help.mjs` (`npm run check:help`): the same page set in all four languages for the app and for every official plugin, valid internal links, no empty page; part of `npm run verify` |
| HELP-08 | Plugin help pages | `help/<lang>.md` for all 37 official plugins in four languages, from each plugin's README and skills, written for the user (what it does, what it needs, how to ask the agent), and the per-language catalog descriptions |

Order: HELP-01 and HELP-02 first and independent; HELP-03 after HELP-02; HELP-04 after HELP-02;
HELP-05 after HELP-02 and HELP-04; HELP-07 with HELP-03; HELP-06 and HELP-08 last, once the views exist
to read them in. Content work packages can be split by language.

## Size

Twelve app pages × 4 languages = 48 pages; 37 plugins × 4 languages = 148 pages; plus 37 × 3
translated catalog descriptions. English is written first; the other languages are translated from it.

## Verification

- Unit: help IPC refuses paths outside the help folders and falls back to English; the `help` tool lists
  and reads app and plugin pages and refuses a disabled plugin's page; `check:help` fails on a missing
  language, a broken link and an empty page.
- Browser E2E (`?mock=`): the ? button opens Help in each interface language, links between pages work,
  F1 opens the screen's page, Settings → About still shows the version and licenses.
- Native E2E on a packaged build: help pages load from `<resources>/help/` with no network.
- `check:i18n` passes with four catalogs; the French interface is checked at the minimum window size.

## Open

- Human review of the ro, de and fr texts (interface and help) is not recorded; it stays a deferred
  item like the existing ro/de interface review.
- Screenshots in help pages are left out for now; if added later they are generated from the mock UI so
  they stay current.
