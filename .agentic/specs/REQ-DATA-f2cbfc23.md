# Bench resources, leases and supervised cleanup (host side)

Governs REQ-SEC-80fa1675, REQ-DATA-f2cbfc23, REQ-FUNC-0542cc94, REQ-UX-73dd7a9b, REQ-FUNC-a5770245, REQ-FUNC-e4ca09ad,
REQ-REL-52212fce, REQ-FUNC-3bf3d5bc, REQ-REL-3817f2fd, REQ-FUNC-d4b72e6b, REQ-PLAT-fae260c3. The plugin side is
`.agentic/specs/REQ-DATA-b3e2930f.md`.

## 1 Registry `lab/resources.json`

One file per workbench, written by the user (or the agent through its approved file tools), read by the host and by
plugin helpers. UTF-8 JSON, at most 256 KiB, a regular file inside the workbench reached through the workbench
PathGuard. Format 1:

```json
{
  "format": 1,
  "resources": [
    {
      "alias": "psu",
      "kind": "visa",
      "resource": "USB0::0x1AB1::0x0E11::DP8C123456::INSTR",
      "serial": "DP8C123456",
      "profile": "rigol-dp800",
      "backend": "py",
      "limits": { "CH1": { "voltage": 5.5, "current": 0.5 } },
      "note": "DUT supply"
    }
  ]
}
```

