# freerouting-tool route (REQ-FUNC-2a80da7f)

Plugin `05_Software/plugins/freerouting/`, program `freerouting-tool` (uses `java`, `freerouting`, `kicad-cli`).
Freerouting 2.5.0 jar and Eclipse Temurin 25.0.5+8 JRE are VERA downloads pinned by SHA-256 (RULING-001); the jar
is a `file` program (REQ-PLAT-e093fdbd): verified, never run by itself.

## 1. Command

`freerouting-tool route --run DIR [--nets A,B] [--max-passes 1-100 (20)] [--max-seconds 1-3000 (600)]
[--allow-custom-rules]`. Prints one JSON document (result.json). Exit 0 completed, 2 refused, 3 failed. The
candidate and state.json are only read.

## 2. Checks before routing (exit 2)

- `usage`: arguments, pass and time bounds.
- `run`: DIR is not inside the working directory, or has no kicad-layout state.json whose candidate is a
  `.kicad_pcb` inside DIR.
- `changed`: the candidate's SHA-256 differs from state.json's (unsaved by kicad-layout-tool).
- `rules`: `<stem>.kicad_dru` names `(rule ...)` entries; refused with their names unless `--allow-custom-rules`
  (then a warning). The DSN carries net classes (widths, clearances, vias), not custom rules.

## 3. Routing

Work folder `DIR/freerouting/NNN/` (next number). The candidate's `.kicad_pcb`, `.kicad_pro` and `.kicad_dru` are
copied to `board/`, KiCad's Python (Windows: `python.exe` next to kicad-cli; Linux: `/usr/bin/python3` with
`pcbnew`) runs `export_dsn.py` (SWIG `ExportSpecctraDSN`) into `board.dsn`; `board/` is removed. In the DSN's
wiring section every `(type route|normal)` becomes `(type protect)`: Freerouting keeps existing copper (locked
copper is already `fix`).

Freerouting: `java -Djdk.net.hosts.file=<work>/hosts -Duser.home=<work>/home -Djava.awt.headless=true -cp <jar>
app.freerouting.cli.FreeroutingCli -de board.dsn -do board.ses --router.autorouter.max_passes=N -mt 1
--gui.enabled=false --usage_and_diagnostic_data.disable_analytics=true --api_server.enabled=false
--mcp_server.enabled=false`; the hosts file resolves only localhost (its GitHub version check and analytics cannot
connect; probed: zero sockets). Output goes to `freerouting.log`. Past `--max-seconds` the process is killed.

## 4. SES to request

SES `routes` resolution `um R`: millimetres = value / (1000 R), KiCad's Y = -Y. In `network_out`, wires and vias
typed `protect` or `fix` are existing copper and skipped; for the nets of `--nets` (all when absent):
- each wire path -> `{"op":"track","net","layer","width","points"}`, split into tracks of at most 64 points that
  share their end points;
- each via -> `{"op":"via","net","at","diameter","drill"}` from its padstack name `..._<diameter>:<drill>_um`.

`request.json` = `{"format":1,"candidate":<state sha256>,"units":"mm","operations":[...]}` (at most 1024
operations, kicad-layout's limit), applied by `kicad-layout-tool edit --run DIR --request <request.json>`.

## 5. Failures (exit 3, no request.json)

`setup` (a used program's path is missing), `kicad` (DSN export), `router` (no SES, budget exceeded, more than 1024
operations, candidate changed meanwhile), `ses` (unreadable session), `output` (a file). result.json and report.md
in the work folder record the failure.

## 6. result.json

`format` 1, `kind` `freerouting-result`, tool, toolVersion, operation `route`, runId (`<run>/freerouting/NNN`),
started, ended, status, problems; on success also `candidate` (path, sha256), `freerouting` (version from the jar
name, java version, `unrouted` = Freerouting's last reported count), `budget`, `elapsedSeconds`, `protected` (wires
and vias marked), `nets` (routed), `operations` (tracks, vias, trackLength mm), `request`, `artifacts`, `warnings`,
`next` (the kicad-layout command). Completeness is judged by kicad-layout's DRC and unconnected count after the
edit, not by Freerouting's log.
