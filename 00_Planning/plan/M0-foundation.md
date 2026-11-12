# M0 — Foundation

PURPOSE: a secure, themed, translated Electron app on the planned source layout, and proof that the
native parts VERA depends on work inside a packaged build.
STATE: 2026-11-01 — implemented; WP-01…WP-05 and the M0 epic are closed in Gitea. This file is now a
historical record of the plan: the WP text below is unchanged, and
[Implementation notes](#implementation-notes-2026-11-01) record what the code does. In "Start from"
lines, read `09_Others/benchpilot-reference/src/apps/…` as `…/apps/…` and the reference's
`src/libraries/shared/` as `packages/shared/`.
DONE-WHEN: the launch e2e passes on Windows and Ubuntu with the security baseline of 01 §7; theme,
text size and language switch and persist; the packaging spike WP-05 has filed its ADR.

## WP-01 Electron shell and source skeleton

**Goal:** a running Electron app — main, preload and React renderer built with electron-vite — on the
source layout of 01 §5, hardened per 01 §7, with the first Playwright test.
**Depends on:** —. **Specs:** 01 §2, §3, §5, §7; 06 §1; 08 §1–§3; ADR-0001, ADR-0009.
**Start from:** `09_Others/benchpilot-reference/src/apps/web` set-up (Vite, Tailwind CSS v4, shadcn/ui) for the renderer.

Scope:
- The tooling is already in `05_Software/` (Biome, TypeScript, Vitest, `verify`; 08 §1). Add the
  workspaces `src/libraries/shared`, `src/libraries/core`, `src/apps/desktop`, `src/apps/cli`, each with a `tsconfig.json`
  extending `tsconfig.base.json` and referenced from the solution `tsconfig.json`; Playwright for Electron.
- `src/apps/desktop` with electron-vite: `src/main`, `src/preload`, `src/renderer` (React 19, Vite,
  Tailwind CSS v4, shadcn/ui, lucide-react).
- `BrowserWindow` with `contextIsolation`, `sandbox`, `nodeIntegration: false`, `webSecurity`; minimum
  size 1024×640; title "VERA".
- CSP `default-src 'self'` as a meta tag, and as a response header for production loads; `will-navigate`
  blocked; `setWindowOpenHandler` denies; the permission handler denies every request.
- Single-instance lock; window size and position persisted.
- Scripts `dev`, `build` and `test:e2e`; e2e under `xvfb-run` on Linux. `npm run verify` stays green.
- The `VERA_TEST=1` build flag of 08 §3, without switches yet.

Done when:
- [ ] e2e: the window opens titled "VERA".
- [ ] e2e: in the renderer, `typeof require`, `typeof process` and `typeof module` are `"undefined"`.
- [ ] e2e: an inline script injected into the page does not run.
- [ ] e2e: `location.assign("https://example.com")` leaves the app in place, and `window.open` returns `null`.
- [ ] A second launch opens no second window.

## WP-02 Shared contracts and the typed IPC bridge

**Goal:** the only path between renderer and main — typed channels validated with zod on both sides,
event subscription and a mock bridge for UI work.
**Depends on:** WP-01. **Specs:** 01 §1 (L1, L2, L9), §3, §4; 06 §8; ADR-0010.
**Start from:** `09_Others/benchpilot-reference/src/apps/web/src/api/client.ts` and `api/index.ts` (one data boundary with a
mock switch), `src/apps/web/src/mocks/`, `src/libraries/shared/src/api.ts`.

Scope:
- `src/libraries/shared/src/ipc.ts`: a `defineChannel(name, request, response)` registry with inferred
  types; the `VeraError` schema (`code`, `messageKey`, `params`).
- `src/libraries/shared/src/events.ts`: the `AppEvent` union, starting with `settings.changed`.
- Main: one `ipcMain.handle("vera:invoke")` router — checks that the sender frame is the app's
  renderer, validates the request, dispatches, validates the response, maps thrown errors to
  `VeraError` (`INTERNAL` plus a log entry for unknown errors).
- Main: the `vera:event` emitter (`{ topic, id, seq?, event }`) and a 50 ms delta-coalescing helper.
- Preload: `contextBridge.exposeInMainWorld("vera", { invoke, subscribe })`, typed as in 01 §3.
- Renderer: the `api/` boundary with `ipcApi` and `mockApi` (`VITE_API=mock`), TanStack Query; script
  `dev:renderer`.
- First channel `app.info` → `{ name, version, platform, arch, portable, locale }` on a placeholder home screen.
- The import boundaries of 01 §4 are already enforced by `npm run lint`; keep the package names
  (`@vera/shared`, `@vera/core`) that `biome.json` and its test expect.

Done when:
- [ ] Unit: the router rejects an unknown channel, an invalid request (`INVALID`) and a foreign sender frame.
- [ ] Unit: a handler result that fails its response schema yields `INTERNAL` and a log entry, not a crash.
- [ ] e2e: the home screen shows the version from `app.info`.
- [ ] `VITE_API=mock npm run dev:renderer` shows the same screen in a browser.
- [ ] `npm run lint` passes on the real packages, and `tests/tooling/boundaries.test.ts` still passes.

## WP-03 App data locations, settings and logging

**Goal:** where VERA keeps its own data — versioned settings (no migrations until the first public
release), portable mode, and redacting logs.
**Depends on:** WP-02. **Specs:** 01 §1 (L7, L10), §6; 07 §4, §6; ADR-0009.
**Start from:** `09_Others/benchpilot-reference/src/apps/server/src/llm/credentials.ts` (write-then-rename with the Windows retry).

Scope:
- Ports in `src/libraries/core/src/ports.ts`: `PathProvider`, `Clock`, `Logger`, and a file-access port;
  main-process implementations.
- Portable mode: `vera.portable` beside the executable sets `userData` to `<app folder>/data/` before
  `app.whenReady()`.
- `src/libraries/shared/src/settings.ts`: `schemaVersion`; `installationId` (UUID made on first run);
  `language` (`system | en | ro | de`); `theme` (`system | light | dark`); `textScale`
  (`0.875 | 1 | 1.125 | 1.25 | 1.5`); `defaultModel` (`null`); `providers` (non-secret, empty);
  `updates` (`{ mode: "notify", channel: "latest" }`); `recentWorkbenches` (`[]`); `limits`
  (`{ maxToolCallsPerTurn: 50 }`).
- Settings service: load; atomic save; partial updates validated by a strict zod schema;
  `settings.changed` events; `schemaVersion` is 1, and a file with any other version is invalid.
  (As first planned: migrate with a `settings.json.bak-<n>` backup, and a higher `schemaVersion` loads
  defaults read-only. Both were removed; WP-32 is deferred until the first public release.)
- IPC `app.settings.get` and `app.settings.update`.
- Logger: JSON lines in `<userData>/logs/vera-YYYY-MM-DD.log`, seven files kept, levels, and a redaction
  hook that removes registered secrets.

Done when:
- [ ] Unit: the first run creates settings with a new `installationId`.
- [ ] Unit: a save interrupted between write and rename leaves the previous file valid.
- [ ] Unit: an unreadable file, one with an unknown key or one with another `schemaVersion` is
  invalid, is not modified and stops startup; settings are never read-only.
- [ ] Unit: the portable marker switches `userData` (path logic tested without Electron).
- [ ] Unit: a registered secret never appears in a log line.
- [ ] e2e: `app.settings.update({ theme: "dark" })` survives an app restart.

## WP-04 UI foundation: layout, themes, text size, languages

**Goal:** the app shell every screen lives in, with appearance and language settings working end to end.
**Depends on:** WP-03. **Specs:** 06 §1, §2, §4, §6, §7, §8; 01 §1 (L9).
**Start from:** `09_Others/benchpilot-reference/src/apps/web/src/components/shell/`, `hooks/use-theme.ts`, `components/ui/`,
`pages/SettingsPage.tsx` (layout of the settings screen).

Scope:
- The layout of 06 §1: sidebar, centre and right panel; resizable and collapsible; sizes persisted;
  overlay mode below 1280 px.
- Routing with a memory history at the confined production URL `vera://app/index.html`: a Welcome placeholder and Settings.
- Themes as CSS-variable blocks in `renderer/styles/themes.css`; System follows
  `prefers-color-scheme`; main sets `nativeTheme.themeSource` from the setting.
- Text size: the five steps of 06 §4 on the root font size; every size in `rem`.
- i18next with `renderer/locales/{en,ro,de}.json`; the System language from `app.info.locale`;
  `check:i18n` part of `verify`.
- The App settings screen with Appearance and Language; other sections as placeholders.
- Focus rings and keyboard reachability; mock mode renders everything.

Done when:
- [ ] e2e: switching the theme changes the root theme attribute at once and survives a restart.
- [ ] e2e: each text size sets the expected root font size and survives a restart.
- [ ] e2e: Română shows Romanian labels; Deutsch shows German ones.
- [ ] `check:i18n` fails on a fixture with a missing key and passes on the codebase.
- [ ] No horizontal overflow at 1024×640 in any theme or text size.
- [ ] Every control on the settings screen is reachable with Tab and shows a focus ring.

## WP-05 Spike: native modules and the embedding model in packaged builds

**Goal:** prove early that SQLite with FTS5 and trigram, and a bundled ONNX embedding model, work in
packaged Electron builds on Windows and Linux, offline.
**Depends on:** WP-01. **Specs:** ADR-0005, ADR-0006; 05 §4, §5; 07 §1, §2; 01 §1 (L5).
**Start from:** `09_Others/benchpilot-reference/scripts/package.mjs` (pre-packaging checks), `scripts/sandbox/BenchPilot.wsb`.

Scope:
- A minimal `electron-builder.yml` producing a Windows zip and a Linux AppImage of the shell, with
  `asarUnpack` for native modules and models.
- A test-build-only check (`VERA_TEST=1`) that, in the packaged app:
  1. opens better-sqlite3 in a temporary folder with WAL, creates an FTS5 `unicode61` table and an FTS5
     `trigram` table, inserts and queries both — the trigram query `C1_C` must find `I2C1_CR1`;
  2. loads `bge-small-en-v1.5` (quantised ONNX) from `src/models/` with `@huggingface/transformers`
     on onnxruntime-node, in a worker thread, with `allowRemoteModels = false`, and embeds three
     sentences, timing load and per-chunk embedding.
- Plan B: does `node:sqlite` open in Electron's Node, with FTS5 and trigram?
- Model delivery at build time (L5 forbids only run-time downloads): pinned URLs with SHA-256, or
  files kept with the sources; implement the choice.
- Run each package on a machine or VM without network (Windows Sandbox, an Ubuntu VM).
- This instrumented spike proves native-module and model packaging feasibility; it does not replace
  WP-33's smoke on the actual release artifacts (08 §5).
- Measure package size, unpacked size, and the shares of onnxruntime and of the model.

Done when:
- [ ] Measurements per OS are written down: module load, FTS5 and trigram, model load time, embedding
  time per chunk, sizes, offline result; plus the `node:sqlite` result.
- [ ] Model delivery is implemented.
- [ ] A new ADR confirms or amends ADR-0005 and the delivery part of ADR-0006, and the index in
  `../decisions/README.md` is updated.
- [ ] Nothing spike-only reaches release builds.

NOTES:
- WP-05 gates WP-07 (database driver) and, through its measurements, WP-24 (model choice).

## Implementation notes (2026-11-01)

Checked against the working tree on `master` (33e72b8 plus uncommitted changes) by reading code and
tests; nothing was run. Paths are relative to `05_Software/`: `core/` = `src/libraries/core/src/`,
`shared/` = `src/libraries/shared/src/`, `main/` and `renderer/` = `src/apps/desktop/src/main/`,
`…/renderer/`.

- WP-01: implemented with deviation: shadcn/ui is only scaffolded — its one component,
  `renderer/components/ui/card.tsx`, is unused, and styling is hand-written CSS on Tailwind v4
  (`renderer/styles.css:1`). The five e2e checks are in `tests/e2e/shell.spec.ts:47-179`.
- WP-02: implemented with deviation: there is no home screen — the `app.info` version shows in
  Settings › About (`tests/e2e/shell.spec.ts:52-54`); `app.info` adds `testBuild` and `signing`
  (`shared/ipc.ts:90-99`); a second IPC handler, `vera:subscription`, carries subscriptions
  (`main/index.ts:191`). Router, 50 ms coalescing and mock mode as planned (`main/ipc-router.ts:73-101`,
  `main/events.ts:188-231`, `tests/e2e/mock.spec.ts`).
- WP-03: implemented with deviation: settings are at `schemaVersion` 1 with a strict schema (unknown
  keys invalid, `webAccess` required) and no migrations, backups or read-only mode; an unreadable or
  invalid file, including any other version, gives INVALID, stays untouched and stops startup
  (`app.startup.failed`; the CLI fails the same way); the FileAccess `backup` port is removed;
  `textScale` has a sixth step, 0.75 (`shared/settings.ts`); `providers` defaults to
  `{ openai: {}, custom: [] }`. Portable mode, atomic save with the Windows retry and the seven-file
  redacting logger as planned (`main/data-locations.ts`, `main/file-access.ts`, `main/logger.ts`).
- WP-04: implemented with deviation: six text sizes, plus chat and code font sizes in px that ignore
  the scale (`renderer/hooks/use-preferences.ts:39-45`), so not "every size in `rem`"; navigation is
  React state, not a memory-history router (`renderer/App.tsx:29-31`); one settings page with eleven
  sections and vertical navigation (`renderer/components/settings.tsx:26-36`); the native e2e checks
  German only, Romanian only in mock mode (`tests/e2e/mock.spec.ts:78-83`).
- WP-05: partly implemented: the probes, the `node:sqlite` plan B (`main/packaging/sqlite-probe.ts`),
  verified model delivery by pinned URL and SHA-256 (`src/models/model-manifest.json`,
  `02_Tools/environment/prepare-model.mjs:25-67`), probe exclusion from release builds
  (`tests/tooling/build-mode.test.ts:62-77`) and ADR-0013 exist; missing: the offline Windows run (a
  connected-host run was accepted, ADR-0013 "Evidence and acceptance") and the per-OS measurements,
  whose file was deleted with the evidence folder in commit 891a699 — only sizes remain in ADR-0013.

Not in the plan, implemented in this area:
- Custom window chrome: hidden title bar with a themed overlay, File/Edit/View/Help menus over a
  `window.menu` channel, F10 to the menu (`main/window-chrome.ts`, `shared/ipc.ts:106-114`).
- Extra hardening: `will-frame-navigate` and webview attachment blocked, the preload refuses to run
  unsandboxed, HTTP/2 off (`main/security.ts:59-84`, `src/apps/desktop/src/preload/index.ts:4`).
- Remappable, persisted keyboard shortcuts (`shared/keyboard-shortcuts.ts`,
  `tests/e2e/keyboard-shortcuts.spec.ts`); versioned window-state and layout records (version 1;
  invalid or other-version data gives the defaults and is overwritten, with no read-only mode).
- Extra settings: `webAccess`, `keyboardShortcuts`, `chatFontSize`, `codeFontSize`, `sessionOrder`,
  `suppressBypassWarning` (`shared/settings.ts:30-53`).
- An app-local Microsoft VC++ runtime for Windows (`src/windows_runtime/`,
  `02_Tools/environment/prepare-windows-runtime.mjs`).
