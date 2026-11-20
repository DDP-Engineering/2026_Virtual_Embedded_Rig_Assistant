# Test layout

This folder holds the checks that use several components, their input data and their
infrastructure. Unit and component tests stay beside the implementation, in `src/apps/` and
`src/libraries/`. The harnesses that produce measurements and scores are in
[`../evaluators/`](../evaluators/README.md).

| Folder | Role |
|---|---|
| `tooling/` | Configuration, build, import rules, translations, the test infrastructure and the evaluation tools. |
| `integration/` | CLI, document processing, workers, retrieval evaluation and the plugin system with test plugins. |
| `plugins/` | One suite per official plugin (`<id>.test.ts`), often with the plugin's real programs. Not part of `npm test`; run with `npm run test:plugins`. |
| `packaging/` | Distribution preparation, the package smoke, the update probe and updates. |
| `e2e/` | Complete flows in Electron and in the browser, run with Playwright. |
| [fixtures/](fixtures/README.md) | Fictional data and input scenarios; they are not test results and hold no evaluation code. |
| `support/` | The E2E runner, the Playwright reporter, the network guard and the generators of the demo and Office documents. Simulated programs and the generators of a single fixture stay beside it, in `fixtures/`. |

`e2e/composer-images.spec.ts` covers composer paste, drop and picker, Files image references, previews, model warnings and format refusal.
`e2e/transcript-images.spec.ts` covers native restart, keyboard and pointer viewer activation, and persisted path labels after deleting an attachment.

`e2e/chat-actions.spec.ts` checks per-reply and block copying, four-language compact keyboard/hover
controls in Chromium, and exact-once multiline execution, terminal creation, destination selection and
focus in sandboxed native Electron. Native coverage also refuses pending input/foreground readers and
checks Cancel/Escape focus with a real modal. Execution uses Bash on Linux and PowerShell on Windows;
`VERA_CHAT_ACTIONS_SHELL=powershell` additionally exercises installed PowerShell on Linux.

Native `e2e/display-masking.spec.ts` verifies conditional Display masking with stored MQTT credentials,
Files/Find UI selection, colliding labels, live settings/workbench choices and restart-safe tabs.

Browser `e2e/i18n-hmr.spec.ts` checks live translation-catalog replacement on mounted tool activity,
preserving the selected language and expanded plan without a page reload.

Plugin acceptance uses `VERA_TEST_PYTHON` when set. On Windows an isolated environment can live at
`02_Tools/runtime/test-python`; create it with `python -m venv`, then install `paho-mqtt==2.1.0`,
`cryptography==49.0.0`, `asyncssh==2.24.1`, `flatbuffers==25.12.19` and `PyYAML==6.0.3` with its pip.
Set `VERA_TEST_PYTHON` to that environment's absolute `Scripts/python.exe` path before running the
plugin suite. The Raspberry Pi SSH fixture additionally uses the default WSL Linux shell on Windows.

Native `e2e/privacy-settings.spec.ts` covers both privacy pages in en/ro/de/fr, unsaved confirmation,
live inherited defaults, new-workbench choices, independent owners and process restart persistence.
Original screenshots/receipts use `evaluation-outputs/mask05/native`.

`e2e/text-encodings.spec.ts` verifies Latin-1/UTF16 BOM decoding, encoding changes,
explicit replacement and measured distant wrapped Find/Go to line in browser and native Electron.
Owned receipts/screenshots and original logs live under `evaluation-outputs/view02`.

`e2e/large-text.spec.ts` uses `support/large-text-fixture.ts` to generate genuine 200 MiB variable-row
logs for browser and native byte scrolling, late Find, exact Go to line, cancellation, heap/pulse
measurements and native live Display refresh. Original evidence lives in `evaluation-outputs/view03`.

`e2e/large-text-citations.spec.ts` proves compact indexed and actual issued large-text citations,
source-range placement, scalar Find counts/wrapping, Escape focus and live Display. The standalone
`support/large-text-source-probe.ts` checks verified revision/date and same-size replacement with
restored exact mtime on pinned Windows/WSL2 Node. Original proof stays in `evaluation-outputs/view03`.

