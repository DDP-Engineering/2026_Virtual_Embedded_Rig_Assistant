# 08 — Quality: commands, tests, fixtures

This document describes the implementation as of 2026-11-01 (branch `master`, 33e72b8 plus the
working tree). Items marked "Not implemented as of 2026-11-01" are still planned.

PURPOSE: specify the commands, test layers and fixtures every work package reuses, and the rules
tests follow.
DONE-WHEN: per ticket, lint, typecheck and `check:i18n` pass together with the smallest sufficient
focused tests. At each milestone gate (M2/WP-21, M3/WP-29, M4/WP-33, M5/WP-38) `npm run verify`, the
complete Electron and browser E2E suite and the applicable CLI regressions pass on Windows and native
Ubuntu (`02_Tools/verification-policy.md`, user policy of 2026-10-12).

## 1. Commands

Run from `05_Software/`, after `python 02_Tools/setup.py` (repository root) has installed the pinned
Node.js (engine `>=24 <25`) and the npm packages. Without Node on the PATH, prefix a command with
`python ../02_Tools/npmw.py`. AEGIS runs `lint`, `typecheck`, `check:i18n` and `npm test` through
that wrapper (`.agentic/aegis.toml`); `aegis check --run` runs lint, typecheck and i18n.

| Command | Does |
|---|---|
| `npm run lint` | `biome check .`: lint, format check, import order and the import boundaries of 01 §4 (`noRestrictedImports` per workspace) |
| `npm run format` | `biome check --write .`: apply formatting and safe fixes |
| `npm run typecheck` | `tsc -b` over the solution `tsconfig.json` (references: tools, shared, core, desktop, cli) |
| `npm test` | `vitest run`: workspace projects `shared`, `core`, `desktop`, `cli` plus root projects `tooling`, `integration`, `packaging`; `-- --project <name>` selects one |
| `npm run test:coverage` | the same with V8 coverage into `coverage/`, for information only |
| `npm run verify` | lint, typecheck, `check:i18n`, test, in that order |
| `npm run check:i18n` | the en/ro/de catalogs against the keys the renderer uses: missing, unused and translation-only keys (06 §6) |
| `npm run test:e2e` | `electron-vite build`, then Playwright over `tests/e2e/` (extra arguments pass through); Linux wraps it in `xvfb-run -a`. Specs that use test switches need the build made with `VERA_TEST=1` in the environment; the script does not set it |
| `npm run dev`, `dev:renderer`, `build` | electron-vite watch launch; the renderer alone on Vite (`VITE_API=mock` for the mock bridge); a build into `src/apps/desktop/out/` |
| `npm run smoke:live -- --provider <openai\|custom:slug> [--data <dir>]` | builds a release-mode app (`VERA_TEST=0`) and runs the provider connection test through `--vera-smoke-provider`; exit 0 when every step passes. Real provider, by hand only |
| `npm run build:cli` | esbuild bundle of the CLI and its grep, PDF and embedding workers into `src/apps/cli/dist/` |
| `npm run vera -- run\|index\|search …` | builds the CLI, then runs the headless core: `run --workbench <dir> --prompt <text>` with `--provider replay --script <file>`, `openai` or `custom` prints events as jsonl or pretty; `index` and `search` drive the document index |
| `npm run eval:retrieval [-- --output <file>]` | recall over `tests/fixtures/retrieval/demo-board.yaml` with the bundled model; passes at hybrid recall@5 ≥ 0.85 overall, ≥ 0.95 English, ≥ 0.75 Romanian (05 §8) |
| `npm run prepare:model [-- --offline]` | download or verify the pinned embedding model (07 §1) |
| `npm run prepare:windows-runtime` | Windows only: prepare the pinned VC++ DLLs (07 §1) |
| `npm run make:demo-pdfs` | regenerate the three demo PDFs from their Markdown sources |
| `npm run package` | build release packages with test switches compiled out (07 §1, §2) |
| `npm run package:test` | build separately labelled instrumented packages ("VERA Test"), for debugging only |
| `npm run smoke:package -- --artifact <path> [--scratch <new dir>] [--resume <failed run>] [--upgrade-proof <report>]… [--windows-evidence <json>]` | verify an already-built release package (§5) |

