# Help

## Routing

Select for app help pages, `05_Software/help/`, `<resources>/help`, `help.list`, `help.read`, `HelpLibrary`,
help language fallback and help packaging. First source entry: `05_Software/src/libraries/core/src/help/library.ts`;
schemas in `05_Software/src/libraries/shared/src/help.ts`. Focused tests: `core/src/help/library.test.ts`,
`shared/src/help-ipc.test.ts`, `renderer/mocks/mockApi.test.ts`, `tests/packaging/packaging.test.ts`. Workbench
documents and their viewer belong to [Document viewer](document-viewer.md); interface catalogs to
[Renderer foundation](renderer-foundation.md).

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
