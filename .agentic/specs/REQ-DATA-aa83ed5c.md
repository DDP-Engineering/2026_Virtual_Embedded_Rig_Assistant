# REQ-DATA-aa83ed5c - Electrical documentation lists, cross-document checks and exports

Electrical documentation derives the project's lists from what is already identified - the electrical model, a stored
panel_engineering_check result with its panel file, the motor_drives result that result names, the .qet schematics the
request names and, for PLC tags, an explicitly named tag file - checks that the documents agree and stores one result.
Plugin `electrical-documentation`, producer `electrical-documentation` / `documentation`, engine `vera-documentation`
1.0.0. Differences are criteria; no source file is changed. Nothing is printed, ordered or sent.

## Behavior

### Request (`electrical_documentation_check`, write)

Strict object: `panelRun` (run ID of a panel_engineering_check result), `schematics?` (<= 8, `{path *.qet <= 120, motor?}`),
`document?` (ID of a model `document` object), `tags?` (workbench path of a tag file, `*.csv`, <= 120), `previousRun?` (run ID of
an earlier documentation result). Refused before any change is prepared, with the input named: no model; the panel run
missing, invalid or of another producer or without a panel section; the panel file it names unreadable; a schematic
unreadable, named twice or its `motor` not a model motor; `document` not a model document object; the tag file invalid; the previous
run missing, invalid or not a documentation result. A stale panel or motor_drives result, a changed panel file or a
schematic other than the one the panel result compared is not refused: it is a failed `source:*` criterion and makes
the run `incomplete`.

### Sources and rows

Each row has `key` (stable within its list), `cells` (strings or null, one per column) and `source`, one of:
`model:<path>@sha256:<hex>#<id>[,<id>...]`, `panel:<path>@sha256:<hex>#<tag>`, `panel-result:<run>#bom/<tag>[,<tag>...]`,
`qet:<path>@sha256:<hex>#folio<n>/conductor<i>`, `qet:<path>@sha256:<hex>#<label>`, `tags:<path>@sha256:<hex>#line<n>`,
or `result:<run>`; several joined by ` + ` when a row combines them (at most 1000 characters). Each list carries the
sha256 of `canonicalJson(rows)`. A list holds at most 2000 rows, cells and sources at most 1000 characters and keys at most 300 (cut with a hash
suffix, made unique with `#2`, `#3`...); anything cut is a failed `limits:<list>` criterion.

