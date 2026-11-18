# Freerouting autorouter (local)

Freerouting autorouter lets the agent autoroute a KiCad 10 board candidate on this computer with Freerouting 2.5.0. It exports a Specctra DSN from the saved candidate of a kicad-layout run, routes it offline with a finite pass and time budget while keeping existing and locked copper, and turns the new tracks and vias into a kicad-layout request. kicad-layout then applies that request to the candidate and checks it with DRC. Freerouting runs with its online features switched off, and the source board changes only when you approve applying a passing candidate.

## What it needs

- **Freerouting** 2.5.0 and an Eclipse Temurin 25 Java runtime: **Install dependencies** on the plugin page downloads both and checks their SHA-256. No Java needs to be installed.
- **freerouting-tool**: a script in the plugin, installed automatically.
- **KiCad 10**, which you install yourself from https://www.kicad.org/download/ (on Ubuntu from the KiCad 10 PPA); then use **Check dependencies**. VERA never installs KiCad.
- The **kicad-layout** plugin, which opens the candidate and applies the routes. **Install with dependencies** adds it.
- A board with its parts placed: Freerouting only routes.
- No configuration parameters.

## How to use it

- "Open a candidate of boards/sensor.kicad_pcb and autoroute it." (skill `freerouting`)
- "Route only the VIN and GND nets on the open candidate."
- "Route again with a 20-minute budget."
- "Apply the routes, run DRC and show me the report and previews."
- "Apply the candidate to the source board."

The agent reports how many connections remain unrouted; DRC and the unconnected count come from KiCad, not from Freerouting. Freerouting is not an optimizer: its result is one routing, not the best one. Remaining connections can be routed by hand with kicad-layout or after moving parts.

## Risk and approvals

- Safe, runs without asking: `freerouting-tool route`, which works on a copy of the candidate and writes only into the run folder, and KiCad version or help.
- Blocked: running Java, the Freerouting archive or other `kicad-cli` commands directly, because `kicad-cli` rewrites files in the project folder it reads.

Applying the routes to the candidate and applying the candidate to the source board are kicad-layout steps; writing the source board waits for your approval.

## Limits

- Windows x64 and Linux x64.
- A project with custom DRC rules (`.kicad_dru`) is refused unless you accept routing without them; Freerouting cannot follow them, and DRC after the edit still checks them.
- When the time budget runs out, Freerouting is stopped and no request is written.
- Freerouting runs with its version check, analytics, GUI and servers switched off; VERA does not otherwise block its network access.
- Reference: https://github.com/freerouting/freerouting
