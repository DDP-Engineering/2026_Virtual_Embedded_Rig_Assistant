# Plugin bench resources, leases and HIL plans

## Routing

Select for bench resources (`lab/resources.json`, identity keys, leases, supervised cleanup, spec
`.agentic/specs/REQ-DATA-f2cbfc23.md`) at shared `lab-resources.ts`, core `leases.ts`,
`resource-registry.ts` and the runner's `lease` option; and for HIL plans (program field `plan: hil`, spec
`.agentic/specs/REQ-DATA-5f714098.md`) at shared `hil-plan.ts`, core `plugins/hil/` (`adapters.ts`,
`compile.ts`, `executor.ts`, `run.ts`) and the runner's `hold`/`parent`; focused tests sit next to each.
[Plugin program runner](plugins-runner.md) owns the run itself and the in-process serial-port and volume
guards; [Plugin program tools and approvals](plugins-program-tools.md) owns the run_program request the
claims are bound into; [Plugin bypass input policy](plugins-bypass.md) owns HIL inputs outside the
workbench. [Plugins](plugins.md) is the index of the plugin pages.

## Purpose and boundaries

Bench resources: a program that declares `resources {option, kinds, grace, cleanup, cleanupTimeout}` claims
the `lab/resources.json` alias a call names with `option`. Program-tools resolves it to identity keys before approval
and binds the aliases and the registry hash into the request; the runner refuses a second holder (BUSY) in-process
and through `ResourceLeases`, a per-user lease folder the desktop app and the CLI share, supervises the run with a stop
request and a grace period, runs the declared cleanup once after an interrupted actuation and reports the physical
state. `ResourceLeases` is the only lease registry; later identity kinds extend the registry schema and key function.
Debug probes are identity kind `probe` (`resource` `VID:PID:SERIAL`), keyed `probe:<vid>:<pid>:<serial>` and
`probe:<vid>:<pid>`, the keys the runner gives probe-rs `--probe` selectors and HIL plan probes, so a gdb-debug session,
a probe-rs run and a HIL plan on one probe exclude each other with no runner change; two probes of one model are one
reservation, and access that does not name the probe (probe-rs without `--probe`, stm32-cubeprog `sn=`) is not detected.
Power monitors are identity kind `power-monitor` (`resource` `u/js220/<serial>`, pyjoulescope_driver's device
path), keyed `power-monitor:js220:<serial>`; the runner reserves them unchanged. HIL adapters carry a
`captures` flag (scpi.capture, power.capture): a later `lab-validate.compare` source may bind to such a step's run folder.

HIL plans: for a program that declares `plan: hil`, `run_program` hands `check <plan>` and `run <plan>` to core
`plugins/hil/`. Compilation validates the plan, checks the firmware hash and prepares every step's operation through
its adapter exactly like a run_program call (`prepareCall`), so the program's own rules decide each risk; `check` prints
the expansion (exit 0, or exit 2 with problem paths). `run` asks one run_program approval at the plan's highest risk
(plus the declared firmware effect when the plan flashes or resets), with the expansion as notes and every operation's
request hashed in its `plan` field; consuming re-compiles with the same run id (CONFLICT on any change). The executor
holds the plan's registry, serial-port and probe keys through `ProgramRunner.hold`, runs each operation as a child run
(`parent`) that borrows those leases, re-hashes the plan and firmware before each step child (cleanup children
re-check only their own files), runs every cleanup step after Stop/budget/error and always finishes the hold, records
`unknown` physical states and writes `embedded-lab-results/<run-id>/`. In-process, the runner also treats `--probe`
values as `probe:<selector>` keys, so a run naming a probe a plan holds is BUSY. A background run's own
`--probe` selector also holds the probe against a selector that is only its model, and the reverse (`sameProbe`).

## Public interface