Scripts without an npm command: `node scripts/probe-upgrade.mjs <scratch> [--migration-safety]`
(instrumented upgrade probe, 07 §6); `node scripts/smoke-calibration.mjs <built app> <new root>` (egress
negative control, §5); `scripts/probe-windows-sandbox.ps1` with `probe-windows-offline.ps1`, and
`scripts/probe-linux-offline.sh` (offline `--packaging-probe` runs of an instrumented zip or AppImage
in Windows Sandbox or a VM with its adapters down).

## 2. Test layers

| Layer | Where | Covers |
|---|---|---|
| Unit and service | `src/libraries/{shared,core}/src/**/*.test.ts`; `src/apps/desktop/src/{main,preload}/**/*.test.ts`; `src/apps/cli/src/**/*.test.ts` | path guard, tools, context budgets, chunkers, refs, reducer, settings migrations, scrubber, prompt snapshot, updater, credentials, IPC router |
| Core integration | `src/libraries/core/src/sessions/*.test.ts`, `storage/session-recovery.test.ts`, `knowledge/*.test.ts` (there is no `src/libraries/core/test/`) | replay sessions: bounded first turns, approvals, concurrent edits, restart recovery, citations |
| Renderer components | `src/apps/desktop/src/renderer/**/*.test.ts` | per-file `@vitest-environment jsdom`, React `createRoot` and `@testing-library/user-event` over the mock API (`mocks/mockApi.ts`, 06 §8) |
| Root Vitest projects | `tests/tooling/`, `tests/integration/`, `tests/packaging/` | import boundaries, build modes, demo documents, i18n checker, network guard, workspace skeleton; CLI process, document CLI and hosts, retrieval, worker hosts; payload checks, smoke tooling, update feed configuration and server |
| End-to-end | `tests/e2e/*.spec.ts` | Playwright `_electron.launch` of the electron-vite build with the development Electron binary, a temporary `--user-data-dir` and workbenches created or copied in temporary folders; browser specs run the mock renderer (`dev:renderer`, `VITE_API=mock`) in Chromium at 127.0.0.1:5173. One worker, serial |
| Release package smoke | `scripts/smoke-package.mjs` with `smoke-runtime`, `smoke-server`, `smoke-egress`, `smoke-report` | the release artifact itself: offline indexing, scripted loopback session, egress check (§5) |
| Retrieval evaluation | `scripts/eval-retrieval.mjs`, `scripts/retrieval/`, `tests/fixtures/retrieval/` | recall@5 thresholds (05 §8) |

## 3. Fixtures and test switches

- `tests/fixtures/workbenches/demo-board/`: a fictional board, "VERA-DEMO-01", with `.vera/workbench.yaml`,
  `.vera/WORKBENCH.md`, `board.txt`, `docs/notes/bringup.md`, `docs/pinout.csv`, `logs/boot-0412.log` and
  three PDFs (`docs/vera-demo-01-{datasheet,reference-manual,application-note}.pdf`) generated from
  `sources/*.md` by `scripts/make-demo-pdfs.mjs`. `demo-board.json` records its identity and complete
  file inventory, checked by `tests/tooling/demo-documents.test.ts`. Tests copy it to a temporary
  folder and never change it in place.
- Workbench E2E (WP-06) covers native create, restart and recents, removal of deleted folders and
  read-only opening under a live foreign lock, plus browser checks of pinned focus, full text and mock
  states. `tests/tooling/build-mode.test.ts` executes the emitted code of both build modes, including
  the picker override. E2E runs serially because Vite owns port 5173.
- Other fixtures: `documents/` (text and scanned PDF, HTML, Markdown, office samples),
  `i18n/missing-key.json`, `retrieval/` (questions and bge/e5 model manifests), `settings/version-0…3.json`
  (migration to `schemaVersion` 4 keeping installation id and preferences), `upgrade/` (credentials v1
  and newer, workbench v1 and newer, interrupted session).