Dictation acceptance sets VERA_DICTATION_MODEL_ROOT to a directory containing the verified
whisper-base and whisper-small installs. Build the desktop to run
integration/whisper-runtime.test.ts against both workers and all four speech fixtures.
Run test:e2e with tests/e2e/dictation.spec.ts for bounded capture, permission and lifecycle
in an instrumented Electron build. Set VERA_DICTATION_PACKAGED_APP to run that spec directly
through Playwright against an unpacked instrumented executable using an isolated nonportable profile.

Native `e2e/browser-agent.spec.ts` drives a text-only replay agent through the Desktop browser tools.
Set `VERA_TEST_BROWSER_ARCHIVE` to the verified archive for the host. The controlled public-origin
fixture covers dynamic reading, citation URLs, tab ownership, denied and stale references, budgets,
Stop and close. Set `VERA_BROWSER_AGENT_EVIDENCE` to keep the JSON receipt.

Native `e2e/browser-controls.spec.ts` exercises the actual Settings and Chat
controls with a replay agent and the pinned Chromium archive. It checks grants,
rendered navigation, isolation across refresh, Stop and native process cleanup.
Set `VERA_BROWSER_PACKAGED_APP` to the unpacked instrumented executable and
`VERA_BROWSER_EVIDENCE` to keep the JSON receipt. Use a fresh disposable
application data location for each run. A Windows portable package stores its
data beside the executable.

## Vitest test inventory

TERM-05 adds `packaging/terminal-runtime.test.ts` for native PTY architecture/helper closure,
and `e2e/terminal.spec.ts` for actual typed input, resize/reflow, per-terminal agent consent,
Linux background-job cleanup on close/workbench replacement/shutdown,
revocation, close/switch cleanup and CSP under native or extracted packaged Electron. Set
`VERA_TERM05_APP` to an explicitly extracted app binary and `VERA_TERM05_EVIDENCE_DIR` to owned
evidence. `VERA_TERM05_SKIP_AGENT=1` limits release-artifact smoke to user terminal behavior.

### Tooling

| File | What it checks |
|---|---|
| [boundaries.test.ts](tooling/boundaries.test.ts) | Module separation through the import rules. |
| [build-mode.test.ts](tooling/build-mode.test.ts) | The identity and the hooks compiled in release and instrumented modes. |
| [delivery.test.ts](tooling/delivery.test.ts) | The version, SHA-256 sums, part replacement and release notes of a delivery. |
| [demo-documents.test.ts](tooling/demo-documents.test.ts) | The fixture PDF generator and the match between the inventory and the files. |
| [help.test.ts](tooling/help.test.ts) | The help page checker: the same pages in four languages and valid links. |
| [help-shortcuts.test.ts](tooling/help-shortcuts.test.ts) | The shortcuts help page, generated from the command registry. |
| [i18n.test.ts](tooling/i18n.test.ts) | The translation catalog checker. |
| [network-guard.test.ts](tooling/network-guard.test.ts) | Blocking of outside connections in the test environment. |
| [plugin-license.test.ts](tooling/plugin-license.test.ts) | The license declared by each official plugin. |
| [release-version.test.ts](tooling/release-version.test.ts) | Version order, `set-version` and the release notes check. |
| [session-performance.test.ts](tooling/session-performance.test.ts) | The fixtures, report and comparison of the performance harness. |
| [session-performance-probe.test.ts](tooling/session-performance-probe.test.ts) | The performance probes compiled into the application. |
| [skeleton.test.ts](tooling/skeleton.test.ts) | Workspaces, the TypeScript configuration and the project commands. |
| [test-discovery.test.ts](tooling/test-discovery.test.ts) | Discovery of test files by the Vitest projects. |
| [test-execution.test.ts](tooling/test-execution.test.ts) | Exact E2E selection, report isolation and desktop build-cache invalidation. |
| [third-party.test.ts](tooling/third-party.test.ts) | The third-party component list: the version and license of each workspace dependency. |

