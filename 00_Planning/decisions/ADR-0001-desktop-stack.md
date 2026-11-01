# ADR-0001: Desktop stack — TypeScript on Electron

Date: 2026-10-09
Status: Accepted; implemented with one deviation (shadcn/ui; see Implementation status)

## Context
VERA is a desktop app for Windows and Linux. It must reach OpenAI, OpenAI-compatible and
ChatGPT-subscription models; compute embeddings locally; later drive cameras and serial ports; ship
as a self-contained package with an update mechanism; and be built almost entirely by coding agents
(Claude Code, Codex). The comparable tools are written in TypeScript (opencode, Claude Code, pi) or
Rust (the Codex CLI core).

## Decision
TypeScript (strict, ESM) on Electron. electron-vite builds main, preload and renderer; React with
Tailwind CSS and shadcn/ui renders the UI; npm workspaces hold the packages;
Vitest and Playwright test. Node.js 24 LTS runs the tooling. Versions are pinned exactly.

## Alternatives considered
- Rust with Tauri: small binaries, but the system webview differs between Windows (WebView2) and Linux
  (WebKitGTK), including media capture; the ChatGPT sign-in would have to be ported from Codex; agent
  edit-compile loops are slower.
- Go with Wails: simple language and a single binary, the same webview differences, and local ONNX
  inference needs CGO, which loses the single binary.
- Python with Qt: the richest electronics and ML ecosystem, but PyInstaller or Nuitka packaging is
  fragile (antivirus false positives, hidden imports) and no maintained library offers ChatGPT sign-in.

## Consequences
- Packages weigh 150–250 MB because they carry Chromium.
- Camera (`getUserMedia`) and serial (`serialport`) can later work on both platforms without native rewrites.
- The pi ecosystem (pi-ai, pi-agent-core) is usable directly as libraries.
- The BenchPilot proof of concept, built on the same stack, supplies much of the starting code; its
  snapshot is in `09_Others/benchpilot-reference/` (map: `../plan/benchpilot-reuse.md`).
- macOS is technically within reach but needs notarisation; it stays outside 1.0.

## Implementation status (2026-11-01)
- Stack as decided, every version exact (no `^`/`~` in any workspace `package.json`): Electron
  44.7.0, electron-vite 5.0.0, Vitest 5.0.3, Playwright 1.64.0, Tailwind CSS 4.3.3, TypeScript 6.0.3
  (`05_Software/package.json:40-56`); React 19.3.0 (`src/apps/desktop/package.json:20`); Node engine
  `>=24 <25` (`package.json:11`); ESM (`package.json:4`); strict TypeScript (`tsconfig.base.json`).
- npm workspaces `src/libraries/*` and `src/apps/*` (`package.json:6-9`); electron-vite builds main,
  preload, renderer and the worker/indexer entries (`src/apps/desktop/electron.vite.config.ts`).
- Deviation: shadcn/ui is configured (`src/apps/desktop/components.json`) but only one adapted
  primitive exists (`src/renderer/components/ui/card.tsx`) and nothing imports it. The UI is
  hand-written React components styled with Tailwind plus custom CSS (`src/renderer/styles.css`).
- pi-agent-core is not used in production; it stays an experiment-only dev dependency (ADR-0014).
- The 150–250 MB consequence is no longer bounded: ADR-0017 removed the package size check.
- Open: camera and serial support (no `serialport` dependency yet). macOS has no build target, as
  decided (`src/apps/desktop/electron-builder.yml`).
