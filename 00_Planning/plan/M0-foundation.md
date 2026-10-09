# M0 — Foundation

PURPOSE: a secure, themed, translated Electron app on the planned source layout, and proof that the
native parts VERA depends on work inside a packaged build.
DONE-WHEN: the launch e2e passes on Windows and Ubuntu with the security baseline of 01 §7; theme,
text size and language switch and persist; the packaging spike WP-05 has filed its ADR.

## WP-01 Electron shell and source skeleton

**Goal:** a running Electron app — main, preload and React renderer built with electron-vite — on the
source layout of 01 §5, hardened per 01 §7, with the first Playwright test.
**Depends on:** —. **Specs:** 01 §2, §3, §5, §7; 06 §1; 08 §1–§3; ADR-0001, ADR-0009.
**Start from:** BenchPilot `apps/web` set-up (Vite, Tailwind CSS v4, shadcn/ui) for the renderer.

Scope:
- npm workspaces `packages/shared`, `packages/core`, `apps/desktop`, `apps/cli`; TypeScript strict ESM
  with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; exact dependency pins; Vitest;
  Playwright for Electron.
- `apps/desktop` with electron-vite: `src/main`, `src/preload`, `src/renderer` (React 19, Vite,
  Tailwind CSS v4, shadcn/ui, lucide-react).
- `BrowserWindow` with `contextIsolation`, `sandbox`, `nodeIntegration: false`, `webSecurity`; minimum
  size 1024×640; title "VERA".
- CSP `default-src 'self'` as a meta tag, and as a response header for production loads; `will-navigate`
  blocked; `setWindowOpenHandler` denies; the permission handler denies every request.
- Single-instance lock; window size and position persisted.
- The scripts of 08 §1 that exist at this point (`dev`, `build`, `typecheck`, `test`, `test:e2e`,
  `verify`); e2e under `xvfb-run` on Linux.
- The `VERA_TEST=1` build flag of 08 §3, without switches yet.

Done when:
- [ ] e2e: the window opens titled "VERA".
- [ ] e2e: in the renderer, `typeof require`, `typeof process` and `typeof module` are `"undefined"`.
- [ ] e2e: an inline script injected into the page does not run.
- [ ] e2e: `location.assign("https://example.com")` leaves the app in place, and `window.open` returns `null`.
- [ ] A second launch opens no second window.

## WP-02 Shared contracts and the typed IPC bridge

**Goal:** the only path between renderer and main — typed channels validated with zod on both sides,
event subscription, a mock bridge for UI work, and the import-boundary check.
**Depends on:** WP-01. **Specs:** 01 §1 (L1, L2, L9), §3, §4; 06 §8; ADR-0010.
**Start from:** BenchPilot `apps/web/src/api/client.ts` and `api/index.ts` (one data boundary with a
mock switch), `apps/web/src/mocks/`, `packages/shared/src/api.ts`.

Scope:
- `packages/shared/src/ipc.ts`: a `defineChannel(name, request, response)` registry with inferred
  types; the `VeraError` schema (`code`, `messageKey`, `params`).
- `packages/shared/src/events.ts`: the `AppEvent` union, starting with `settings.changed`.
- Main: one `ipcMain.handle("vera:invoke")` router — checks that the sender frame is the app's
  renderer, validates the request, dispatches, validates the response, maps thrown errors to
  `VeraError` (`INTERNAL` plus a log entry for unknown errors).
- Main: the `vera:event` emitter (`{ topic, id, seq?, event }`) and a 50 ms delta-coalescing helper.
- Preload: `contextBridge.exposeInMainWorld("vera", { invoke, subscribe })`, typed as in 01 §3.
- Renderer: the `api/` boundary with `ipcApi` and `mockApi` (`VITE_API=mock`), TanStack Query; script
  `dev:renderer`.
- First channel `app.info` → `{ name, version, platform, arch, portable, locale }` on a placeholder home screen.
- `check:boundaries` enforcing 01 §4, part of `verify`.