### Integration

`commands.test.ts` runs actual shell acceptance through `support/command-platform-probe.ts`
(foreground output, Unicode quoting, clean environment, closed stdin, readiness and tree cleanup).

| File | What it checks |
|---|---|
| [additional-folders.test.ts](integration/additional-folders.test.ts) | Real file and shell access in a sibling folder, and immediate revocation of the folder. |
| [cli.test.ts](integration/cli.test.ts) | The CLI process, arguments, sessions, approvals, output and resource cleanup. |
| [commands.test.ts](integration/commands.test.ts) | Real shell commands: closed stdin, clean environment and background process trees. |
| [document-cli.test.ts](integration/document-cli.test.ts) | Document indexing and search through the CLI. |
| [document-hosts.test.ts](integration/document-hosts.test.ts) | PDF processing and the local models for desktop and CLI, in the source and the distribution layout. |
| [hil-bypass.test.ts](integration/hil-bypass.test.ts) | The real HIL validation helper on sibling inputs: canonical sources, host exclusions and output ownership. |
| [plugin-builder.test.ts](integration/plugin-builder.test.ts) | The plugin builder: a draft from CLI help, trial review, approved runs and promotion only through the user. |
| [process-hosts.test.ts](integration/process-hosts.test.ts) | The CLI and desktop process hosts: arguments, closed stdin, environment, output limits, timeout and Stop. |
| [provisioning.test.ts](integration/provisioning.test.ts) | Program provisioning: tar archive installs, refusal of links that leave the folder, and the version range probe. |
| [retrieval.test.ts](integration/retrieval.test.ts) | Evaluation of rankings, the fixed questions, FTS and result fusion. |
| [scoped-programs.test.ts](integration/scoped-programs.test.ts) | An approved program run uses its original helper when a new plugin hash is trusted after final verification. |
| [worker-hosts.test.ts](integration/worker-hosts.test.ts) | The desktop and CLI workers, cancellation, time limits and worker replacement. |

### Packaging

| File | What it checks |
|---|---|
| [packaging.test.ts](packaging/packaging.test.ts) | Models and DLLs, the native payload, resources, ASAR and the package limits. |
| [package-smoke.test.ts](packaging/package-smoke.test.ts) | The smoke tools: extraction, identities, network observation and reading of the evidence. |
| [prepare-plugins.test.ts](packaging/prepare-plugins.test.ts) | Building and checking the bundled plugin catalog. |
| [terminal-runtime.test.ts](packaging/terminal-runtime.test.ts) | The staged terminal runtime: its JS closure, the PTY architecture and the native helper hashes. |
| [updates.test.ts](packaging/updates.test.ts) | The update feed configuration and the local server used in the checks. |

## Running

### Execution cost and shared resources

Vitest runs isolated workspace files with at most four workers (bounded by available CPUs).
Isolation and the outbound-network guard remain enabled. The `core-resources` project runs
filesystem-heavy and worker-deadline suites one file at a time after the other workspace tests,
without competing fixture creation. `--project "core*"` selects both core projects. The ingest guard
counts 12,000 real files once; its approval/reindex flow uses a configured 100-file limit with the
same boundary ratios. `knowledge/guard.test.ts` keeps the exact 10,000/12,000/12,500/24,000 boundaries.
`tooling`,
`integration`, `packaging` and `plugins` follow in separate ordered groups, one file at a time;
groups cannot overlap shared CLI/build outputs. `--maxWorkers` overrides the workspace limit for profiling.
`support/cli-bundle-setup.ts` compiles the CLI and its real workers once per integration run;
CLI consumers copy that bundle before changing their own fixtures.

`e2e/fixtures.ts` provides one mock renderer server per Playwright worker, with available ports
and separate optimizer directories. Browser contexts and their localStorage remain per-test.
Tests using this fixture carry `@parallel-browser`. Device/network servers and native app profiles
keep their existing ownership; performance, focus and native tests remain in the serial group.

