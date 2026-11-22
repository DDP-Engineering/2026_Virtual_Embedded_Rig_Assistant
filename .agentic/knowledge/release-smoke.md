# Release artifact smoke

## Routing

Select for smoke:package, artifact functional acceptance, external egress,
renderer calibration and the Windows pktmon capture (automated or manual). Start at
`05_Software/tests/packaging/smoke/smoke-package.mjs`; focused tests: packaging/package-smoke.test.ts,
packaging/windows-egress.test.ts.
Package construction/pins belong to [native packaging](native-packaging.md),
installed updates to [updates](updates.md).

## Purpose and boundaries

External public IPC/UI observes unmodified release artifacts. A normal custom
provider SSE fixture drives read/write/citation/approval/restart. Process-tree
strace owns Ubuntu destination evidence; on an elevated Windows host a pktmon capture per launch
(Kernel-Network and Kernel-Process events, `smoke-windows.mjs`) owns it, and a manual Sandbox
capture remains an alternative for an offline clean machine. Separately identified instrumented renderer calibration proves detection.
Original WP31 updater-probe reports (probe-upgrade.mjs) remain supplementary.

## Public interface

`smoke:package -- --artifact <path> [--scratch <new root>]` accepts NSIS/ZIP or
AppImage/deb, never builds/downloads. Optional repeatable --upgrade-proof binds
original updater-probe reports; --windows-evidence binds a manual or earlier automated capture.
On Windows without it, an elevated shell captures automatically and writes `windows-evidence.json`
and `windows-capture.json`; a non-elevated shell keeps the proof pending with the elevation reason. --resume reuses an
exact matching failed owned extraction after exits, preserving original logs.
Exit0 completePASS,1FAIL,2functionalPASS/manual pending. Separate Linux
`smoke-calibration.mjs <built test app dir> <new root>` uses pinned development
Electron and expects oracleFAIL. See [manual procedure](../../05_Software/tests/packaging/smoke/README.md).

## Invariants

- Production session-created policy sets a local dictionary URL and disables spellchecking;
  observed production configuration disables remote dictionary downloads and
  native ONNX telemetry before inference; the harness supplies no opt-out and strips `ORT_*` from the app's
  environment. On Windows the offline run samples the ETW providers of the Node utility processes, where the
  Indexer embeds (`logman query providers -pid`, no elevation, retried on 0x80071068; main runs ORT only
  for dictation and takes about 30 s per query, renderers can't load ORT) from opening
  the workbench until ONNX Runtime has been seen: indexing embeds with it, while `docs.search` is
  keyword-only. ORT's logging provider must appear and its Microsoft-telemetry provider never (REQ-SEC-b4170ade).
- Immutable artifact; release identity/Electron44.11.4/sandbox/vera://app and actual
  owned userData asserted before app mutations and every restart.
- Off updates and copied demo provide real SQLite/local CPU embedding/PDF canvas.
- Existing Windows install identity is protected before NSIS; extraction fallback
  retains installer acceptance pending.
- Streamed tool arguments, ordinary approval, verified citation and complete
  SQLite snapshot persistence are required through the normal custom provider.
- Each scripted request checks full serialized input bytes/output reserve and
  the application's observed complete context budget.
- strace-f sees whole tree; offline no inet/inet6, scripted exact AF_INET127.0.0.1
  port, Unix ignored, failed/incomplete/unknown destinations fail closed.
- Windows: every destination the launched PID's tree (Kernel-Process starts) sends to is the allowed
  exact loopback address/port; connections accepted from loopback clients (Playwright inspector/
  DevTools) and received datagrams are inbound, one accepted from another host is judged; other processes are ignored; a capture without the launch's start event,
  the harness sentinel's socket event or a successful tracerpt conversion fails. Events only, no
  packets. A TCP attempt that never opens may log no addressed event; DNS lookups run outside the tree.
- Calibration fixture renderer is sandboxed; product vera://app window/CSP unchanged.
- Missing manual Windows or release upgrade evidence remains pending; source-report
  SHA and exact instrumented upgrade-proof artifacts retain their limitations.

## Key behaviors

REQ-TEST-8928f10f exact release scenarios; REQ-TEST-f84d343e external destination
oracle/calibration; REQ-TEST-803bb75d Windows pktmon oracle; REQ-TEST-b111844b
artifact/manual/automated Windows/upgrade-proof bindings; REQ-SEC-b4170ade Windows ONNX
Runtime telemetry provider check.

## Files

`tests/packaging/smoke/smoke-{package,runtime,egress,server,report,calibration,windows}.mjs` own scenarios,
native execution, the strace oracle, SSE fixture, proof projection, separate calibration and the Windows
pktmon capture/oracle and the ETW provider check. `tests/fixtures/pktmon/kernel-events.xml` is a recorded,
anonymized tracerpt dump; `tests/fixtures/logman/providers-onnxruntime.txt` a recorded logman provider list.
`02_Tools/release/sandbox/VERA.wsb`, manual procedure and package-smoke tests route acceptance.