Done when:
- [ ] Unit: the router rejects an unknown channel, an invalid request (`INVALID`) and a foreign sender frame.
- [ ] Unit: a handler result that fails its response schema yields `INTERNAL` and a log entry, not a crash.
- [ ] e2e: the home screen shows the version from `app.info`.
- [ ] `VITE_API=mock npm run dev:renderer` shows the same screen in a browser.
- [ ] `check:boundaries` fails on a fixture violation and passes on the codebase.

## WP-03 App data locations, settings and logging

**Goal:** where VERA keeps its own data — versioned settings with migrations, portable mode, and
redacting logs.
**Depends on:** WP-02. **Specs:** 01 §1 (L7, L10), §6; 07 §4, §6; ADR-0009.
**Start from:** BenchPilot `apps/server/src/llm/credentials.ts` (write-then-rename with the Windows retry).

Scope:
- Ports in `packages/core/src/ports.ts`: `PathProvider`, `Clock`, `Logger`, and a file-access port;
  main-process implementations.
- Portable mode: `vera.portable` beside the executable sets `userData` to `<app folder>/data/` before
  `app.whenReady()`.
- `packages/shared/src/settings.ts`: `schemaVersion`; `installationId` (UUID made on first run);
  `language` (`system | en | ro | de`); `theme` (`system | light | dark`); `textScale`
  (`0.875 | 1 | 1.125 | 1.25 | 1.5`); `defaultModel` (`null`); `providers` (non-secret, empty);
  `updates` (`{ mode: "notify", channel: "latest" }`); `recentWorkbenches` (`[]`); `limits`
  (`{ maxToolCallsPerTurn: 50 }`).
- Settings service: load; migrate with a `settings.json.bak-<n>` backup; atomic save; partial updates
  validated by zod; `settings.changed` events; a higher `schemaVersion` loads defaults read-only.
- IPC `app.settings.get` and `app.settings.update`.
- Logger: JSON lines in `<userData>/logs/vera-YYYY-MM-DD.log`, seven files kept, levels, and a redaction
  hook that removes registered secrets.

Done when:
- [ ] Unit: the first run creates settings with a new `installationId`.
- [ ] Unit: a version-0 fixture migrates and leaves a backup.
- [ ] Unit: a save interrupted between write and rename leaves the previous file valid.
- [ ] Unit: a file with a higher `schemaVersion` is not modified; the service reports read-only.
- [ ] Unit: the portable marker switches `userData` (path logic tested without Electron).
- [ ] Unit: a registered secret never appears in a log line.
- [ ] e2e: `app.settings.update({ theme: "dark" })` survives an app restart.

## WP-04 UI foundation: layout, themes, text size, languages

**Goal:** the app shell every screen lives in, with appearance and language settings working end to end.
**Depends on:** WP-03. **Specs:** 06 §1, §2, §4, §6, §7, §8; 01 §1 (L9).
**Start from:** BenchPilot `apps/web/src/components/shell/`, `hooks/use-theme.ts`, `components/ui/`,
`pages/SettingsPage.tsx` (layout of the settings screen).

Scope:
- The layout of 06 §1: sidebar, centre and right panel; resizable and collapsible; sizes persisted;
  overlay mode below 1280 px.
- Routing with a hash or memory history (production loads from `file://`): a Welcome placeholder and Settings.
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
**Start from:** BenchPilot `scripts/package.mjs` (pre-packaging checks), `scripts/sandbox/BenchPilot.wsb`.

Scope:
- A minimal `electron-builder.yml` producing a Windows zip and a Linux AppImage of the shell, with
  `asarUnpack` for native modules and models.
- A test-build-only check (`VERA_TEST=1`) that, in the packaged app:
  1. opens better-sqlite3 in a temporary folder with WAL, creates an FTS5 `unicode61` table and an FTS5
     `trigram` table, inserts and queries both — the trigram query `C1_C` must find `I2C1_CR1`;
  2. loads `bge-small-en-v1.5` (quantised ONNX) from `resources/models/` with `@huggingface/transformers`
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
