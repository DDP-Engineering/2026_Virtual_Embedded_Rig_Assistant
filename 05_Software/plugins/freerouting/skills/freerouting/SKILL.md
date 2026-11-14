---
name: freerouting
description: Autoroute the unrouted connections of a KiCad 10 board candidate with Freerouting, offline, then apply and verify the routes with kicad-layout. Use when the user wants a board, or some of its nets, routed automatically.
---

# Autorouting with Freerouting

Work on a kicad-layout candidate, never on the source board.

1. Open a candidate if none is open: `kicad-layout-tool open --board <board>.kicad_pcb`. Place the parts first;
   Freerouting only routes.
2. Route: `freerouting-tool route --run electronics-results/<run-id>`. Add `--nets VIN,GND` to route only some
   nets, and `--max-passes` / `--max-seconds` to bound the run (defaults 20 passes, 600 s). Existing and locked
   tracks and vias stay as they are.
3. Read the printed result: `freerouting.unrouted` (Freerouting's own count), `operations` (new tracks and vias)
   and `next`, which is the kicad-layout command that applies the request. Run that command:
   `kicad-layout-tool edit --run electronics-results/<run-id> --request <request.json>`.
4. Judge the edit's report: DRC, `unconnected.after` and the objectives come from KiCad, not from Freerouting. Show
   the report and previews. Apply with `apply_candidate` only when the user asks and the objectives passed.

Refusals (exit 2): `usage`, `run` (not a kicad-layout run folder), `changed` (the candidate changed since its last
save: open a new candidate), and `rules`. `rules` means the project has custom DRC rules that Freerouting cannot
follow. Tell the user, and route only if they accept, with `--allow-custom-rules`.

Failures (exit 3): `setup` (a program is not installed), `kicad` (the DSN export failed), `router` (Freerouting
failed or ran out of time: raise `--max-seconds` or route fewer nets), and `ses` (the session file cannot be read).
No request is written and the candidate is unchanged.

Freerouting is not an optimizer. Its result is one routing, not the best. If connections remain, report them;
route them by hand with kicad-layout `track` and `via` operations, or move parts and route again.
