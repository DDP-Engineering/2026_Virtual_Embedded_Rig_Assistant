# VERA software

The npm workspaces of VERA — `packages/shared`, `packages/core`, `apps/desktop`, `apps/cli` — with
end-to-end tests and development scripts. Layout and module boundaries:
[01-system.md §4–§5](../00_Planning/architecture/01-system.md). The desktop shell displays native metadata through the validated typed IPC bridge.

## Set-up and commands

From the repository root, once: `python 02_Tools/setup.py` (Ubuntu: `python3`). It installs the pinned
Node.js into `02_Tools/runtime/` and runs `npm ci` here. Then, from this folder:

| Command | Does |
|---|---|
| `npm run verify` | lint, typecheck and tests — run it before every review |
| `npm run lint` / `npm run format` | Biome: check / apply formatting and safe fixes |
| `npm run typecheck` | `tsc -b` |
| `npm test` | Vitest |
| `npm run dev` | Electron main, sandboxed preload and React renderer with loopback Vite/HMR |
| `VITE_API=mock npm run dev:renderer` | Browser renderer using in-memory metadata and app event mocks |
| `npm run build` | Build main ESM, preload CommonJS and bundled renderer into `apps/desktop/out/` |
| `npm run test:e2e` | Build, then Playwright Electron and Chromium mock acceptance; uses `xvfb-run -a` on Linux |

Without Node on the PATH, prefix any command with `python ../02_Tools/npmw.py`, for example
`python ../02_Tools/npmw.py npm run verify`. Full command list: [08-quality.md §1](../00_Planning/architecture/08-quality.md).

| File | Purpose |
|---|---|
| `package.json`, `package-lock.json`, `.npmrc` | workspaces, scripts, exact pins |
| `biome.json` | lint and format rules; the import boundaries of 01 §4 |
| `tsconfig.base.json`, `tsconfig.json`, `tsconfig.tools.json` | compiler options, `tsc -b` solution, tooling project |
| `vitest.config.ts` | test projects |
| `tests/tooling/` | tests of the repository's own checks |

The four workspaces are `@vera/shared`, `@vera/core`, `@vera/desktop` and `@vera/cli`. Each extends
the shared TypeScript base and participates in `tsc -b`. The desktop project separates Node, preload,
DOM renderer and build configuration type environments. Shared publishes typed zod IPC contracts;
core publishes host ports and versioned settings; CLI exposes its source skeleton. Desktop Vite main
resolves core/shared from source; sandbox preload/renderer resolve shared from source,
so build and development work before compiled library output exists.

The desktop shell displays name, version, platform, architecture, portable marker and OS locale from `app.info`, and saves normal window bounds in `<userData>/window-state.json`.
Production loads bundled assets through the confined `vera://app` protocol, with the same restrictive
CSP in both the HTML meta and response headers. Development uses `http://127.0.0.1:5173` and permits
the hashed React refresh preamble, injected development CSS and the exact HMR websocket. Production
compiles out the development URL branch. The preload is bundled as `.cjs` because Electron's sandbox
does not support ESM preload imports; TypeScript sources and the main process use ESM.

Set `VERA_TEST=1` while building to compile the test-build constant to true (PowerShell:
`$env:VERA_TEST="1"`; then run the build; remove it afterward with `Remove-Item Env:VERA_TEST`).
This shell introduces no test switches. The ordinary build ignores runtime `VERA_TEST` and renderer
URL overrides. Automated tests use temporary user data, enforce Chromium sandboxing, and reject
non-loopback connections in Chromium and Node. Screenshots are captured for human inspection.

`npm ci` runs `install-electron` to install the pinned Electron binary; npm's allowScripts entries
permit the pinned esbuild install scripts. Ubuntu requires the libraries and Xvfb listed by
`python3 ../02_Tools/setup.py --check`; keep Linux and Windows `node_modules` separate.

The renderer uses one `api/` interface: `ipcApi` wraps `window.vera`; `mockApi` supplies the same
app.info, app.settings.get/update and app subscriptions in memory. The API exposes
getSettings/updateSettings returning {settings,readOnly}. TanStack Query owns metadata requests;
English i18next labels and error keys live in `src/renderer/locales/en.json`. Full language settings
are defined by the UI work package. App subscriptions are invalidation signals; later event domains
add their own schemas and services. `portable` reports a `vera.portable` marker beside the executable;
the regular marker selects adjacent data before readiness. Installed mode uses Electron userData,
with --user-data-dir available for isolated tests. Selected portable/override directories are created
before Electron setPath and readiness; existing contents persist and creation errors propagate.
Settings live in settings.json, schema version 1.
Version 0 migrates after an exclusive bak-n; future schemas expose read-only defaults.
Accepted partial updates serialize and emit settings.changed after successful atomic saves.
Host logs retain seven UTC daily JSON-line files under userData/logs and redact registered secrets.
[Application data](../.agentic/knowledge/app-data.md) routes schemas, migrations and host adapters.

Before browser acceptance, run `python ../02_Tools/npmw.py npx playwright install chromium` once
(Ubuntu: python3). In PowerShell, browser mock development uses `$env:VITE_API="mock"`, then
`python ../02_Tools/npmw.py npm run dev:renderer`; remove the variable with `Remove-Item Env:VITE_API`
when returning to Electron development. The mock fixture version is taken from the desktop manifest.
