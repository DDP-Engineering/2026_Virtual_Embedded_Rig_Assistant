# industrial-catalog

Documented selection of low-voltage equipment for VERA's electrical and automation work.

- **Catalogs** are workbench files `electrical-automation-catalogs/<id>.json` (kind `vera-industrial-catalog`,
  format 1). An item is the manufacturer's order code in a family, with an optional variant (for example the
  coil voltage), its accessories (other items, referenced) and the distributor SKUs with the time they were
  captured. Every parameter is a value with a unit from VERA's electrical unit table, its conditions
  (`utilisationCategory: AC-3`, `voltageMax: 440 V`), its source (title, publisher, revision, link, licence
  terms) with page or table, and a status: `confirmed` (checked against the source) or `extracted` (not yet
  checked; it never decides a requirement). Write or import a catalog with an ordinary approved file write;
  VERA reads it strictly and lists a broken file without stopping the others.
- **The tool `industrial_catalog`** is VERA's own read tool, offered while a plugin of the electrical or
  automation ecosystem is loaded: `list`, `items` (by exact order code or distributor SKU, and the match says
  which), `select` (firm requirements: eligible, unknown or eliminated, each value cited) and `coordination`
  (entries for exactly the given products under the given conditions). It reads files only: no live prices,
  no orders, no credentials.
- **Live supplier data** stays with the parts-search plugin (`parts_search`, keys in VERA's credential
  store). This plugin stores no supplier keys and no supplier results.
- **Skill**: `industrial-selection`, the selection workflow.

Results of electrical plugins cite the catalog as `catalog: {id, version}`. A selection is a proposal: a change
to the project goes through `electrical_model_change` and the engineer's approval; nothing is replaced in a
schematic. The exact format is the specification REQ-DATA-d7e27def in VERA's `.agentic/specs/`.

Do not copy whole vendor catalogs or standard tables into a catalog: type the values a project needs from
documents you may use, and record the terms in each source's `license`.
