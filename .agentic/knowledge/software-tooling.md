# Software tooling and source workspaces

## Routing

Select for npm workspaces, exact dependency pins, TypeScript references, import boundaries,
verification commands and Electron test launchers, the Node fetch/socket network guard and smoke:live. Start at `05_Software/package.json`
and `tsconfig.json`; focused tests are `tests/tooling/`. Desktop runtime behavior belongs
to [desktop-shell](desktop-shell.md); toolchain installation is owned by `02_Tools/`.

## Purpose and boundaries

The software root supplies four ESM workspaces, strict compilation, Biome boundaries,
Vitest projects and Playwright acceptance launchers. Shared publishes zod IPC/settings/workbench schemas; core
publishes host ports, settings and workbench services; CLI exposes its skeleton entrypoint. Desktop owns the running Electron shell and renderer-only dev mode.

## Public interface

From `05_Software`, use `npm run verify`, `check:i18n`, `lint`, `format`, `typecheck`, `build`, `dev`, `dev:renderer`
and `test:e2e`. The repository-local `python ../02_Tools/npmw.py` wrapper selects pinned Node.
See [software README](../../05_Software/README.md) for setup and command details.
`prepare:model`, `package` and `package:test` route to [native packaging](native-packaging.md),
which owns verified assets, native staging and artifact measurements.

## Invariants

- Direct dependency versions are exact; install from the committed lockfile using npm ci.
  Core pins @earendil-works/pi-ai1.1.0 for the gateway, yaml2.9.1, ulid3.0.2 and ignore7.0.12 for parsing, identity and ignore rules.
- Desktop Vite main resolves core/shared from source; preload/renderer resolve shared from source.
  Core/desktop Vitest resolve their library dependencies from source; TypeScript supplies generated output for library consumers.
- The tooling TypeScript project references shared before compiling e2e contract consumers.
- All four workspaces extend the strict base and participate in the root TypeScript solution.
- Core's Electron prohibition and the existing layer/import rules remain enforced by Biome regression tests.
- E2e uses temporary userData and explicit Chromium sandboxing; non-loopback Node and Chromium requests are blocked.
- Linux acceptance runs through xvfb-run with platform-specific dependencies separate from Windows.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Workspace/pin/reference layout | manifests and `tsconfig*.json` | `skeleton.test.ts`, typecheck |
| Layer boundaries | `biome.json` | `boundaries.test.ts` |
| Test-build constant | desktop Vite config and `build-mode.ts` | `build-mode.test.ts` |
| Acceptance execution/isolation | `scripts/`, `e2e/network-guard.ts` | Electron acceptance and guard self-test |

Catalog audit scans renderer TypeScript AST for literal and finite registered translation keys, excluding tests; English defines required catalog keys.

## Key behaviors

- `REQ-TEST-4a040006` — check:i18n rejects missing, unused and translation-only catalog keys.
- `REQ-PLAT-6f3e3500` — four strict ESM workspace skeletons respect established boundaries.
- `REQ-TEST-21b726d6` — development, build and isolated acceptance commands are reproducible.
- `REQ-TEST-2308561a` — actual builds emit the configured test identity, unaffected by runtime overrides.

## Architecture

```mermaid
flowchart LR
  setup([02_Tools/npmw.py]) --> npm[package.json scripts]
  npm --> biome[Biome boundaries + formatting]
  npm --> tsc[tsc -b root solution]
  tsc --> shared[packages/shared]
  tsc --> core[packages/core]
  tsc --> cli[apps/cli]
  tsc --> desktop[apps/desktop process configs]
  core -. manifest dependency .-> shared
  cli -. manifest dependency .-> core
  cli -. manifest dependency .-> shared
  desktop --> shared
  npm --> browser[VITE_API=mock browser renderer]
  desktop -. manifest dependency .-> core
  desktop -. manifest dependency .-> shared
  npm --> unit[Vitest projects]
  npm --> launcher[test-e2e.mjs]
  launcher --> build[electron-vite build]
  launcher --> acceptance[Playwright Electron]
  acceptance --> guard[network-guard.ts]
```

Dashed arrows describe npm dependency declarations, while solid arrows describe command
execution and compilation ownership. Core exports ports/settings/workbench/LLM gateway; shared publishes IPC/settings/workbench types/schemas;
CLI retains its skeleton entrypoint.

## Files

All paths are under `05_Software/`.

- `package.json`, `package-lock.json`, `.npmrc`, `README.md` — installation and commands.
- `biome.json`, `tsconfig.base.json`, `tsconfig.json`, `tsconfig.tools.json` — checks and compilation.
- `vitest.config.ts`, `playwright.config.ts` — test projects and acceptance settings.
- `tests/tooling/{boundaries,skeleton,build-mode}.test.ts` — boundary, layout and emitted-build regression tests, with compiled shared entry hidden during builds.
- `packages/{shared,core}/{package.json,tsconfig.json,src/index.ts}` — library definitions and public exports.
- packages/core/vitest.config.ts — core Node tests with shared source resolution.
- `apps/cli/{package.json,tsconfig.json,src/index.ts}` — CLI skeleton.
- `scripts/test-e2e.mjs`, `dev-test-server.mjs` — build/acceptance and isolated Vite launchers.
- `tests/network-{guard,setup}.ts`, `tests/tooling/network-guard.test.ts` — unit-test transport interception and guard regression.
- `e2e/network-guard.ts`, `shell.spec.ts` — connection interception and real-process acceptance.

- scripts/check-i18n.mjs, tests/tooling/i18n.test.ts and fixtures/i18n/missing-key.json — source-catalog usage/completeness audit and actual negative CLI regression.
