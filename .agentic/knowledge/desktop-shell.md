# Desktop shell

## Routing

Select for Electron launch, VERA window, sandbox, CSP, `vera://app`, permissions,
single instance, window geometry, React foundation shell and desktop Vite configuration.
Start at `05_Software/src/apps/desktop/src/main/index.ts`; focused acceptance is
`05_Software/tests/e2e/shell.spec.ts`. Workspace/compiler commands belong to
[software-tooling](software-tooling.md).

## Purpose and boundaries

Main owns the native window, instance lock, local asset protocol and window-state file.
The window uses hidden native title chrome with a40px native-control overlay and renderer
menu/drag row. window-chrome.ts supplies fixed native role popups, theme-matched overlay
colors and outer-bounds restoration that compensates host DPI frame insets.
Main also wires [application data](app-data.md): portable paths, core settings, atomic filesystem and logs.
Main composes [updates](updates.md), defers downloaded-update close/quit while turns or approvals
remain active, then drains persistence before explicit installation.
Main composes [ChatGPT authentication](providers.md), confirmed system-browser opening and the
subscription credential host; shutdown drains OAuth cancellation before closing the credential store.
Main supplies the [workbench](workbench.md) lifecycle host and native folder picker.
Main composes [file-tool](file-tools.md) worker capacity and drains it during shutdown; grep-worker is a separate production entry.
The sandboxed preload exposes the typed invoke/subscribe bridge; React displays Welcome/App Settings and application metadata
through its API. [IPC boundary](ipc-boundary.md) owns shared contracts, dispatch and event behavior.

## Public interface

`npm run dev` starts the loopback development renderer and Electron. `npm run build`
emits main ESM, preload CommonJS and renderer assets under `src/apps/desktop/out/`.
`--user-data-dir=<path>` selects the isolated Electron userData directory.
`window-state.json` uses schema version 1 and integer normal bounds; its format is
specified in [REQ-DATA-6c54a48f](../specs/REQ-DATA-6c54a48f.md).
Compiled instrumented packages accept `--packaging-probe=<absolute JSON path>` after readiness,
run [native packaging](native-packaging.md) probes and exit before creating a renderer window.
Release compilation eliminates this hook and its worker entry.
Instrumented folder selection accepts VERA_TEST_DIALOG_PATH; release emission eliminates the
override and uses Electron dialog. Shutdown closes the sessions of every open workbench runtime, then releases each owned workbench lock, and terminates file workers before settings/log drain. Instrumented file-tool acceptance exposes a probe for host abort/responsiveness; release compilation eliminates the probe.

window.menu accepts only file/edit/view/help plus bounded integer window-local popup
coordinates through the authorized main-frame router. Native menus use fixed role templates;
coordinates clamp to content bounds. Browser mock acknowledges the native-only operation.

## Invariants

- Identity and userData precede the instance lock; the losing process exits before creating a window.
- Portable/explicit override directories are created before Electron setPath, readiness and the
  instance lock; real creation failures propagate. At ready, the credential load starts and settings and the
  saved window state load concurrently; the window is created after settings and window state, without waiting
  for credentials. A failed credential load logs `credentials.load.failed` and does not stop startup. Shutdown drains accepted
  workbench ownership and settings before window close, then flushes JSON logs after close.
- Window creation keeps context isolation, Chromium sandbox and web security enabled,
  Node integration disabled, and a minimum size of 1024 by 640.
- Session-created protection routes dictionary initialization to local vera://app resources and disables automatic spellchecking synchronously; default-session protection precedes startup awaits and window spellcheck=false prevents renderer use of remote Hunspell dictionaries.
- Navigation, new windows, webviews and permission requests/checks are denied before content loads.
- Production CSP is identical in meta and response headers; protocol assets stay inside the real renderer root. Images allow only self and Blob sources for the workbench preview; scripts/styles/connect/workers/fonts/object/base/frame/form restrictions are preserved. SVG preview remains img-only, with external loads/scripts/navigation inert.
- Development origin is exactly `http://127.0.0.1:5173`; its inline-script allowances are content hashes.
- Valid visible normal bounds persist atomically in window-state.json version 1. Corrupt, other-version
  or off-screen state uses centered defaults and is overwritten on close.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Launch/instance behavior | `src/main/index.ts` | built shell acceptance |