- `tests/fixtures/llm-scripts/<scenario>.jsonl`: replay scripts, one per scenario (14 on 2026-11-01).
  The format follows `09_Others/benchpilot-reference/apps/server/src/llm/replay.ts`; VERA's provider is
  `src/libraries/core/src/llm/replay.ts`. One line per model step; empty lines and `//` lines are
  skipped:

```jsonl
{"match":"(?i)read.*board","toolCalls":[{"name":"list","args":{}}]}
{"toolCalls":[{"name":"read","args":{"path":"board.txt","offset":1,"limit":2}}]}
{"text":"The board uses 3.3 V [[{{ref}}]]."}
```

  A step holds `text`, `toolCalls` and an optional `usage` `{input, output}`. Model `replay/<scenario>`
  selects a script by file name; `replay/auto` selects the first script whose `match` (first line, a
  regex with optional leading `(?i)` flags) fits the latest user message. A `prompt` field is accepted
  but unused: `vera run` takes `--prompt`, and `--script <file>` loads one script as `replay/script`.
  Text and arguments may hold `{{key}}` placeholders resolved from string fields of earlier JSON tool
  results, such as `{{ref}}` or `{{artifact:<name>}}`. The step is the number of assistant messages
  since the last user message, so the provider is stateless. Replay models report a 32768-token context,
  up to 4096 output tokens and a 1639-token safety margin.
- For release-package agent tests, a harness-owned HTTP server (`scripts/smoke-server.mjs`) binds an
  ephemeral 127.0.0.1 port and serves `/v1/models` and scripted OpenAI-compatible streaming completions
  and tool calls. The release app connects through its normal custom-provider settings (context 32768,
  output 4096). The scenario is its own (read, an approved write, a cited answer), not a replay script;
  it checks the request budget (`max_completion_tokens` 4096, serialized request ≤ 27033 bytes) and the
  session's usage budget. No real model, API key or test-only app hook is needed.
- Test switches exist only in builds made with `VERA_TEST=1` (`__VERA_TEST__`); release builds do not
  contain them:
  - `VERA_REPLAY_DIR=<dir>` registers the replay provider over the scripts in that folder and makes
    `replay/<first script>` the fallback model; `VERA_REPLAY_DELAY_MS` (0–1000) slows the stream;
  - `VERA_TEST_DIALOG_PATH=<path>` answers the next folder or save dialog with that path, because
    Playwright cannot drive native dialogs;
  - `VERA_TEST_ALLOW_WRITES=1` grants every write permission; `VERA_TEST_CHATGPT=1|startup` scripts the
    ChatGPT sign-in; `--packaging-probe=<file>` runs the packaged SQLite and embedding probe;
    `veraTestFileTools` and `veraTestIndexerPid` are main-process probes for E2E;
  - `VERA_NETWORK_AUDIT=1`: not implemented as of 2026-11-01; the name is only checked as a marker that
    release builds must not contain.
- Release artifacts omit these switches; `package` and `smoke:package` check that the markers are
  absent. `--vera-smoke-provider=<id>` is not a test switch: every build accepts it (`smoke:live`).

## 4. Rules for tests

- No outbound network: the Vitest projects `core`, `desktop`, `cli`, `tooling`, `integration` and
  `packaging` load `tests/network-setup.ts`, which wraps `fetch` and `net.Socket.connect` and fails the
  test after any non-loopback attempt (L6, L11). The `shared` workspace has no Vitest config and runs
  without it. E2E specs install `tests/e2e/network-guard.ts` in the main process (request cancelling
  plus the socket guard) and assert that no outbound attempt was recorded. Local mock HTTP servers on
  loopback are allowed.
- Time comes through the `Clock` port (`now`, `sleep`). Not implemented as of 2026-11-01: an ID factory;
  core creates IDs with `ulid()` directly (`ses_`, `art_`, `apv_`).
- Each test that touches the file system works in its own temporary directory.
- UI assertions use roles and `data-i18n` translation keys; many E2E and smoke checks also match English
  accessible names (for example "Approve", "Docs").