`support/test-e2e.mjs` first collects the requested tests without executing them, then runs the
tagged browser group with two workers and the remaining group with one, in that order. It uses exact
Playwright test lists to retain nested/parameterized selection. No matching tests is an error.
Explicit browser `--workers` is respected. Stateful/interactive Playwright options (sharding,
last-failed, only-changed, UI/debug and user test lists), custom configurations and machine/HTML
reporters use one unchanged Playwright execution so selection state and reports are not split or overwritten.

```powershell
python ../02_Tools/environment/npmw.py npm run test:e2e -- --browser-only bookmarks.spec.ts privacy-settings.spec.ts --grep browser
python ../02_Tools/environment/npmw.py npm run test:e2e -- --serial-only image-preview.spec.ts --grep native
```

Browser-only selections skip the Electron build. Native selections use `support/test-build.mjs`:
reuse requires identical source/configuration/help/release/toolchain inputs, build environment and
output bytes. A source/flag change, missing file or edited output rebuilds automatically. Changing
inputs while building fails rather than certifying a mixed candidate. Records live in
`node_modules/.cache/test-builds`; no unchecked skip-build option is supplied. This only avoids
duplicate local compilation; native/delivery tests still exercise their real runtime.
Listing/help do not build. Direct `npx playwright test` remains a single serial invocation and
requires the caller to prepare the appropriate native build. Avoid running a desktop build or
development instance against the same output directory during native acceptance.

`tooling/test-execution.test.ts` checks exact test partitioning and build invalidation. Original
focused profiling receipts for this change are retained in `evaluation-outputs/test-suite-speed/`;
they measure a selected batch, not the complete suite. Full milestone verification remains governed
by `02_Tools/verification-policy.md`.

From `05_Software`, select one of the Vitest projects in `tests/` that `npm test` runs (the fourth,
`plugins`, has its own command below):

```powershell
python ../02_Tools/environment/npmw.py npm test -- --project tooling
python ../02_Tools/environment/npmw.py npm test -- --project integration
python ../02_Tools/environment/npmw.py npm test -- --project packaging
```

The official plugins have their own suite, outside `npm test` and `npm run verify`:

```powershell
python ../02_Tools/environment/npmw.py npm run test:plugins
python ../02_Tools/environment/npmw.py npx vitest run tests/plugins/kicad.test.ts
```

Run it when a plugin or the plugin system changes and before a delivery; `npm run verify:all`
runs `verify` and then the plugin suite.


The MQTT and Raspberry Pi suites need Python 3.11+ with `paho-mqtt==2.1.0`, `asyncssh==2.24.1`
and `cryptography==49.0.0`. Install these in an owned test virtual environment and set `VERA_TEST_PYTHON`
to its Python executable; the suites otherwise use `python` on Windows or `python3` on Linux.
For example, from `05_Software` in PowerShell:

```powershell
python -m venv evaluation-outputs/plugin-test-python
./evaluation-outputs/plugin-test-python/Scripts/python.exe -m pip install paho-mqtt==2.1.0 asyncssh==2.24.1 cryptography==49.0.0
$env:VERA_TEST_PYTHON = (Resolve-Path evaluation-outputs/plugin-test-python/Scripts/python.exe).Path
python ../02_Tools/environment/npmw.py npm run test:plugins
```

These match the helpers' declared dependency pins. Retain `pip freeze` with run evidence when recording a milestone.
MQTT uses a local fixture broker; Raspberry Pi SSH tests use the local Linux shell, or the default
WSL distribution on Windows. This is protocol/kernel evidence, not physical Raspberry Pi evidence.

For a single file:

```powershell
python ../02_Tools/environment/npmw.py npx vitest run tests/integration/document-cli.test.ts
```

`vitest.config.ts` and the workspace configurations register the same network isolation rules
through `support/network-setup.ts` and `support/network-guard.ts`.

By default the results are printed in the terminal. Coverage reports need the explicit command
`npm run test:coverage`. The policy for choosing checks is in
[02_Tools/verification-policy.md](../../02_Tools/verification-policy.md).

## E2E

