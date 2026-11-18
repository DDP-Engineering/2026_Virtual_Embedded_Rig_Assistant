# Official plugins: Arduino, MicroPython and CircuitPython

## Routing

Select for `arduino-cli` (pinned arduino-cli 1.6.0 and the `arduino-tool` script: inspect, boards, cores, libraries,
install, compile, upload, report, clean in VERA's own Arduino environment; skills arduino-build-fix, arduino-libraries
and arduino-test-sketch); `micropython` (the pinned-mpremote `micropython-tool` script: ports, identify, files,
read-file, deploy-file through a verified temporary copy, run-file from RAM, capture-output, reset, report; skills
micropython-deploy and micropython-test-script); and `circuitpython` (the pinned-circup `circuitpython-tool` script:
devices, identify, inspect-code, inspect-libraries, prepare-libraries from a pinned bundle tag, deploy to the
CIRCUITPY drive one verified file at a time, capture-output, report; skills circuitpython-deploy and
circuitpython-libraries).

For arduino-cli, start at plugins/arduino-cli/plugin.yaml, scripts/arduino_tool.py and scripts/arduino_support/
(environment.py for VERA's Arduino environment, configurations and staging; sketch.py, boards.py for identity keys,
indexes.py for offline searches, compile.py, upload.py, report.py, cli.py) with spec .agentic/specs/REQ-DATA-e444904d.md;
tests/plugins/arduino-cli.test.ts, tests/support/fake-arduino-cli.py and tests/fixtures/arduino-cli/ own its
coverage. Its workspace.py is a byte-identical copy of ngspice-tool's.

For micropython, start at plugins/micropython/plugin.yaml, scripts/micropython_tool.py and scripts/micropython_support/
(cli.py dispatch and argument limits, device.py session and board snippets, deploy.py, operations.py, ports.py identity
keys, remote.py board paths, report.py) with spec .agentic/specs/REQ-DATA-cb0ccbea.md; tests/plugins/micropython.test.ts
and tests/fixtures/micropython/ (fake-serial: a simulated board speaking the raw REPL; fake-mpremote: a minimal
SerialTransport client - offline evidence only) own its coverage. Its workspace.py is a byte-identical copy of arduino-tool's.

For circuitpython, start at plugins/circuitpython/plugin.yaml, scripts/circuitpython_tool.py and scripts/circuitpython_support/
(cli.py dispatch and argument limits, volumes.py CIRCUITPY enumeration, boot_out.txt, identity and binding, ports.py,
conventions.py the only circup imports, inspection.py, bundle.py prepare-libraries, deploy.py, console.py, report.py) with
spec .agentic/specs/REQ-DATA-8f309a53.md; tests/plugins/circuitpython.test.ts, tests/support/make-circuitpython-bundle.py
and tests/fixtures/circuitpython/ (fake-serial: a CircuitPython console that reruns code.py on drive changes; fake-circup:
the circup names the helper imports - offline evidence only) own its coverage. Its workspace.py is a byte-identical copy
of micropython-tool's.

The conventions shared by all official plugins (package format, catalog source, packs, versions and evidence
levels) and the page of every other plugin are in [Official plugins](official-plugins.md). The platform that
installs, classifies, approves and runs these programs is [Plugins](plugins.md); plugin skill discovery is
[Skills](skills.md).

## Public interface

