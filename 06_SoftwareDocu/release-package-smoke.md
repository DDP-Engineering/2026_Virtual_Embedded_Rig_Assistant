# Release artifact smoke

Build release artifacts explicitly with `npm run package` on the native platform.
From `05_Software`, run `npm run smoke:package -- --artifact <release path>`.
An optional `--scratch <new directory>` selects a fresh owned root. Existing roots
are refused. `--resume <owned failed run>` reuses extraction only for an exact
matching artifact, with all prior process exits recorded and retained failed logs
and report; current extracted binary/ASAR identities are checked again. The smoke performs extraction/installation, starts the release with
updates Off, copies the demo, indexes and searches local documents, renders PDF,
then uses a normal custom provider at an ephemeral loopback endpoint for streamed
read/write tools, ordinary approval, a verified citation and restart persistence.
It never builds. No app test switch or internal audit is used.
The product routes eager dictionary initialization to the local vera://app scheme,
disables native ONNX telemetry before worker initialization and
Electron session dictionary downloads before opening a window. The harness
observes these states and supplies no telemetry/dictionary opt-out.

Windows ZIP uses portable adjacent data; NSIS checks existing VERA registry
identity before installation. If an installation exists, the harness extracts
the NSIS payload and records installation as pending, preserving that identity.
Use a fresh Windows account or Sandbox for actual per-user installer acceptance.
Linux AppImage/deb are extracted into the owned spaced/Unicode path. Ubuntu runs
all four launches under `strace -f -e trace=connect,sendto,sendmsg`, including renderer,
Chromium network processes and workers. Offline permits no inet/inet6 destination;
scripted permits only AF_INET 127.0.0.1 at the exact server port. Unix sockets are
ignored, failed connection attempts count, malformed/incomplete traces fail.

The exit is 0 for complete PASS, 1 for failure and 2 for functional PASS with
pending platform egress proof. `smoke-report.json` retains artifacts, execution
identities, logs/traces, errors and manual status. Useful raw failed proof stays
available. Close all owned processes before removing owned profiles/extractions;
retain original release artifacts, reports, screenshots, trace and execution logs.
Do not follow junction/symlink targets during cleanup.

Pass `--upgrade-proof <original upgrade-report.json>` once for each original
WP31/32 platform report. Their hashes, exact artifact identities and outcomes are
included as supplementary instrumented connected-host evidence; release upgrade
proof remains pending. This option does not execute an upgrade.

For native Ubuntu calibration, explicitly build a separate instrumented app with
`VERA_TEST=1 npm run build`, then run
`node scripts/smoke-calibration.mjs <built src/apps/desktop directory> <new owned root>`.
This uses the pinned development Electron and a dedicated sandboxed fixture
renderer in the instrumented app, with a fixture CSP admitting only its deliberate
endpoint. The production vera://app window and its CSP remain unchanged. A real
renderer fetch to a forbidden ephemeral loopback port must reach the HTTP server
and be rejected by the same strace oracle. The calibration report records expected
oracle FAIL separately from calibration PASS, and is never release proof.

## Windows Sandbox and pktmon

`05_Software/scripts/sandbox/VERA.wsb` disables networking and clipboard, maps inputs
read-only and a new evidence folder writable. Substitute the two host paths before
opening it. The supplied map is an example; it is not an executed result. Unsigned
execution requires a machine whose policy permits it. The previously observed
Smart App Control block and unavailable HyperV inventory remain environment
limitations; retry only after a concrete environment change.

In a clean Sandbox, before starting VERA, open elevated PowerShell and run:

```powershell
Get-FileHash 'C:\VERA-input\VERA-version-win-x64.exe' -Algorithm SHA256
pktmon filter remove
pktmon start --capture --pkt-size 0 --file-name C:\VERA-evidence\offline.etl
```

Install the NSIS per-user release with an explicit destination such as
`C:\Release é`, or extract the portable ZIP there. Launch with an explicit owned
`--user-data-dir` for NSIS; ZIP selects adjacent `data`. Verify Updates Off, open a
copied fictional demo, wait for indexing, search and render a PDF, then quit. Record
install/start/index/view outcomes, loaded native/model resources and actual paths.
In the same PowerShell window finish capture:

```powershell
pktmon stop
pktmon etl2txt C:\VERA-evidence\offline.etl --out C:\VERA-evidence\offline.txt
Get-FileHash C:\VERA-evidence\offline.etl -Algorithm SHA256
```

Inspect the capture with process/run time boundaries and record actual observations;
an empty capture alone is not proof of app execution. Keep raw ETL/text, Sandbox
configuration, artifact hash and screenshots. Supply `--windows-evidence <JSON>`
only after actual execution. Its fields are `artifactSHA256`, `status` (PASS/FAIL),
`networking` (`Disabled`), `operator`, `observedAt`, `observations` and `capture`
with accessible `path` and `sha256`. The harness verifies that capture hash and
artifact binding. Missing evidence stays pending, including clean Windows/VC++
self-containment deferred by the user until final release. Current-host functional
acceptance is distinct. Scripted loopback acceptance runs on the native current
host; the networking-disabled Sandbox covers the offline run.