`npm run test:e2e` invokes [support/test-e2e.mjs](support/test-e2e.mjs): it prepares or reuses
the desktop build for serial selections, then launches Playwright with `playwright.config.ts`;
Linux uses `xvfb-run -a`. Group flags are handled by the runner; other arguments reach Playwright:

```powershell
python ../02_Tools/environment/npmw.py npm run test:e2e -- tests/e2e/workbench.spec.ts
```

Tests that use instrumentation hooks need a build made with `VERA_TEST=1`. The runner sets
`VERA_TEST=1` unless the variable is already set.

The E2E build rewrites `src/apps/desktop/out`, which development also uses. Close the development
instance before these tests: modules that an open process has not loaded yet can end up using
files from another build. After the tests, for manual checking, restart `npm run dev` with
`VERA_TEST=0`, so that the process and all its modules come from the same build.

The E2E output is a temporary system folder. The reporter
[support/cleanup-e2e-output.mjs](support/cleanup-e2e-output.mjs) removes it at the end, also after
failures. The configuration turns off automatic traces, videos and screenshots. Replacing the
reporters from the CLI can bypass the cleanup reporter.

Right-panel visibility coverage:
- `e2e/right-panel-tabs-ui.spec.ts`: browser Save/Cancel, defaults, filtered keyboard navigation,
  workbench isolation and all-hidden settings recovery.
- `e2e/right-panel-tabs.spec.ts`: sandboxed Electron persistence across restart, session consistency,
  workbench switching and a foreground terminal program surviving hidden selectors.
- `e2e/terminal-replay.spec.ts`: real host PTYs with browser xterm, including continued output while
  Terminal and Runs selectors are hidden and restoration without losing terminals.

## Support

