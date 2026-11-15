# Verification fixtures

These fictional inputs support tests, retrieval evaluation and package smoke checks.
They are not application resources and are not included in installers.

`workbenches/demo-board/` is the fictional VERA-DEMO-01 verification project, including
PDF/Markdown documents, notes, pinout, boot log and replay input. Tests copy it
into isolated workspaces before opening or modifying it.
`workbenches/demo-board.json` records its identity and the complete fixture file inventory.

`npm run make:demo-pdfs`, run from `05_Software`, regenerates the three fixture PDFs
from `workbenches/demo-board/sources/`.

`echo-program/echo.mjs` is the program the plugin runner tests start through each compiled
ProcessHost; `ECHO_MODE` selects echoing its arguments and working directory, its environment,
reading stdin, flooding output, ANSI output, or starting a grandchild that runs until killed.

`plugins/echo-tools/` is an installable plugin for the agent's program tools: program `echo` runs
`echo.mjs` (prefix `${pluginDir}/echo.mjs`), its rules cover every risk level, and it ships the skill
`echo-guide`. Core session tests, the CLI integration test and the native e2e install it.

`electrical-model/two-pump-panel.json` is a fictional electrical project model (format 1): one LV
source, the main board, two pump feeders and a lighting circuit with their breakers, cables, contactors,
the PLC I/O, the level transmitter and tags. Its values cite a made-up brief, not a product datasheet.

`electrical-network/network-a.json` is a fictional radial LV network (630 kVA Dyn11 transformer, main and
sub-board, a motor, lighting and a socket circuit) for the electrical-network engine; `tbl-test-cu-pvc.json`
is a fictional cable table with values chosen for the tests. `tbl-nexans-nym-j.json` holds real values typed from
the public Nexans NYM-J product page (read 2026-11-15, cited in the file): DC resistance and the 30 °C current
ratings of each cross-section; it has no correction factors, reactance or k because the page gives none.

The remaining folders contain document extraction samples, replay scripts,
translation checker cases and retrieval questions/model manifests.
Existing user workbenches and profiles are never part of this directory.

`app-data/` holds current-format application data: `credentials.json`, `workbench.yaml`
and `interrupted-sessions.json`, the crash-recovery fixture with interrupted sessions.
Every stored format is version 1 during development, so there are no previous-version
or newer-version fixtures.