Device names: a schematic label resolves, in order, to the panel equipment with the schematic's motor and
`schematicTag` equal to it, to a panel equipment or strip with that tag (no motor or the same motor), to the model
object with that ref; otherwise it stays as drawn and fails `device-refs:<path>`. A conductor end is
`<device>:<terminal name>` (the definition's terminal name).

### Lists (fixed columns)

- `materials`: orderCode, manufacturer, name, quantity, tags, catalog, item. The panel result's BOM grouped by
  (catalog, item); lines without item stay one row each with orderCode null. Key `item:<catalog>/<item>` or `tag:<tag>`.
- `connections`: wire, from, to, potential, folio, section, color, cable, schematic. One row per conductor of each
  schematic, ends in document order. Key `<path>#<from>|<to>` with the two ends sorted.
- `cables`: cable, circuit, from, to, crossSection, length, installation, state. One row per model cable whose
  circuit the panel's board feeds; `from` the panel-side ends (terminals of panel strips or panel devices), `to` the
  field-side ends (the fed motor or load or its terminals), state `ok`, `excluded: <reason>` (panel `excluded`) or the
  problems. Key = cable ref.
- `terminals`: strip, point, wire, inside, outside, cable, io, origin (`model`, `schematic` or `both`). One row per model terminal `<strip>:<point>`
  of a panel strip (outside = the far ends of its cables, io = the I/O it connects) and per schematic terminal point of
  an element labelled with a strip tag (wire = the conductor numbers, inside = the other ends). Key `<strip>:<point>`
  (a point drawn and modelled is one row with both sources).
- `labels`: text, kind, at, schematic. Device labels (panel BOM tags, kind `device`), wire-end labels (two per numbered
  conductor, kind `wire-end`, at = the end), cable labels (two per cable with ends, kind `cable`), strip labels (kind
  `strip`). Key `<kind>:<text>@<at>`.
- `io`: address, signal, module, device, terminal, tag, tagFile, state. One row per model io, plus one per tag-file entry
  that matches no model tag (state `only in the tag file`). Key = address, or `file:<name>`.
- `contents`: list, title, rows, sha256, revision. One row per list above. Key = list.

### Checks (criteria)

- `source:panel-result`, `source:motor-drives` (current or stale against the model), `source:panel-file` (same sha256
  as the panel result compared), `source:schematic:<path>` (pass when the panel result compared this file with this
  sha256; unknown when it did not compare it; fail when it compared another sha256), `source:tags` (read; not-evaluated
  without a tag file).
- Per schematic (reusing the CAD-01 project checks): `labels:<path>`, `numbering:<path>`, `cross-references:<path>`;
  `wire-ends:<path>` (every conductor resolved at both ends; in a numbered project every conductor numbered; unknown in
  an unnumbered one); `duplicates:<path>` (two conductors joining the same two terminals); `device-refs:<path>`.
- With a schematic motor whose assembly the motor_drives result holds: its `connection:*` and `assembly-devices`
  checks (CAD-01 `assemblyChecks`) as `assembly:<path>:<id>`.
- `cable-ends`: every non-excluded cable has a circuit, a panel-side end, a field-side end at the motor or load its
  circuit feeds, and every panel strip it lands on with a `motor` is that circuit's motor.
- `terminal-points`: every model terminal ref is `<strip>:<point>` of a panel strip or of a terminal of an io module;
  numeric points are within the strip count; no point is used by two terminal objects.
- `io-chain`: for every io - a module device contains it and the module is in the panel (equipment `model` ID or tag =
  ref); a field device (`signals` to the io for DI/AI, `controls` from the io for DO/AO, either otherwise); a terminal
  (`connects` terminal -> io) per `terminal-points`; exactly one tag (`tag-of`). Unknown signal kinds do not fail.
- `tag-file`: every model tag (by exact name) is in the file by name with the same address (normalized: `%` removed, spaces removed,
  upper case); no file entry without a model tag; no address twice in the file. Not-evaluated without a file.
- `revision`: see below. `limits:<list>`: only when a list or one of its cells, keys or sources is cut.

Status `completed` unless a `source:*` criterion fails (then `incomplete`); `preliminary` is true unless every
criterion passes. Inputs: snapshots of every model object and relation a list read, plus the project.

### Section

`documentation {project {id, name}, revision {value, document, date, author}, panel {run, path, sha256}, lists (the
seven lists in the order above, each {list, title, columns, rows <= 2000 {key, cells, source}, sha256}), changes?}`.
Each list's columns must equal its fixed columns and each row hold one cell per column; `intermediate` holds
`rows:<list>` counts.

### Revision

From the request's `document` object: attributes `revision`, `date`, `author` (strings), never derived or invented.
Without `document` or without `revision` the revision is null (shown `not stated`) and `revision` is unknown. Fail when
a schematic folio states a non-empty `indexrev` different from it, or when `previousRun` has the same non-null revision
and any list sha256 differs. Pass otherwise.

### Change report

With `previousRun`: `changes {previousRun, previousRevision, rows [{list, key, change added|removed|changed}] (<= 500),
objects {changed, removed} (resultFreshness of the previous run against the model now), sources [{source, state
changed|missing}] (sources of the previous run's rows whose file sha256 is now different or absent), results [{runId,
plugin, freshness stale|invalid}] (<= 100, every stored result not current now)}`.

The read view `list {runId, list, offset?}` returns 100 rows from the offset with the columns, total and sha256;
`changes {runId}` returns the same objects, sources and results for a stored run against now, plus
`stale` (true when anything is listed for that run), writing nothing.

### Tag file

UTF-8 CSV (an initial byte-order mark is skipped), at most 1 MiB and 5000 data rows, comma separated, fields quoted
with `"` and `""` inside quotes, CRLF or LF; text after a closing quote and a quote inside an unquoted field are refused. The header is distinct names from `name`, `address`, `dataType`,
`comment`; `name` and `address` required. A data row needs a non-empty name (<= 128) and address (<= 64) and as many
fields as the header; blank lines are skipped. Anything else refuses the run: `Invalid tag file <path>: line <n>:
<reason>.`

### Exports (`electrical_documentation_export`, write)

`{runId, format csv|xlsx|pdf, list?}`: `csv` needs `list` and writes `documentation-<list>.csv`; `xlsx` writes
`documentation.xlsx` with one sheet per list (in list order), `pdf` writes `documentation.pdf`. Files go into
`electrical-automation-results/<runId>/`, new only: an existing file or a result of another producer is refused. The
controlled header, in every file and on every PDF page: Project (name and id), Document (list title), Revision (or `not
stated`), Run, Generated (the run's finishedAt), Model sha256; CSV and XLSX add Sources. CSV: `key,value` header lines,
an empty line, the column row and the rows (CRLF; cells starting with = + - @ tab or CR get a leading `'`; fields with
`"`, `,`, `;` or line breaks quoted). XLSX: Office Open XML written with fflate (inline strings, bold header, header values
merged across the table, wrapped source column, frozen column row, auto filter, column widths, printed A4 landscape
fit to width). PDF 1.4: A4 landscape, Courier/Courier-Bold (WinAnsi; other characters `?`),
a contents page listing each list with its first page, one section per list with the column row repeated on every
page, cells wider than their column cut with `~`, page `n / total` in the footer.

## Errors

Refusals are thrown before preparing a change; the export refuses an existing file again at apply time (write-queue
before-hash). Invalid stored sections are reported like other invalid results.

## Open decisions

None. Real numbered QElectroTech projects and vendor tag exports were not available; the reference uses the CAD-01
candidates numbered by a fixture generator and a declared generic tag file.
