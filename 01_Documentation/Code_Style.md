# Code style

Only the rules no tool checks. Biome formats and lints (`npm run lint`, `npm run format`),
TypeScript is strict (`npm run typecheck`), and `check:i18n`, `check:help` and
`check:release-notes` guard texts. Write code that an agent can read in as few lines as possible.

## All code

- Simple, direct code; no speculative abstraction, wrapper layers or options nobody uses.
- One responsibility per file. Split a file that grows past about 400 lines, so a reader opens only
  what it needs.
- Explicit names over comments. A comment says why, never what; no commented-out code.
- No file banners, license headers, section markers or end-of-file markers.
- Fail closed at trust boundaries (IPC, files, settings, plugin manifests, program output, network):
  validate with zod, return or throw a typed error, never guess or continue with partial data.
- No compatibility code before 1.0.0 (`AGENTS.md`, "Pre-release policy").
- English for identifiers, comments, log messages and test names.

## TypeScript

- A one-line `/** … */` on exported functions, types and classes whose purpose is not obvious from
  the name; a longer TSDoc only for a non-obvious contract.
- Pure functions where possible; side effects at the edges (main process, ports, workers).
- `src/libraries/core` never imports Electron; the renderer reaches main only through the typed IPC
  bridge.
- Tests sit beside the code as `*.test.ts`; functional suites live in `05_Software/tests/`. Test what
  exists: one clear-path test and the negative cases at each trust boundary; never test that a
  removed feature is absent.

## Interface

- Every user-visible string is a translation key in `en`, `ro`, `de` and `fr`.
- The primary button is green; actions on the left, lists and outputs on the right; long lists use
  the shared pager (`components/pager.tsx`); Cancel and Save at the top right of a page.
- No helper or explanatory text under controls; explanations belong in the help pages. No transient
  labels that shift the layout.

## Python (plugin helpers)

- Standard library where possible; dependencies are pinned in the plugin manifest.
- PEP 8, type hints on functions, one-line module docstring.
- Write files with `newline="\n"`; the repository uses LF.
