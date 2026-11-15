# electrical-network

Load balance, cable sizing, voltage drop and fault currents for radial low-voltage networks in VERA's electrical
project model.

- **The tool `electrical_network`** is VERA's own write tool, offered while a plugin of the electrical or
  automation ecosystem is loaded (never in read-only sessions). It reads `electrical-automation-model.json` and
  one cable table, calculates the network fed by one source and stores a new
  `electrical-automation-results/<run-id>/result.json` after approval, like a file write. It never changes the
  model, a schematic or an approved selection. `electrical_model` view `report` shows a stored result again with
  its freshness: a result whose inputs changed in the model is stale.
- **Scope**: one transformer (Dyn for earth faults) or LV supply point, three-phase AC up to 1000 V, radial feeds
  (board, busbar, circuit, load, motor), one cable per circuit. Meshed networks, ties between busbars, parallel
  cables, generators, UPS, PV and DC are reported as not evaluated or block the run.
- **Method** (shown in each result): load balance per scenario with demand, load and simultaneity factors; phase
  and neutral currents; design currents; cable cross-sections checked or proposed from the table with its
  temperature and grouping factors (next tabulated point, never interpolated); voltage drop sqrt(3)·I·L·(R cos φ +
  X sin φ) or 2·I·L·(…) from the source's LV terminals; fault currents by the impedance method with the c factors
  and the transformer correction KT of IEC 60909-0:2016: Ik3 max and peak at boards and circuit origins, Ik3 min
  and, in TN systems, Ik1 min at circuit ends; with a fault duration, the adiabatic withstand S ≥ I·√t/k.
- **Cable tables** are workbench files `electrical-automation-tables/<id>.json` (kind `vera-cable-table`, format
  1): the cable's material, insulation and temperatures, conductor resistance and reactance per cross-section,
  ratings per installation method and loaded conductors, and the temperature and grouping factors, all from one
  cited source with its licence terms. VERA ships no IEC 60364-5-52 table: type the values your project may use
  from a manufacturer datasheet or a standard you hold, with the page or table.
- **Skill**: `network-sizing`, the workflow from model data to a reviewed result.

Results are preliminary engineering support: no verified design, no conformity statement and no safety
certification. Protective device selection, disconnection times and selectivity belong to protection
coordination. The exact formats are the specifications REQ-DATA-42ce122f and REQ-DATA-06c0bd54 in VERA's
`.agentic/specs/`.