- Bench resources (shared `lab-resources.ts`): `LAB_REGISTRY_PATH` (`lab/resources.json`), `LAB_REGISTRY_BYTES` (256 KiB),
  `labRegistrySchema` (format 1, 1..64 entries, unique aliases; kind `visa`: alias, resource, serial?, profile,
  backend? py|ivi, limits?, note?; kind `probe`: alias, resource `VID:PID:SERIAL` with serial `[A-Za-z0-9._-]{1,64}`,
  profile, note?; kind `power-monitor`: alias, resource `u/js220/<serial>`, profile, note?; kind `bus-adapter`: alias,
  backend `bus-pirate-bpio2`, resource and terminal (COM<n> or
  /dev paths, different), identity `usb:<vid>:<pid>:<serial>`, power? {maxMv 800-5000, maxMa 1-500}, note?; kind
  `ble-device`: alias, address (six hex octets), addressType public|random (random only static), profile, serial?,
  adapter? hci0-hci99, note?; kind `linux-board`: alias, host, user (not root), port? (22), hostKeys? 0-4 `SHA256:` fingerprints,
  agentKey?, identity? {serial?, machineId?, model?}, root? (absolute, 2-16 safe segments; the plugin's default is ~/vera-projects), note?),
  `labResourceKindSchema` (`visa`, `probe`, `power-monitor`, `bus-adapter`, `ble-device`, `linux-board`),
  `visaResourceKeys(resource, serial?)`, `probeResourceKeys(resource)`, `powerMonitorResourceKeys(resource)`,
  `labResourceKeys(entry)` (bus-adapter: `serial:<resource>`, `serial:<terminal>`,
  identity lower-cased; ble-device: `ble:<address lower-case>`; claimedResources reports its address as the resource;
  linux-board: `ssh:<host lower-case>:<port>`, resource `<user>@<host>:<port>`),
  `serialPortKey(port)`; manifest program field `resources`; approval payload `resources [{alias, kind, resource}]` with
  `registry {path, sha256}` (both or neither).
- Leases (core `leases.ts`): `leaseRoot({platform, env, tmpdir, uid?})`, `leaseFileName(key)`, `new ResourceLeases({root,
  app, pid?, alive?, now?, platform?})` with `acquire(claims, {sessionId, runId})` -> `HeldLeases {states, markUnknown(reason),
  clear(), release()}` (BUSY `{resource, holder}`, DENIED `{reason: leases}`; an owner's `parent` names a plan run of
  this process whose leases the claim borrows), `controlFolder(runId)`,
  `removeControl(runId)`; `LeaseClaim {kind, alias, resource, keys, actuates}`. Core `resource-registry.ts`:
  `namedAliases(option, args)`, `readRegistry(workbench)`, `claimedResources(workbench, program, args)` ->
  `{resources [{alias, kind, resource, keys}], registry {path, sha256}}`; `ProgramChangeRequest.resources/registry`.
- Runner `RunRequest.lease {claims, graceMs, cleanup? {args, timeoutMs, shown?}}`, runner option `leases`;
  `RunResult.physical` (`unchanged|confirmed|unknown`) and `cleanup` (`none|separate|failed`), also in the run_program
  foreground and program_stop results and in `RunRead`/program_output once a background run ended. The serial-port
  exclusion between serial runs and claims holds inside one runner (serial runs take no lease file).

## Invariants

- Bench resources: a call naming the program's resource option more than once, an alias missing from
  `lab/resources.json`, a kind the program does not declare, or a registry that is missing, not a regular file, over
  256 KiB, not UTF-8 JSON or invalid is refused before approval. Keys are compared as sets: a claim whose keys meet an
  unfinished run's claims or serial ports (and a serial port a running claim holds) is BUSY `{handle, resource}` /
  `{handle, port}` before spawn; then each key is taken in sorted order as `<sha256(key)[:32]>.lease`, written aside and
  published with an exclusive hard link, all or none. A lease is held while its pid answers a signal-0 probe; a dead
  holder's lease is moved aside and removed (restored if it changed meanwhile), and when it could actuate the key gets
  `<hash>.state` `{state: unknown, reason: holder-lost}`; an unreadable lease is BUSY and never deleted. Leases are
  removed only by their own run (same pid and run id). On Linux the folder must be owned by the user with no group or
  other permissions.
- A run with a lease, and its cleanup run, get `VERA_REGISTRY_SHA256` (the approved registry's hash, which the program
  checks before opening anything) and `VERA_RUN_CONTROL` (`<lease folder>/runs/<run id>/`, removed after the run) and, when a
  claimed key is recorded unknown, `VERA_RESOURCE_STATE` `{alias: {state, since, runId, reason}}`. Stop, timeout, abort
  and the lifecycle stops write `stop` there and kill the tree only after `graceMs`. After the program exits the runner
  reads `state.json` `{format: 1, phase, physical}`: an actuating claim (risk device-write or irreversible) without
  `phase: released` and `physical` confirmed or unchanged starts `cleanup.args` with the same executable, once, without
  approval, with its own control folder, `VERA_CLEANUP_OF` and a `cleanupTimeout` tree kill; its output follows a
  `[VERA] Cleanup:` line in the run's log. `unknown` marks every claimed key, a reported `confirmed` clears them, and the
  log ends with `[VERA] Physical state: <state>`. A run without a resource claim gets none of these.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Bench registry, identity keys, leases, supervised cleanup | shared `lab-resources.ts`, core `leases.ts`, `resource-registry.ts`, `runner.ts` (`lease`) | `lab-resources.test.ts`, `leases.test.ts`, `runner-leases.test.ts`, `program-resources.test.ts`, `tests/plugins/scpi-instruments.test.ts` |
| HIL plans: schema, adapters, compilation, approval, executor, plan holds | shared `hil-plan.ts`, core `plugins/hil/*`, `program-tools.ts` (hand-off, `prepareCall`, `startCall`), `runner.ts` (`hold`, `parent`), `leases.ts` (`parent`) | `hil-plan.test.ts`, `hil/hil.test.ts`, `runner-leases.test.ts`, `tests/plugins/hil-testing.test.ts` |

## Key behaviors

- `REQ-DATA-f2cbfc23` / `REQ-FUNC-0542cc94` / `REQ-UX-73dd7a9b` — bench registry, VISA identity keys, reserved resources in
  approvals (spec REQ-DATA-f2cbfc23.md).
- `REQ-FUNC-a5770245` / `REQ-FUNC-e4ca09ad` / `REQ-REL-52212fce` / `REQ-PLAT-fae260c3` — in-process BUSY, cross-process
  leases, stale leases, per-user lease folder.
- `REQ-FUNC-3bf3d5bc` / `REQ-REL-3817f2fd` / `REQ-FUNC-d4b72e6b` / `REQ-SEC-80fa1675` — stop request and grace, authorized
  cleanup run, physical state, approved registry hash.

## Files

- `05_Software/src/libraries/shared/src/lab-resources.ts`, `lab-resources.test.ts` — registry schema and identity keys.
- `05_Software/src/libraries/core/src/plugins/leases.ts`, `leases.test.ts` — the lease registry and unknown-state markers.
- `05_Software/src/libraries/core/src/plugins/resource-registry.ts`, `program-resources.test.ts` — claims of run_program calls.
- `05_Software/src/libraries/core/src/plugins/runner-leases.test.ts` — BUSY, stop request, cleanup run, physical state, plan holds.
- `05_Software/src/libraries/shared/src/hil-plan.ts`, `hil-plan.test.ts` — HIL plan format 1 and its problem paths.
- `05_Software/src/libraries/core/src/plugins/hil/` (`adapters.ts`, `compile.ts`, `executor.ts`, `run.ts`, `hil.test.ts`) —
  HIL adapters, compilation, approval binding and the plan executor.