| File | What it does | How it is used / result |
|---|---|---|
| [test-e2e.mjs](support/test-e2e.mjs) | Builds the desktop and starts Playwright. | `npm run test:e2e`; see [E2E](#e2e). |
| [cleanup-e2e-output.mjs](support/cleanup-e2e-output.mjs) | Playwright reporter that deletes the run's temporary folder after the final metadata is written. | Loaded by `playwright.config.ts`; not run directly. |
| [dev-test-server.mjs](support/dev-test-server.mjs) | Builds main and preload in development mode and starts the Vite server, without an extra Electron instance. | Used by the HMR test in `e2e/shell.spec.ts`, with `--prepare` or `--serve` and an isolated `VERA_BUILD_ROOT`. Prints `VERA_DEV_READY`. |
| [network-setup.ts](support/network-setup.ts), [network-guard.ts](support/network-guard.ts) | Block non-loopback connections in the Vitest tests and report the attempts. | `setupFiles` in the Vitest configurations. |
| [make-demo-pdfs.mjs](support/make-demo-pdfs.mjs) | Generates the three fictional PDFs reproducibly from the demo's Markdown. | `npm run make:demo-pdfs`; reads `fixtures/workbenches/demo-board/sources/` and rewrites the PDFs in `fixtures/workbenches/demo-board/docs/`. |
| [make-office-fixtures.mjs](support/make-office-fixtures.mjs) | Generates the Office documents in `fixtures/documents/office/` deterministically. | `node tests/support/make-office-fixtures.mjs`. |

The fictional PDFs and Office documents are versioned test data. Generating them can change files
tracked by Git.

The renderer server for the browser E2E specs is the development command
[`02_Tools/environment/dev-renderer.mjs`](../../02_Tools/environment/dev-renderer.mjs).
The simulated interface bridge stays in `src/apps/desktop/src/renderer/mocks/`: it is selected at
build time with `VITE_API=mock` and removed from normal builds, and moving it under `tests/` would
make the product source import test code.

## Packaging

The package smoke and the update probe check real artifacts. They differ from the ordinary E2E
tests: they keep reports and logs in the folders chosen for diagnosis, or in temporary folders.

| File | What it does | How it is used / result |
|---|---|---|
| [smoke-package.mjs](packaging/smoke/smoke-package.mjs) | Checks a release artifact that is already built: extraction or installation, start, indexing, PDF, tools, approval and persistence after restart, with a local simulated provider for the scripted flow. | `npm run smoke:package -- --artifact <path>`; optional `--scratch <new-directory>`, `--resume <failed-run>`, `--upgrade-proof <report>` (repeatable) and `--windows-evidence <json>`. Does not build. Keeps `smoke-report.json`, extractions, isolated profiles and logs. Can run the NSIS installer when no VERA installation exists yet. |
| [smoke-calibration.mjs](packaging/smoke/smoke-calibration.mjs) | Calibrates, on Linux, the observation of an instrumented renderer's connections, deliberately using an endpoint that the network oracle must detect. | `node tests/packaging/smoke/smoke-calibration.mjs <built-test-app-directory> <new-scratch>`; needs a separate build with `VERA_TEST=1`, a local Electron and `strace`. Writes `calibration-report.json`; it does not validate a release. |
| [smoke-runtime.mjs](packaging/smoke/smoke-runtime.mjs) | Extracts artifacts, prepares profiles and demo copies, starts and stops the application and collects execution identities and logs. | Internal module of the smoke and the calibration; includes the external Linux observation with `strace`. |
| [smoke-server.mjs](packaging/smoke/smoke-server.mjs) | Local HTTP/SSE provider and checks of the request and context budgets for the scripted flow. | Internal module, no CLI of its own. |
| [smoke-egress.mjs](packaging/smoke/smoke-egress.mjs) | Analyses the network traces, failed attempts included, and checks the destinations against the exact allowed ones. | Internal module; also provides the rule for the allowed loopback endpoint. |
| [smoke-report.mjs](packaging/smoke/smoke-report.mjs) | Parses the arguments, computes hashes and combines the functional and network states with the additional evidence. | Internal module; reads the Windows evidence and the update probe report (`--upgrade-proof`), classified as additional instrumented evidence for WP31. |
| [probe-upgrade.mjs](packaging/probe-upgrade.mjs) | Builds instrumented builds and checks the update: the managed build (deb) gets metadata only, SHA-512 is required and a corrupted hash is refused, installation waits for the approval to finish and then really installs, and the portable build gets a release link. | `node tests/packaging/probe-upgrade.mjs <owned-scratch>`; `--reuse` reuses the existing report under the conditions the script checks. Keeps `upgrade-report.json`, builds and logs. |

The exit codes of `smoke-package.mjs` are: `0` = complete PASS, `1` = failure, `2` = functional
flow passed with the platform's network evidence still pending. The full procedure is in
[release-package-smoke.md](../../06_SoftwareDocu/release-package-smoke.md).

`probe-upgrade.mjs` is a historical harness with base versions and commits fixed in its code, not
a general test to run after every change. It needs those Git revisions, the platform tools and a
work folder of its own; it can run installers and uninstallers for its test identities. Its build
inputs include `05_Software` and the tools in `02_Tools/{environment,build,release}`. The probe
does not check data migration, nor that settings, history or recovery survive an update; data
safety on upgrade is deferred until the first public release.

The launchers of the release environments (offline Linux VM, offline Windows and Windows Sandbox)
are in [02_Tools/release](../../02_Tools/README.md#release).

`e2e/bookmarks.spec.ts` covers message/preview bookmark controls in four browser languages and native restart/archive guards.

`e2e/bookmark-navigation.spec.ts` covers sparse/grouped marker styling, three marks in long sessions, browser renderer restart against a retained mock backend, native process restart and next/previous navigation with localized Settings entries in en/ro/de/fr.

Bypass acceptance (`e2e/bypass.spec.ts`) covers per-change confirmation/cancellation in all four languages and native application-data refusal for actual read/write calls, alongside ordinary outside-file edits and restart. The configured CLI application-data boundary is exercised in `integration/cli.test.ts`; immediate irreversible-plugin approval behavior remains in `e2e/program-approvals.spec.ts`.

Confined agent-input application-data exclusions also have shared core coverage in `src/libraries/core/src/tools/app-data-inputs.test.ts`, with candidate/apply, program/runner and HIL regressions beside those implementations.

`e2e/program-bypass.spec.ts` uses two owned sibling Git repositories and the local echo-tools fixture to verify Bypass edits, real outside cwd execution, absolute JSON/Markdown export paths, workbench-owned logs, and background revocation after turn completion. `VERA_BYP01_EVIDENCE_DIR` retains exports, native snapshot and original logs. `core/src/plugins/program-bypass.test.ts` adds mode, argument-hash, alias and exclusion boundaries; `core/src/sessions/programs.test.ts` checks the durable session revocation signal.

`integration/hil-bypass.test.ts` runs real standard-library HIL/lab-validation helpers on owned sibling inputs, checking canonical requests, host input policy exclusions and workbench-only output without instruments or external accounts.

`e2e/command-prefixes.spec.ts` covers native command approval, format1 persistence/restart, Auto-edit/Ask and destructive refusal, immediate removal including credential-masked grants and unrelated-save preservation, plus four-language browser editor Save/Cancel. Native receipts use VERA_TERM02_EVIDENCE_DIR.

`e2e/additional-folders.spec.ts` proves native General chooser Save/Cancel, sibling Ask read/command,
unlisted/protected refusal, restart, pending-request revocation, masked unrelated save/removal and
four-locale browser controls. VERA_TERM03_EVIDENCE_DIR retains native proof. Core
`tools/additional-folders.test.ts` covers ordinary file operations, worker revocation and protected aliases.

`integration/additional-folders.test.ts` runs `support/additional-folder-platform-probe.ts` against real files and shell processes; the same probe bundles for pinned WSL2 Node without a second dependency tree.

`e2e/command-runs.spec.ts` proves real sibling server readiness, live masked command/folder/output, Runs Stop of the whole tree, next agent output stopped, full viewer logs, exit code/duration and session isolation. Original receipts use `VERA_TERM04_EVIDENCE_DIR`.

`support/command-runs-platform-probe.ts` bundles current source for pinned Linux Node: real sibling command server, scoped run identity, short-read-safe full/tail logs, Stop and next agent output.

`e2e/run-masking.spec.ts` proves native stored MQTT credentials in actual command output, run arguments/canonical cwd, provisioning statuses, tail/full logs and terminal snapshots with live app/workbench overrides and two-workbench isolation. Original receipts/logs use evaluation-outputs/mask03; no delivery artifacts are rebuilt.

`e2e/agent-masking.spec.ts` proves stored MQTT credential masking with live independent agent/exports choices, snapshot/detail/search, native JSON/Markdown and artifact exports, and irreversible saved redaction. Original logs/receipt use evaluation-outputs/mask04. Focused CLI process cases share the same contracts without external providers.

`e2e/hex-viewer.spec.ts` exercises native Hex border Find, partial rows/nonprintables, bounded DOM,
keyboard selection, actual clipboard and live stored-credential Display masking in four locales.
Original logs/screenshots/receipt stay in `evaluation-outputs/view04`.

`e2e/viewer-modes.spec.ts` checks automatic binary/unknown Hex, explicit replacement Text,
Markdown Rendered/Text/Hex and remembered real-extension mode in browser and native Electron.
Native acceptance uses two Markdown files, an opaque secret-named source and a full process restart.
Original logs, screenshots and receipts remain under ignored `evaluation-outputs/view05`.

`e2e/image-preview.spec.ts` checks all six unindexed image formats, Hex for each, inert scripted SVG,
fit/resize/400%/zoom-back geometry, original resource identity, live Display and corrupt-image Retry
in browser and Windows Electron. `support/image-preview-fixtures.ts` generates the fixtures.
Original logs/screenshots/receipts live in ignored `evaluation-outputs/view06`.

`e2e/terminal-replay.spec.ts` couples the real TerminalService/node-pty backend to the real xterm
surface through a local test bridge. It checks shell protocol queries, tab reselection and renderer
reload without submitting commands through the user's terminal. Historical queries must not send
replies again; a new query must still receive its reply. Evidence stays in
`evaluation-outputs/terminal-input-fix/`.
