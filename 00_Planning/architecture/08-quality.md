# 08 — Quality: commands, tests, fixtures

PURPOSE: specify the commands, test layers and fixtures every work package reuses, and the rules
tests follow.
DONE-WHEN: the commands of §1 pass on Windows and Ubuntu at the end of every work package.

## 1. Commands

Run from `05_Software/`.

| Command | Does | From |
|---|---|---|
| `npm run typecheck` | TypeScript across all workspaces | WP-01 |
| `npm test` | Vitest: shared, core, renderer components | WP-01 |
| `npm run test:e2e` | Playwright against the built Electron app with the replay provider | WP-01 |
| `npm run check:boundaries` | import rules of 01 §4 | WP-02 |
| `npm run check:i18n` | catalog completeness (06 §6) | WP-04 |
| `npm run verify` | typecheck, tests and both checks | WP-01, extended by WP-02 and WP-04 |
| `npm run smoke:live -- --provider <id>` | real-provider check, by hand only | WP-09 |
| `npm run vera -- run …` | the headless core: run a prompt on a workbench, print events | WP-15 |
| `npm run eval:retrieval` | retrieval recall (05 §8) | WP-26 |
| `npm run package` | build release packages with test switches compiled out | WP-30 |
| `npm run package:test` | build separately labelled instrumented packages, for debugging only | WP-30 |
| `npm run smoke:package -- --artifact <path>` | verify an already-built release package: offline run, scripted session, egress check (§5) | WP-33 |

## 2. Test layers

| Layer | Where | Covers |
|---|---|---|
| Unit | `packages/*/src/**/*.test.ts` | path guard, tools, context budgets, chunkers, refs, reducer, migrations, scrubber, prompt snapshot |
| Core integration | `packages/core/test/` | replay sessions: bounded first turns, approvals, concurrent edits, restart recovery, citations |
| Renderer components | `apps/desktop/src/renderer/**/*.test.tsx` | Testing Library on the mock bridge (06 §8) |
| End-to-end | `e2e/` | Playwright `_electron.launch` with a temporary `<userData>` and a copy of the demo workbench |
| Release package smoke | `scripts/smoke-package.mjs` | the release artifact itself: offline indexing, scripted loopback session, egress check (§5) |
| Retrieval evaluation | `fixtures/retrieval/` | recall@5 thresholds (05 §8) |

## 3. Fixtures and test switches

- `fixtures/workbenches/demo-board/`: a fictional board, "VERA-DEMO-01", with `workbench.yaml`,
  `WORKBENCH.md`, Markdown notes, a boot log, a CSV pinout and, from M3, PDFs generated from Markdown
  sources by `scripts/make-demo-pdfs.mjs`. Tests copy it to a temporary folder and never change it in place.
- `fixtures/llm-scripts/<scenario>.jsonl`: replay scripts, one per scenario, in the format of
  `09_Others/benchpilot-reference/apps/server/src/llm/replay.ts` — one line per model step:

```jsonl
{"match": "(?i)pinout|SDA", "prompt": "On which pin is SDA?", "toolCalls": [{"name": "grep", "args": {"pattern": "SDA", "path": "docs"}}]}
{"toolCalls": [{"name": "read", "args": {"path": "docs/pinout.csv"}}]}
{"text": "SDA is on PB7 [[docs/pinout.csv#L8-L8]]."}
```

  `match` (first line) selects the script from the user's message; `prompt` (first line, optional) is
  what `vera run` sends. Text and arguments may hold placeholders resolved from earlier tool results,
  such as `{{artifact:<name>}}`. The step is derived from the transcript, so the provider is stateless.
- For release-package agent tests, a harness-owned HTTP server binds an ephemeral loopback port and
  serves scripted OpenAI-compatible streaming completions and tool calls. The release app connects
  through its normal custom-provider settings. Fixtures use the same scenarios and assertions as
  replay tests, including request-budget checks; no real model, API key or test-only app hook is needed.
- Test switches exist only in builds made with `VERA_TEST=1`; release builds do not contain them:
  - `VERA_REPLAY_DIR=<dir>` registers the replay provider over the scripts in that folder and selects it;
  - `VERA_TEST_DIALOG_PATH=<path>` answers the next folder or save dialog with that path, because
    Playwright cannot drive native dialogs;
  - `VERA_NETWORK_AUDIT=1` logs the main process's connections, for debugging only; it is not
    release evidence (§5).
- Release artifacts omit these switches; their environment variables have no effect there.

## 4. Rules for tests

- No outbound network: core and e2e tests run with a guard that fails on any non-loopback
  connection (L6, L11). Local mock HTTP servers on loopback are allowed.
- Time and IDs come through the `Clock` port and an ID factory, so snapshots are stable.
- Each test that touches the file system works in its own temporary directory.
- UI assertions use roles and translation keys, not English text, except in i18n tests.
- Screenshots are saved for human review, never compared pixel by pixel (fonts differ between
  operating systems).

## 5. Release-package smoke and egress check

`smoke:package` runs an already-built release artifact — never a `VERA_TEST=1` build — with
temporary user data, updates Off and a copy of the demo workbench. Its report names the artifact
SHA-256, the version, the OS and each run's result.

| Run | Allowed traffic | Required result |
|---|---|---|
| Offline | none | install or extract into a path with a space and a non-ASCII character; start; native modules and the model load; the demo documents index and open |
| Scripted session | the test server's loopback endpoint only | a session through the normal custom provider streams tool calls and a cited answer; an approval and a restart work |
| Upgrade | the local test feed only | vN updates to vN+1 with settings and sessions intact (WP-31, WP-32) |

- Egress on Ubuntu, automated: the smoke runs the app under `strace -f -e trace=connect,sendto,sendmsg`,
  which records the network calls of every process in the app's tree, Chromium's network process
  and workers included. An `inet` or `inet6` destination outside the run's list fails the smoke;
  Unix sockets (display, D-Bus) are ignored. A test build that makes one deliberate request from
  the renderer to another loopback port must fail the same check, which proves the trace sees it.
- Egress on Windows, manual: the offline run in Windows Sandbox with networking disabled and a
  `pktmon` capture; the result goes into the smoke report.
- M5 repeats the smoke on the final 1.0 artifacts.

NOTES:
- Coverage percentage is not a target; each work package's "Done when" list is.
- Work packages cite this file as `08 §n`.
