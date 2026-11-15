# Help

## Routing

Select for app help pages, `05_Software/help/`, `<resources>/help`, `help.list`, `help.read`, `HelpLibrary`,
help language fallback and help packaging. First source entry: `05_Software/src/libraries/core/src/help/library.ts`;
schemas in `05_Software/src/libraries/shared/src/help.ts`. Focused tests: `core/src/help/library.test.ts`,
`shared/src/help-ipc.test.ts`, `renderer/mocks/mockApi.test.ts`, `tests/packaging/packaging.test.ts`. Workbench
documents and their viewer belong to [Document viewer](document-viewer.md); interface catalogs to
[Renderer foundation](renderer-foundation.md).

## Help view

- A Help (?) button (`data-action="show-help"`) beside the right-panel toggle opens Help at `index`; F1 (no modifiers,
  not while a dialog or shortcut recording owns keys) opens `screenHelpPage(screen)` (`renderer/lib/help-pages.ts`).
- `renderer/components/help.tsx` `HelpView`: the page (session `Markdown` with the `link` hook, so `name.md` links open
  that page) on the left, the `help.list` page list on the right (`aria-current="page"`), in the resolved interface
  language. Help is a detour like Plugins in `App.tsx`: paths that leave Plugins leave Help, hidden drafts stay mounted.
- Tests: `components/help.test.ts`, `lib/help-pages.test.ts`, `tests/e2e/help.spec.ts` (browser mock on a free port).

## Plugin help

- An installed plugin's `help/<language>.md` (else `help/en.md`) is read by core `readPluginHelp(folder, language)`;
  the realpath of `<folder>/help` must be the package's own `help` folder and each file must stay inside it.
- `help.list` appends, after the app pages, the healthy plugins of the open workbench's plugin view whose composition
  lists help, sorted by title, as `{page: id, plugin: id, title, language}`; `help.read {plugin, language}` serves
  one (NOT_FOUND when not installed, with issues or without help). The renderer keys them `plugin/<id>`, lists them
  under a paged Plugins heading, and `HelpContext` lets each plugin row's Help button open its page.
- Tests: `core/src/help/library.test.ts`, `components/plugins.test.ts`, `tests/e2e/help-plugins.spec.ts`.

## Agent help tool

- Built-in read-only tool `help` (`core/src/tools/help.ts`) over the `HelpHost` port on `ToolContext.help`
  (`app` HelpLibrary, `language()` the interface language, `plugins()` the workbench's enabled plugins with folders).
  `{}` lists `{language, pages, plugins}` with refs; `{page}` or `{plugin}` (optional `language`) returns
  `{ref, title, language, text}`; a plugin that is not enabled, or has no help, is an error naming it.
- Refs `help:<page>` and `help:plugin/<id>` are a shared `parseRef` kind; `validateCitations` accepts them when the
  session's tool results issued them. The transcript routes a help citation to `HelpContext` (`helpCitationKey`).
- Desktop main passes `help` to `SessionsHost`; the session drops the tool without a host and the prompt gains one rule
  when it is offered. The headless CLI composes no help host.
- Tests: `core/src/tools/help.test.ts`, `shared/src/refs.test.ts`, `core/src/agent/citations.test.ts`,
  `core/src/agent/prompt.test.ts`, `components/help.test.ts`.

## Purpose and boundaries

App help is Markdown in `05_Software/help/<en|ro|de|fr>/<page>.md`, shipped read-only as `<resources>/help`. Core
`HelpLibrary` lists and reads it; desktop main exposes it through `help.list` and `help.read`; the browser mock serves
the same source tree through `import.meta.glob`. Packaging (`02_Tools/release/package.mjs` `stageHelp`) copies it.

## Public interface

- `help.list {language}` → `[{page, title, language}]`: the pages of that language, English pages filling its gaps
  (marked `language: "en"`); order `index`, then the pages `index.md` links as `(name.md)`, then the rest by name.
  Title is the first level-one heading, else the page name.
- `help.read {page, language}` → `{page, title, language, content}`: the page in that language, else the English page
  with `language: "en"`; NOT_FOUND when neither exists.
- Shared helpers `helpTitle`, `helpLinks`, `orderHelpPages`; constants `helpLanguages`, `HELP_PAGE_BYTES` (256 KiB).

## Invariants

- Page names match `^[a-z0-9][a-z0-9-]{0,63}$` and languages are en/ro/de/fr; anything else is INVALID at the schema
  (REQ-SEC-8e27b5ca).
- A file is read only when its realpath stays below the realpath of the help root and it is a regular file within
  `HELP_PAGE_BYTES`; otherwise it counts as absent, so a symlink or junction leaving the root is never followed.
- Help is read-only: no channel writes below the help root.
- Packaging fails when `help/en/index.md` is missing, and the packaged payload check requires
  `resources/help/en/index.md` (REQ-PLAT-73bc566c).

## Key behaviors

- REQ-FUNC-2e84bc58 list, REQ-FUNC-a2db3ddc read with English fallback, REQ-REL-e038060c NOT_FOUND,
  REQ-SEC-8e27b5ca confinement, REQ-PLAT-73bc566c packaged `<resources>/help` and development `05_Software/help`.

## Files

- `05_Software/help/<language>/*.md` — the pages.
- `05_Software/src/libraries/shared/src/help.ts` — schemas and pure helpers.
- `05_Software/src/libraries/core/src/help/library.ts` — `HelpLibrary`, `readHelpFile`.
- `05_Software/src/apps/desktop/src/main/index.ts` — help root and `help.*` handlers.
- `05_Software/src/apps/desktop/src/renderer/mocks/help.ts` — browser mock help.
- `02_Tools/release/package.mjs` `stageHelp`; `05_Software/src/apps/desktop/electron-builder.yml` extraResources.
