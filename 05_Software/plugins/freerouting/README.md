# freerouting

Local autorouting of a KiCad 10 board candidate with [Freerouting](https://github.com/freerouting/freerouting) 2.5.0
(GPL-3.0), run on an Eclipse Temurin 25 Java runtime (GPL-2.0 with Classpath Exception). VERA downloads both,
pinned by SHA-256, when you install the plugin's programs; no Java needs to be installed. KiCad 10 is found, never
installed. It works together with the kicad-layout plugin, which it requires.

## Flow

1. `kicad-layout-tool open --board boards/x.kicad_pcb` opens a candidate copy in a run folder
   (`electronics-results/<run-id>`).
2. `freerouting-tool route --run electronics-results/<run-id>` does the following:
   - exports a Specctra DSN from a copy of the saved candidate with KiCad's own Python;
   - marks the existing tracks and vias as protected, so Freerouting keeps them;
   - runs Freerouting headless with a pass and time budget;
   - writes `electronics-results/<run-id>/freerouting/NNN/` with `board.dsn`, `board.ses`, `freerouting.log`,
     `request.json`, `result.json` and `report.md`.
3. `kicad-layout-tool edit --run electronics-results/<run-id> --request .../request.json` applies the new tracks and
   vias to the candidate through KiCad. It runs all of kicad-layout's checks (nets, layers, outline, unchanged items),
   then DRC with the unconnected count.
4. `apply_candidate` writes a passing candidate over the source, after your approval.

Options of `route`:

- `--nets A,B` keeps only those nets' new routes in the request.
- `--max-passes N` sets Freerouting's routing passes (1-100, default 20).
- `--max-seconds S` sets the time budget (1-3000, default 600). When it runs out, Freerouting is stopped and no
  request is written.
- `--allow-custom-rules` routes even though the project has custom DRC rules (`.kicad_dru`). Freerouting cannot
  follow them. Without this option the route is refused and the rules are named. DRC after the edit still checks them.

## Offline

Freerouting runs with a hosts file that resolves only `localhost`, so its version check and analytics cannot reach
the network. Its GUI, API and MCP servers are off, and its settings and logs stay in the run's `freerouting/NNN/home`
folder. The board never leaves the computer.

Exit codes: 0 completed, 2 refused, 3 failed. The candidate and state.json are never written by freerouting-tool.