- Screenshots are never compared pixel by pixel (fonts differ between operating systems). E2E writes
  them into the run's temporary Playwright output folder, which `scripts/cleanup-e2e-output.mjs`
  deletes at exit, so they are not kept by default; `smoke:package` keeps its screenshots in its root.
- Some authored tests are marked "execution deferred by user" (for example
  `core/src/agent/compaction.test.ts`, `core/src/sessions/export.test.ts`,
  `tests/e2e/session-search.spec.ts`); a pass is not established for them.

## 5. Release-package smoke and egress check

`smoke:package` runs an already-built release artifact — never a `VERA_TEST=1` build: it requires the
package name `vera`, no test markers in `out/main/index.js`, `testBuild` false and a packaged app. It
never builds. Every launch gets its own environment (APPDATA, LOCALAPPDATA, XDG folders, HOME, TMP;
`VERA_*` variables removed) and `--user-data-dir` in the smoke root (the zip uses its adjacent `data/`),
with seeded settings that keep updates Off, and checks Electron 44.7.0, the sandbox, disabled spell-check
and disabled ONNX Runtime telemetry. The Windows zip is extracted with electron-builder's cached 7-Zip;
the NSIS installer is installed silently per-user, or, when a VERA installation already exists, its
payload is extracted and the installation recorded as pending; the AppImage is extracted with
`--appimage-extract` and the deb with `dpkg-deb -x`. `smoke-report.json` names the artifact path, size
and SHA-256 (rechecked after the run), the version, the format, the OS, the executable and ASAR hashes
and each launch's and run's result. Exit codes: 0 pass, 1 failure, 2 functional pass with egress proof
pending. `--resume` reuses the extraction of a failed run of the same artifact.

| Run | Allowed traffic | Required result |
|---|---|---|
| Offline | none | extract or install into `Release é` (a space and a non-ASCII character); start; the copied demo (`Demo board é`) indexes with no failed document; a local embedding search returns results; a PDF opens and renders a painted canvas. A restart keeps the index and an SQLite session |
| Scripted session | the test server's exact 127.0.0.1 port | an ask-mode session through the normal custom provider: `read`, an approved `write` of `notes/smoke-approved.md`, an answer citing `board.txt#L1-L2`, exactly 3 provider requests within budget. After a restart the session snapshot is identical and no request is sent |
| Upgrade | not run by the smoke | `--upgrade-proof <upgrade-report.json>` attaches the instrumented WP-31/32 reports of `probe-upgrade.mjs` (07 §6) as supplementary evidence; the release upgrade status stays "pending". Not implemented as of 2026-11-01: an upgrade run on release artifacts |

- Egress on Ubuntu, automated: every launch runs under
  `strace -f -s 4096 -v -e trace=connect,sendto,sendmsg`, which records the network calls of every
  process in the app's tree, Chromium's network process and workers included. An `inet` or `inet6`
  destination outside the run's list fails the smoke, failed connection attempts included; Unix sockets
  (display, D-Bus) are ignored; truncated, unparsed or unfinished calls and a trace without any network
  call also fail. Negative control: `node scripts/smoke-calibration.mjs` (Linux, an instrumented build
  from `VERA_TEST=1 npm run build`) opens a sandboxed fixture window that fetches a forbidden loopback
  port; the same check must report FAIL. It is kept separate from release evidence.
- Egress on Windows, manual: the offline run in Windows Sandbox (`scripts/sandbox/VERA.wsb`, networking
  disabled) with a `pktmon` capture, following `06_SoftwareDocu/release-package-smoke.md`. The result
  enters the report through `--windows-evidence <json>`, bound to the artifact SHA-256 and the capture
  hash. As of 2026-11-01 this run, including VC++ self-containment on a clean machine, is deferred by
  the user until the final release, so Windows egress stays "pending".
- M5 repeats the smoke on the final 1.0 artifacts.

NOTES:
- Coverage percentage is not a target; each work package's "Done when" list is.
- Work packages cite this file as `08 §n`.