- `resources`: 1...64 entries; `alias` `^[a-z][a-z0-9-]{0,31}$`, unique.
- `kind` is the identity kind. Kind `visa` (the only kind of this version): `resource` (VISA resource name, 1...256
  printable ASCII), optional `serial` (1...64 printable ASCII, the instrument's serial number as `*IDN?` reports it),
  `profile` (`^[a-z0-9][a-z0-9-]{0,63}$`), optional `backend` `py` (pyvisa-py, default) or `ivi` (a VISA library the user
  installed), optional `limits` (channel name -> quantity -> positive finite number, at most 16 channels and 8
  quantities each), optional `note` (at most 256 characters). Unknown keys are refused. Later identity kinds (NIC,
  endpoint, lab host) add a schema branch and a key function; they never add a second registry or lease folder.
- The host reads only alias, kind and identity fields for leases; the whole entry is validated so a plugin never reads
  an entry the host refused.

## 2 Identity keys (kind `visa`)

Parsing is case-insensitive on the keywords; `n` is an optional board number. A key is `<namespace>:<value>`.

| Resource | Key |
|---|---|
| `ASRL<n>::INSTR`, `ASRLCOM<n>::INSTR` | `serial:COM<n>` |
| `ASRL/dev/<path>::INSTR` | `serial:/dev/<path>` (case kept) |
| `USB<n>::<vid>::<pid>::<serial>[::<interface>]::INSTR` or `::RAW` | `usb:<vid 4 hex>:<pid 4 hex>:<serial lower-case>`; vid/pid decimal or `0x` hex |
| `TCPIP<n>::<host>[::<device>]::INSTR` | `tcpip:<host lower-case>` when device is absent, `inst<d>` or `hislip<d>`; else `tcpip:<host>/<device lower-case>` |
| `TCPIP<n>::<host>::<port>::SOCKET` | `tcpip:<host lower-case>` |
| `GPIB<n>::<primary>[::<secondary>]::INSTR` | `gpib:<n or 0>:<primary>[:<secondary>]` |

Hosts are a name or dotted IPv4 address, or a bracketed IPv6 literal. Any other syntax is an invalid entry. A declared
`serial` adds `serial-number:<serial lower-case>`. Two claims conflict when their key sets intersect. A serial port that
another run names (the runner's serial-port guard, also `conn=<port>` inside a sigrok-cli driver specification) is the
key `serial:<port>`. Identity kind `serial` (REQ-FUNC-b9a25608): with a lease registry, each such port is also claimed
across VERA processes as a non-actuating lease `{kind: "serial", alias: <port>, key: "serial:<port>"}`, taken with the
run's other claims and released when the run ends; no registry entry is needed, so every plugin that names its port in
argv (serial-monitor, esp32-esptool, arduino-cli, micropython, sigrok `conn=`) is covered. Limit: different host names of one address, and one instrument on two transports without a
declared serial number, do not share a key.

## 3 Manifest extension

A program may declare `resources`:

```yaml
resources:
  option: --instrument      # the argument that names a registry alias (also --instrument=psu)
  kinds: [visa]
  grace: 10                 # seconds the program gets to finish after a stop request (1...60)
  cleanup: [close]          # arguments of the authorized cleanup run (1...8), followed by "<option> <alias>"
  cleanupTimeout: 60        # seconds (1...300)
```

A call that names the option more than once, names an alias missing from the registry or of an undeclared kind is
refused before approval. A call without the option claims nothing.

## 4 Request and approval

`ProgramChangeRequest.resources` lists `{alias, kind, resource, keys}` and `registry {path, sha256}` (absent without a
claim). The approval payload carries `resources: [{alias, kind, resource}]` and `registry`; the desktop card and the
CLI prompt show them. After approval the request is prepared again and must equal the approved one (CONFLICT); right
before spawn the registry is hashed again with the argument files (CONFLICT).

## 5 Leases

- Folder (per user): Windows `%LOCALAPPDATA%\VERA\leases`, else the system temporary folder's `vera-leases`; Linux
  `$XDG_RUNTIME_DIR/vera-leases` when that variable names an absolute folder, else `<tmpdir>/vera-leases-<uid>`. On Linux
  the folder must be a real directory owned by the user without group or other permissions (created 0700); otherwise a
  claim is DENIED `{reason: "leases"}`.
- One lease file per key: `<sha256(key) first 32 hex>.lease`, JSON `{format: 1, key, kind, alias, pid, app, sessionId,
  runId, actuates, acquiredAt}`, created complete through a temporary file and an exclusive hard link. Claims of one
  run are taken in key order; a failure releases those already taken.
- An existing lease is held while its `pid` runs (a signal-0 probe that does not answer ESRCH). A lease of a process that
  no longer runs is stale: it is removed, and when `actuates` is true the key's state becomes `unknown` with reason
  `holder-lost`. An unreadable or malformed lease is treated as held (BUSY) and never removed.
- State markers: `<hash>.state`, JSON `{format: 1, key, state: "unknown", since, runId, reason}`. A claim returns the
  markers of its keys; the run receives them as `VERA_RESOURCE_STATE` = JSON `{<alias>: {state, since, runId,
  reason}}`.
- BUSY: in-process `{resource, handle}` (handle = the holding run), other process `{resource, holder: "process <pid>"}`.
  Nothing is spawned and no I/O happens before both checks pass.

## 6 Supervision

A run with claims (and its cleanup run) gets `VERA_REGISTRY_SHA256`, the approved registry's hash, which the program
checks before it opens anything (REQ-SEC-80fa1675). It also gets `VERA_RUN_CONTROL` = `<lease folder>/runs/<run id>/`, created empty before spawn and removed
after the run. The program writes `state.json` there (atomically) as it advances:
`{format: 1, phase: "start"|"identified"|"acting"|"cleaning"|"released", physical: "unchanged"|"pending"|"confirmed"|"unknown"}`.

- Stop, timeout, abort, session stop, workbench close and app exit write `<control>/stop`, then kill the tree after
  `grace` seconds unless the program exited.
- After the program exits (any reason), cleanup is needed when a claim actuates (request risk `device-write` or
  `irreversible`) and the program did not report `phase: released` with `physical` `confirmed` or `unchanged`. Then the
  runner starts, once and without approval, the same executable with the program's prefix and `cleanup` arguments plus
  `<option> <alias>` for each claimed alias, its own control folder and `VERA_CLEANUP_OF=<run id>`, under
  `cleanupTimeout`; its output is appended to the run's log after a `[VERA] cleanup` line.
- Physical state of the run: `unchanged` for a read-only run without a report; the program's reported state when no
  cleanup was needed; `confirmed` when the cleanup reported `released` and `confirmed`; else `unknown`. `unknown`
  writes a marker for every claimed key; a reported `confirmed` clears them. The log gets one
  `[VERA] Physical state: <state>` line; the result carries `physical` and `cleanup` (`none`, `separate`, `failed`), also in
  program_stop and in program_output's final read of a background run.
- Leases are released after cleanup. A second Stop during cleanup changes nothing; the cleanup keeps its own timeout.
- Limit: when the whole host process is lost, nothing runs the cleanup; the next claim finds a stale lease and records
  `unknown`.
