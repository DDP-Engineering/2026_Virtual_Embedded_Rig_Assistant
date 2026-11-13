# parts-search

Evidence-based component selection for VERA.

- **Supplier search** is VERA's own tool `parts_search`, not a plugin program: supplier credentials stay in VERA
  (Settings > Parts search, or environment variables for the command-line interface) and never reach a plugin
  program, the model, the workbench configuration or a log. The tool is offered only when this plugin, installed
  from the official catalog, is enabled for the workbench, Web access is on and at least one supplier is enabled.
  Suppliers: Mouser (API key), DigiKey (client ID and secret), TME (API token and application secret), Farnell
  (API key and store) and Rutronik (API key from your Rutronik contact). Every search is live; VERA stores no
  supplier result, as the suppliers' terms require.
- **`parts-compare`** (`scripts/parts_compare.py`, standard library) compares candidates offline: hard constraints
  first, preferences second; only confirmed datasheet values with a page or table, under the constraint's
  conditions, are evidence. It writes `comparison.json`, `comparison.md` and a proposed `bom.csv` to
  `electronics-results/<run-id>/`, and never orders anything or changes a project.
- **Skills**: `component-selection` (the workflow) and `component-families` (checks per family).

Exact interfaces: the specifications REQ-DATA-9fd50acb (search) and REQ-DATA-6b26f2a5 (comparison) in VERA's
`.agentic/specs/`, and `parts-compare compare --help`.

Environment variables of the command-line interface: `MOUSER_API_KEY`, `DIGIKEY_CLIENT_ID` and
`DIGIKEY_CLIENT_SECRET`, `TME_API_TOKEN` and `TME_API_SECRET`, `FARNELL_API_KEY`, `RUTRONIK_API_KEY`.

TME data: powered by TME.eu Data; no guarantee of data accuracy.