- `arduino-cli` 0.2.0, ecosystem `arduino` (Arduino pack, group "Sketches (Arduino CLI)", default on; activities
  `build`, `flash`), Windows x64 and Linux x64, requires serial-monitor. Program `arduino-cli`: the official 1.6.0 zip
  (Windows) or tar.gz (Linux) by SHA-256, `preferDownload`, else PATH (`/usr/local/bin`, `/usr/bin` on Linux) in
  range `>=1.6,<2`; every `arduino-cli *` command blocked. Program `arduino-tool` = `scripts/arduino_tool.py` (PEP 723,
  standard library), `uses: [arduino-cli]`, timeout 1800 s. Risks: `inspect`, `report`, `clean`, `boards details`,
  `boards search`, `cores *`, `libraries *` safe; `boards list` and `compile` device-read (discovery tools; core
  recipes and hooks run on the host); `install *` device-write (3600 s); `upload *` device-write (600 s). VERA's
  Arduino environment is `$VERA_ARDUINO_HOME` or `~/.vera-arduino` (`data`, `downloads`, `user`, `cache`,
  `staging/<run-id>-<hex>` with `owner.json`, `environment.json` format 1 with https index URLs); every arduino-cli
  call is `--config-file <generated> --json <command>` with cwd the staging folder (created as `.starting-*` with
  `owner.json`, then renamed) and closed stdin, and no agent value may start with `-`; the offline configuration
  (everything but install) sets `network.proxy: http://127.0.0.1:9`. `cores search` and `libraries search` read the
  downloaded index files themselves (arduino-cli would refresh a day-old index first and fail offline). An
  arduino-cli call that fails where its answer is needed is `error`/`tool-failed`, exit 3; a run folder holds an
  `incomplete` result while arduino-cli compiles or uploads, so an interrupted run reads as such. Install: `index
  [--index-url https]`, `core VENDOR:ARCH@VERSION --skip-post-install` (records a replaced version), `library
  NAME@VERSION --no-deps` (missing dependencies are warnings). Compile refuses before arduino-cli compiles
  (`fqbn-invalid`, `core-missing`, `core-version`, `local-override` for platform.local.txt/boards.local.txt,
  `fqbn-unknown` with up to ten close candidates, `fqbn-option` with the declared values, `library-missing`,
  `library-version`, `sketch-invalid`), copies the sketch (without sketch.yaml/sketch.json, a top-level build folder,
  hidden entries; links refused) and `--library-dir` folders into the run folder, builds in staging, exports to
  `binary/`, and records FQBN/options, platform with recipe hash and hooks, arduino-cli version, configuration hash,
  source files and combined hash, libraries (platform/index/local, declared), sizes, binaries and sketch-relative
  diagnostics; an undeclared index library makes it `fail`, "Multiple libraries were found" a warning. Upload takes
  the compile's `result.json` (approval-bound), re-hashes the sketch copy, the binaries and the original sketch
  (`conflict`), checks the port by identity (`port-missing`, `identity-mismatch`, `identity-ambiguous`,
  `board-mismatch`, `board-unverified` without `--board-unverified`, `programmer-unknown`), copies the binaries to
  staging together with exactly the recorded sketch files, verifies them and uploads those copies with `--protocol serial`, then lists the ports again for `port.after` (null with `identity-not-found`, `identity-ambiguous` or, when the list fails, `ports-unlisted`; the upload's status stands).
  Identity: `usb:vid:pid:serial` (stable), `usb:vid:pid` or `serial:<address>` (unstable); FTDI, WCH, Silicon Labs
  and Prolific bridge VID:PIDs are never identified (matches become candidates); network ports are ignored. Results:
  `arduino-iot-results/<run-id>/` (`result.json` kind `arduino-tool-result`, `report.md`, logs), no absolute path;
  exit 0 pass, 2 blocked, 3 fail or error. Evidence: arduino-cli 1.6.0, arduino:avr 1.8.8 and arduino:samd 1.8.14
  on Windows 11; real upload, serial readback, two boards and native Ubuntu are pending hardware.

- `micropython` 0.2.0, ecosystem `micropython` (Arduino pack, group "MicroPython", default on; activities `flash`,
  `testing`), Windows x64 and Linux x64. Program `micropython-tool` = `scripts/micropython_tool.py` (PEP 723,
  `mpremote==1.29.0`, `pyserial==3.5`, `platformdirs==4.14.0`), timeout 300 s. Risks: `ports`, `report` safe;
  `identify`, `files`, `read-file`, `capture-output`, `reset` device-read (notes: interrupts or restarts the running
  program; read-file 900 s, capture-output 660 s); `deploy-file`, `run-file` device-write (900 s, 3600 s); `deploy-file * --startup *` irreversible. The helper
  uses mpremote's `SerialTransport` and sends only fixed snippets: no REPL, connect, exec, eval, mount or firmware
  operation. Device operations list the ports first (`port-missing`, `identity-mismatch`), open the raw REPL without a
  soft reset (run-file with one), refuse firmware other than MicroPython >=1.22 (`incompatible-firmware`), and leave the
  raw REPL and close the port at the end (`--restart` soft-resets so main.py runs). Remote paths are absolute, <=255
  characters, <=16 segments, no `.`/`..`/empty segment, backslash, control character or `.vera-part` (`remote-path`);
  boot.py/main.py need `--startup` (`startup-file`). deploy-file: parent (`--mkdir`), `before` hash, `--expect-sha256`/
  `--expect-absent` (`conflict`), stale part removed, space check (`no-space`), `incomplete` result.json phase
  `transfer`, 256-byte chunks to `<target>.vera-part`, board hash (`hash-mismatch`; read-back without hashlib), target
  re-check (`conflict`), phase `replace`, rename or, on EEXIST only, `remove-then-rename` (other errors `write-failed`),
  verify (`verify-failed`); every refusal precedes the first write (`--mkdir` folders, stale part removal). Loss: `disconnected`
  (port gone), `device-reset` (`soft reboot`/banner read during the failing exchange), `no-response` (Ctrl-C, Ctrl-B sent once); `application: unknown`. run-file: <=256 KiB
  UTF-8, raw-REPL (raw-paste) execution, serial reads bounded at 10 s, output capped by `--max-output`, deadline `--timeout` (<=3500 s) then Ctrl-C (`incomplete
  timeout`), verdict from the traceback. capture-output reads without sending (`firmware: null`), or checks the firmware and restarts first; reset hard waits up to
  15 s for the identity (`port-lost`). Results `arduino-iot-results/<run-id>/` (`result.json` kind
  `micropython-tool-result`, `report.md`, `files/`, `output.txt`); exit 0 pass, 1 fail, 2 blocked, 3 incomplete or
  error. Evidence: the simulated board with the fake client and the real mpremote 1.29.0 (opt-in); no real
  board yet.

- `circuitpython` 0.2.0, ecosystem `circuitpython` (Arduino pack, group "CircuitPython", default on; activities `flash`,
  `testing`), Windows x64 and Linux x64. Program `circuitpython-tool` = `scripts/circuitpython_tool.py` (PEP 723,
  `circup==3.1.0`, `pyserial==3.5`), timeout 300 s. Risks: `devices`, `report` safe; `identify`, `inspect-code`,
  `inspect-libraries`, `capture-output` device-read (660 s); `capture-output * --reload *`, `prepare-libraries` (900 s,
  network) and `deploy` (900 s; note: code.py reloads, Stop does not stop board code) device-write; `deploy * --boot *`
  irreversible. The board is reached through its CIRCUITPY drive (file I/O) and serial console (read; Ctrl-C/Ctrl-D only
  for --reload); circup supplies only bundle conventions (platforms, supported majors 9-11, name cleaning, requirements,
  versions), never its CLI. Volumes: Windows labels via GetVolumeInformationW (read-only flag, serial), Linux
  /proc/self/mounts with by-label/by-uuid; identity = the bound port's `usb:<vid>:<pid>:<serial>` when boot_out.txt's UID
  equals exactly one port's serial number, else `circuitpy-uid:<uid>`, else `volume-serial:<serial>` (unstable); refusals
  `volume-missing`, `identity-mismatch`, `identity-insufficient`, deploy `ambiguous`; firmware other than 9-11 or no
  boot_out.txt `incompatible-firmware`. inspect-code lists (2000 entries, depth 8) with hashes, names the startup file
  (code.txt, code.py, main.txt, main.py) and copies it and boot.py; settings.toml/secrets.py never read. inspect-libraries
  marks .mpy without header `C\x06` incompatible (`mpy-incompatible` warning). prepare-libraries: tag = 8 digits, assets
  `adafruit-circuitpython-bundle-{py,<major>.x-mpy}-<tag>.zip` from the Adafruit bundle releases, cached in
  `~/.vera-circuitpython/bundles/<tag>/` with `hashes.json` (`cache-changed`, `download-failed`), dependencies from the py
  zip's requirements and pyproject `circup_dependencies` (`unknown-library`, warning `dependency-not-in-bundle`), every .mpy
  `C\x06` (`mpy-incompatible`), writes `libraries/` + `library-set.json` (format 1, kind `circuitpython-library-set`,
  per-file SHA-256). deploy: refusals before any write (`target-path`, `startup-file`, selection, firmware,
  `library-set-invalid`/`incompatible-libraries`/`library-set-changed`, `read-only`, `--expect-from` `conflict`,
  `no-space`, `port-mismatch`); order libraries, other files, boot.py, startup files; per file `.vera-part` + fsync,
  read-back (`hash-mismatch`), target re-check (`conflict`), `os.replace`, `os.sync` where present, read-back
  (`verify-failed`), `confirmed`; a shadowing startup file warns `startup-shadowed`; settings.toml/secrets.py targets keep
  no hash in the result;
  incomplete result.json after each file; ENOSPC `no-space`, EROFS/EACCES/write-protect `read-only`, volume gone, EIO/ENODEV/ENXIO
  or Windows device-gone errors `incomplete disconnected`; `application` updated/partially-updated/unchanged/unknown; `--capture N --port` reads the
  console from before the first write and judges the run after the last (`exception`, `no-run-observed`). capture-output
  parses `Auto-reload is on/off`, `<file> output:`, `Code done running.` and tracebacks (`fail exception`). Results
  `arduino-iot-results/<run-id>/` (`circuitpython-tool-result`, `report.md`, `files/`, `console.txt`); exit 0/1/2/3.
  Test seams `VERA_CIRCUITPYTHON_FAKE_BENCH` (volumes, deploy faults) and `VERA_CIRCUITPYTHON_DOWNLOAD_BASE` (127.0.0.1
  only); the runner never passes them. Evidence: simulated volumes and console with the fake and the real circup
  3.1.0 (opt-in); no real board or real bundle download yet.

## Invariants

- arduino-tool never names the Arduino IDE's folders and never installs during compile or upload: the offline
  configuration's dead loopback proxy makes any HTTP access fail, and a missing core or library is a refusal naming
  the install command. A compile never changes the sketch (it builds a copy) and never uses sketch.yaml defaults or
  profiles; an upload sends only a staged, re-verified copy of a passing build's binaries, never a recompile.
- arduino-tool sets `sys.dont_write_bytecode` before importing `arduino_support`, so a run leaves the installed package
  unchanged; it writes only run folders under the workbench and the VERA Arduino environment.
- micropython-tool sets `sys.dont_write_bytecode` before importing `micropython_support`, writes only run folders under the
  workbench, never stores run-file code on the board and never writes boot.py/main.py without `--startup`.
- circuitpython-tool sets `sys.dont_write_bytecode`, reaches the network only in prepare-libraries, writes a volume only in
  deploy (never boot.py without `--boot`, never boot_out.txt) and never reads settings.toml or secrets.py.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| An arduino-tool operation, option or refusal | `plugins/arduino-cli/scripts/arduino_support/{cli,compile,upload}.py`, spec REQ-DATA-e444904d | the operation's describe block in `arduino-cli.test.ts` (fake arduino-cli), then the real-tool block |
| Arduino environment, configurations, staging, clean | `arduino_support/environment.py` | "runs arduino-cli only with VERA's own folders", "Stop and clean" |
| Board identity keys or the bridge list | `arduino_support/boards.py` | "lists serial ports by identity", upload identity refusals |
| A new arduino-cli release | the manifest's download pins and range; rerun the real-tool tests (`VERA_TEST_ARDUINO_CLI`, `VERA_ARDUINO_HOME`) | package test and real compiles |
| A micropython-tool operation, snippet or refusal | `plugins/micropython/scripts/micropython_support/{cli,device,deploy,operations}.py`, spec REQ-DATA-cb0ccbea | micropython.test.ts |
| A new mpremote release | the script header pins; rerun the opt-in test (`VERA_MICROPYTHON_UV`) | micropython.test.ts opt-in |
| A circuitpython-tool operation or refusal | `plugins/circuitpython/scripts/circuitpython_support/{cli,volumes,inspection,bundle,deploy,console}.py`, spec REQ-DATA-8f309a53 | circuitpython.test.ts |
| A new circup release or CircuitPython major | the script header pin, `conventions.py`; rerun the opt-in test (`VERA_CIRCUITPYTHON_UV`) | circuitpython.test.ts opt-in |

## Key behaviors

- `REQ-FUNC-5b49327c` / `REQ-SEC-93d5fc98` / `REQ-FUNC-693a8fbf` — arduino-cli pinned 1.6.0 with direct use blocked, arduino-tool risks, catalog, Arduino pack and three skills.
- `REQ-DATA-e444904d` / `REQ-FUNC-32924acc` / `REQ-FUNC-9fceeea6` — arduino-tool contract, VERA's own environment offline outside install, exact-version installs.
- `REQ-FUNC-d02a9d01` / `REQ-FUNC-cbd22972` / `REQ-FUNC-91c2c9a8` — inspect, identity keys without bridge inference, offline queries.
- `REQ-FUNC-6678cab1` / `REQ-REL-6b92ea2f` / `REQ-REL-c731bd06` / `REQ-SEC-f5477b64` / `REQ-SEC-37d5b2a2` / `REQ-SEC-8faa1e1d` — traceable compile of a copy and its refusals and failures.
- `REQ-FUNC-f2b3eb7d` / `REQ-SEC-ea1a5b7d` / `REQ-SEC-77af299d` / `REQ-FUNC-165776d6` — upload of the verified binary, conflict and identity refusals, port re-bound after upload.
- `REQ-REL-fa13ca61` / `REQ-FUNC-e2eea361` / `REQ-TEST-de25fd47` — Stop leaves no process and clean removes ended staging; report; real-tool and gated hardware tests.

- `REQ-DATA-cb0ccbea` / `REQ-SEC-bf7892ca` / `REQ-SEC-d8ec50bc` / `REQ-FUNC-f030cffe` — micropython-tool contract, pinned
  mpremote, no REPL/exec/mount, risks, catalog and pack.
- `REQ-FUNC-884fed95` / `REQ-SEC-dee0e930` / `REQ-REL-2eaebfec` / `REQ-FUNC-b829232e` / `REQ-FUNC-d8afbfa0` /
  `REQ-FUNC-9d90c56e` — ports, identity refusals, firmware gate, identify, files, read-file.
- `REQ-SEC-d31255bc` / `REQ-SEC-b493a006` / `REQ-FUNC-9dc200c3` / `REQ-REL-af9aefa3` / `REQ-REL-1499a74b` /
  `REQ-REL-8d35cfbd` — remote paths, startup files, verified deploy, conflict, space, loss.
- `REQ-FUNC-ab3282a4` / `REQ-FUNC-eddae180` / `REQ-FUNC-2c9933c0` / `REQ-FUNC-44f315bd` / `REQ-TEST-6073fccf` — run-file,
  capture-output, reset, report, gated real-mpremote and board tests.

- `REQ-DATA-8f309a53` / `REQ-SEC-a6773cd2` / `REQ-SEC-1102b4a6` / `REQ-FUNC-998ebdb7` — circuitpython-tool contract, pinned
  circup conventions, no REPL/UF2/update-all, risks, catalog and pack.
- `REQ-FUNC-1bb6b2bb` / `REQ-FUNC-3f98ad97` / `REQ-SEC-b561dad0` / `REQ-SEC-8ddddfbb` / `REQ-REL-e00b3fb2` /
  `REQ-FUNC-96d699ae` / `REQ-FUNC-33fb01a8` / `REQ-FUNC-e51d0294` — devices, UID binding, selection refusals, firmware gate,
  identify, inspect-code, inspect-libraries.
- `REQ-FUNC-37730607` / `REQ-REL-33085a32` / `REQ-REL-ca9500d0` / `REQ-SEC-15d58156` — library sets from a pinned tag,
  .mpy ABI, unknown library and download failure, verified cache.
- `REQ-SEC-1d4b7f0a` / `REQ-FUNC-5a6f4aec` / `REQ-SEC-a59697a3` / `REQ-REL-aa8de0c7` / `REQ-REL-3542e56c` /
  `REQ-REL-dff06f35` / `REQ-REL-b71b5cab` — deploy: set check, verified files, boot.py, read-only, space, unplug, conflict.
- `REQ-FUNC-9845bd14` / `REQ-FUNC-3371a413` / `REQ-FUNC-52e12d99` / `REQ-TEST-5af7bf4a` — console capture, deploy capture,
  report, gated real-circup, bundle and board tests.

## Files

- `05_Software/plugins/arduino-cli/` — manifest, README (pins, environment, risk table), skills arduino-build-fix, arduino-libraries and arduino-test-sketch, `scripts/arduino_tool.py` (entry), `scripts/arduino_support/` (`environment`, `sketch`, `boards`, `indexes`, `compile`, `upload`, `report`, `cli`, `workspace` shared).
- `05_Software/tests/plugins/arduino-cli.test.ts`, `tests/support/fake-arduino-cli.py` (scripted arduino-cli recording argv and configuration), `tests/fixtures/arduino-cli/` (VeraBlink with an ignored sketch.yaml, VeraLibrary with the local VeraCounter library, VeraBroken, VeraMissingLib, Misnamed).
- `05_Software/plugins/micropython/` — manifest, README, skills micropython-deploy and micropython-test-script, helper and
  support package.
- `05_Software/tests/plugins/micropython.test.ts`, `tests/fixtures/micropython/` (fake-serial board, fake-mpremote client).
- `05_Software/plugins/circuitpython/` — manifest, README, skills circuitpython-deploy and circuitpython-libraries, helper and
  support package.
- `05_Software/tests/plugins/circuitpython.test.ts`, `tests/support/make-circuitpython-bundle.py`,
  `tests/fixtures/circuitpython/` (fake-serial console, fake-circup).