| Asset/security policy | `src/main/security.ts`, `content-policy.ts` | content-policy.test.ts; built image-preview.spec.ts security assertions |
| Geometry/storage format | `src/main/window-state.ts` | `window-state.test.ts`, geometry acceptance |
| Metadata/API/events | [ipc-boundary](ipc-boundary.md) | shell and browser mock acceptance |
| Renderer styles | `src/renderer/styles.css` | shell screenshot and development acceptance |
| Dev/preload/build environment | `electron.vite.config.ts`, `src/preload/index.ts` | development acceptance, build-mode test, typecheck |

## Key behaviors

- `REQ-UX-6ccae258` — one native window and visible VERA identity.
- `REQ-UX-4a040003` — nativeTheme follows initial and confirmed updated settings.
- [Renderer foundation](renderer-foundation.md) owns UI routes, panels, preferences and translations.
- `REQ-SEC-bba4d0dd` — page-world Node primitives are inaccessible.
- `REQ-SEC-11244926` — restrictive production CSP blocks injected inline scripts.
- `REQ-SEC-1aba9c7c` — attempted renderer navigation retains the app.
- `REQ-SEC-d6fdde98` — window.open is denied.
- `REQ-SEC-250c645c` — permission requests and checks are denied.
- `REQ-REL-9e5c0e0e` — a second process reuses the first instance.
- `REQ-DATA-6c54a48f` — safe normal bounds survive restart.
- `REQ-TEST-2308561a` — build-time test identity is fixed in emitted code.
- `REQ-NFR-54822de2` — concurrent startup loads; the window does not wait for credentials.
- `REQ-REL-ff1b5e56` — a credential file that fails to load still opens the window.
- `REQ-UX-86acd705` — the window background is the theme's `--background` (#101316 / #f5f5f3) from creation
  and on theme change (`window-chrome.ts` `windowBackground`).
- `REQ-NFR-9b03e401` — the production renderer is minified (`build.minify: true`; electron-vite defaults it off).
- `REQ-NFR-f3e0377c` — the first `session.send` of an open workbench with vectors of the current model embeds one
  short text in the indexer to load the model (`embedding-warmup.ts`); workbench create/open/close cancels it.

## Files

Paths below are relative to `05_Software/src/apps/desktop/` unless qualified.

- `package.json`, `tsconfig*.json`, `vitest.config.ts` — package identity and process-specific compilation/tests.
- `electron.vite.config.ts`, `components.json` — build/dev CSP and shadcn configuration.
- `src/main/index.ts` — lifecycle, lock, window creation and close ordering.
- `src/main/security.ts`, `content-policy.ts` and its test — confined asset responses, image-only Blob policy and denial handlers.
- `src/main/window-state.ts`, `window-state.test.ts` — storage and recovery semantics.
- `src/main/window-chrome.ts` — title bar overlay, window background and native role menus.
- `src/main/embedding-warmup.ts`, `embedding-warmup.test.ts` — first-message embedding warm-up.
- `05_Software/tests/e2e/startup.spec.ts` — failed credential load, dark background and opt-in startup timing
  (`VERA_STARTUP_TIMING=1`).
- `src/main/build-mode.ts` — compile-time identity export.
- `src/preload/index.ts`, `bridge.ts` — sandbox assertion and validated page-world bridge.
- `src/renderer/index.html`, `main.tsx`, `App.tsx`, `styles.css` — document, React entry and foundation shell; [renderer foundation](renderer-foundation.md) routes view files.
- `src/renderer/components/ui/card.tsx`, `lib/utils.ts` — adapted Card and class merging.
- `05_Software/tests/e2e/shell.spec.ts`, `network-guard.ts` — real Electron acceptance and egress guard.
- `05_Software/tests/tooling/build-mode.test.ts` — emitted identity execution in both build modes.

Desktop main registers the exact-pinned pi-ai public standalone OAuth entrypoint before composing authentication and gateway services, so login, refresh and token conversion are available in compiled Electron bundles. Core remains platform-independent. Focused native acceptance starts the actual bundled OAuth callback/prompt and cancels without opening a browser or exchanging tokens; scripted persistence and real personal acceptance remain separate.
