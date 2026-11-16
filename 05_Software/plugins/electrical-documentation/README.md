# electrical-documentation

Project documentation on VERA's electrical project model: material, connection (wire), cable, terminal, label and I/O
lists with a table of contents, cross-checked against each other and traceable to their sources, a change report and
CSV, XLSX and PDF exports.

- **The tool `electrical_documentation_check`** (write) reads the model, a stored `panel_engineering_check` result with
  its panel file and the `motor_drives` result it names, the `.qet` schematics named in the request (each with its
  motor) and, for PLC tags, an explicitly named tag file (CSV with columns `name`, `address` and optional `dataType`,
  `comment`), and stores one result in `electrical-automation-results/<run-id>/`: the seven lists, each row with a key
  and a source naming the file and its sha256; checks of labels, conductor numbering, cross-references, wire ends and
  duplicate connections per schematic, schematic labels against panel tags and model references, the assembly
  connections, cable ends, terminal points, the device - terminal - I/O address - tag chain and the tag file; the
  logical revision only from the model `document` the request names (attributes `revision`, `date`, `author`); with
  `previousRun` a change report (rows added, removed or changed, model objects changed, source files changed or
  missing, stored results that are stale).
- **The tool `electrical_documentation`** (read) - `list`: one stored list page by page; `changes`: what changed since a
  run (model objects, source files, stale results).
- **The tool `electrical_documentation_export`** (write) writes `documentation-<list>.csv`, `documentation.xlsx` (one
  sheet per list) or `documentation.pdf` (contents page and one section per list) next to the run's result, as a new
  file; each starts with project, document, revision (or `not stated`), run, generated time and model sha256.
- **Skill**: `electrical-documentation`, from a panel check to checked lists and their exports.

Differences are reported, never repaired in the model, the panel file, the schematics or the tag file. No PLC project
or SDK is read; nothing is printed, ordered or sent. The exact formats are the specifications REQ-DATA-aa83ed5c and
REQ-DATA-06c0bd54 in VERA's `.agentic/specs/`.
