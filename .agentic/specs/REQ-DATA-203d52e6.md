# EPLAN exchange adapter (plugin eplan)

Requirements: REQ-DATA-203d52e6 (profile), REQ-DATA-e601f922 (tables), REQ-FUNC-f415fdc8 (reconcile),
REQ-FUNC-0103d4c6 (candidate), REQ-REL-f8d51ff3 (refusals), REQ-FUNC-8b2ae38f (check result), REQ-REL-803299e7
(outcome), REQ-SEC-8fcf4dc1 (helper actions), REQ-REL-cafafa22 (helper refusals), REQ-REL-a897a77d (helper failure and
Stop), REQ-TEST-ba396827 (fixtures).

Declared target: EPLAN Electric P8 2025 on Windows x64. Every EPLAN detail below comes from the public EPLAN API 2025
documentation, https://www.eplan.help/en-us/Infoportal/Content/api/2025/ (pages dated 17.02.2025, read 2026-11-16);
the page names are given in brackets. Nothing was confirmed on an installation: see "Not confirmed".

## 1 Profile

`electrical-automation-eplan/<id>.json`, UTF-8 JSON, at most 64 KiB, strict (unknown keys refused, no defaults):

```json
{
  "kind": "vera-eplan-profile",
  "format": 1,
  "id": "epl-plant-m",
  "title": "Plant M in EPLAN",
  "target": { "product": "EPLAN Electric P8", "version": "2025", "platform": "windows-x64" },
  "project": { "link": "C:\\EPLAN\\Projects\\PlantM.elk" },
  "tables": {
    "devices": { "columns": { "tag": "Device tag", "part": "Part number", "description": "Function text", "vera": "VERA ID" }, "partPrefixes": { "Schneider Electric": "SE." } },
    "terminals": { "scheme": "VERA-terminals", "language": "en_US", "columns": { "strip": "Terminal strip", "point": "Terminal" } },
    "connections": { "scheme": "VERA-connections", "language": "en_US", "columns": { "from": "Source", "to": "Target", "wire": "Connection designation", "crossSection": "Cross-section", "color": "Color" } }
  }
}
```

- `id`: an electrical ID (lowercase words joined by `-`), equal to the file name.
- `target`: exactly the three literal values above.
- `project.link`: an absolute Windows path `X:\...\name.elk` (the project link file [CreateOpenProject]), at most 240
  characters, without spaces, quotes or `/:*?<>|` after the drive, so that the helper can pass it in the documented
  `/PROJECTNAME:<path>` form without quoting.
- `tables.devices` (required): `columns.tag` required; `part`, `description`, `vera` optional; `partPrefixes` optional
  (catalog manufacturer -> 1..16 characters, e.g. `{"Schneider Electric": "SE."}`, at most 32) is put before the
  order code of that manufacturer's items; the EPLAN part must equal prefix + order code.
  The device list is exported and imported with `devicelist ... /FORMAT:XDLCsvImporterExporter` ("Uses semicolon as
  separator") [devicelist, XDLCsvImporterExporter].
- `tables.terminals` (optional): `columns.strip` and `columns.point`, nothing else; `tables.connections` (optional):
  `columns.from`, `columns.to` required, `wire`, `crossSection`, `color` optional. Both are written
  by `XMActionDCCommonExport` with the user's configuration scheme `scheme` and language `language` as TXT
  [XMActionDCCommonExport]; the scheme must write semicolon-separated text with a header row (a profile declaration:
  the TXT layout is not documented).
- Header names: 1..100 characters, no control characters, no `;` or `"`, unique within a table. Scheme names:
  `[A-Za-z0-9_.-]{1,64}`; language `[a-z]{2}_[A-Z]{2}`.
- Refusal: `Invalid EPLAN profile <id>: <path>: <message>` lines, at most 20.

## 2 Tables

`parseEplanTable(text, path, table, columns)`: UTF-8 (fatal decoding; a leading U+FEFF is accepted and kept), records
split by the documentation tag-file reader `csvRecords` with delimiter `;` (RFC 4180 quoting: `""` inside quotes, no
quote inside an unquoted field, nothing after a closing quote), CRLF or LF. The first record is the header; each mapped
header occurs exactly once; every record has the header's field count; one empty final line is allowed; no control
character other than CR/LF in a record (TAB refused too); at most 20 000 records and 4 MiB. Each record keeps its line,
all cells and its exact source text including the line ending. Unmapped headers are listed. Refusal:
`Invalid EPLAN <devices|terminals|connections> table <path>: line <n>: <reason>.`

Device tags follow the documented form `=AP+PT1-X4` [NavigatingTheDatamodel, DMObjectsFinder example]: `eplanTag(text)`
splits `(=plant)*(+location)*-identifier`; the plant and location parts contain none of `=+-`; the identifier is the
rest after the first `-` (it may contain `-`, e.g. `-KM1-M1`). A connection end is `<device tag>:<pin>`, split at the
last `:`. A tag that does not match is a row problem (`not a device tag`), never guessed.

## 3 Reconcile (view `reconcile`, criteria of eplan_check)

VERA devices are the documentation run's `labels` rows of kind `device` (text = tag), with the model object whose `ref`
equals the tag. An EPLAN device row matches by its `vera` cell (a model object ID whose ref is a documented device) or
else by identifier equal to the tag; two rows with the same identifier or VERA ID are `duplicate`. Part numbers: the
materials row whose `tags` list holds the tag gives the order code and manufacturer; the EPLAN part must equal the
manufacturer's prefix + the order code; an
empty EPLAN part or a device without material is `unknown`, not a difference. Terminals: the set of (strip identifier,
point) against the rows of the terminals list whose strip is a panel strip (labels of kind `strip`); PLC module points
(`A1:I0.0`) are not EPLAN terminals. Connections: each EPLAN connection's unordered pair of ends
(`identifier:pin`) against the connections list (`from`, `to`); a matched pair with another wire number differs.
Result: per kind `matched`, `differs` (field, eplan, vera), `eplanOnly`, `veraOnly`, `problems`; operations
`update-object {id, attributes {eplanTag: <full device tag>}}` for matched devices whose model object records no or
another `eplanTag` (proposed, never applied; applied with `electrical_model_change`).

## 4 Candidate (`eplan_change` action `candidate`)

Request `{action: "candidate", profile, base, sha256, documentationRun, path}`; `base` and `path` are workbench `.csv`
paths, `path` must not exist. Built from the base device table:

- records of matched devices: the part cell becomes prefix + order code when the order code is known and the EPLAN
  part is empty or differs; an empty `vera` cell becomes the model object ID; a record with no change is copied as its
  raw source text;
- a changed record is re-serialised: cells joined by `;`, a cell quoted (`"` doubled) when it holds `;`, `"`, CR or LF,
  the original line ending kept;
- documentation devices with no EPLAN record and a known order code or model object are appended: tag `-<tag>`, part,
  `vera` = model object ID, every other cell empty, line ending of the header;
- EPLAN-only records are kept; nothing is removed; the header and BOM are kept.

Refused when the profile has neither a `part` nor a `vera` column. Report: `updated` [{tag, fields}], `added` [tag],
`unchanged` count, `eplanOnly` [tag], `notTransferred`: connections and terminals (the device list import carries
neither; the external-editing import needs an .edc data configuration file whose format is not documented
[XMActionDCImport]), macros (not documented publicly, generation needs a macro project [generatemacros]), the
description and other VERA fields the profile does not map. The base sha256 is checked when the candidate is prepared (a changed
base is a conflict); the file is a new file through `commitChange`.

## 5 Helper eplan-tool (PEP 723, standard library only)

Commands: `--version`, `--help`, `plan export|import ...` (prints the command lines, starts nothing),
`export --profile <json> --out <new dir> [--outcome <import outcome.json>]`,
`import --profile <json> --candidate <csv> --sha256 <hex> --copy <new .elk> --out <new dir>`. Paths are relative to the
working folder (the workbench) except `--copy`, an absolute Windows `.elk` path like the link.

EPLAN.exe: the highest `<SystemDrive>\Program Files\EPLAN\Platform\2025*\Bin\EPLAN.exe` (default install folder
[Command line parameters]); nothing else is searched. Each step is one command line passed verbatim to CreateProcess:

```text
"<EPLAN.exe>" /Variant:"Electric P8" /NoRemoting /Quiet:1 /NoLicenseDialog /NoUserRightsDialog /Auto <action ...>
```

- export (project = the link, or the copy named by a completed or failed import outcome whose snapshot step finished):
  `ProjectAction /PROJECTNAME:<project> /OpenMode:ReadOnly /Action:devicelist /TYPE:EXPORT /EXPORTFILE:<out>\devices.csv /FORMAT:XDLCsvImporterExporter`;
  per scheme table `ProjectAction /PROJECTNAME:<project> /OpenMode:ReadOnly /Action:XMActionDCCommonExport /CONFIGSCHEME:<scheme> /COMPLETEPROJECT:1 /LANGUAGE:<language> /DESTINATION:<out>\<table>.txt /EXECUTIONMODE:0`
  [ProjectAction, devicelist, XMActionDCCommonExport, Command line parameters].
- import: `projectmanagement /TYPE:CREATESNAPSHOTCOPY /PROJECTNAME:<link> /FILENAME:<copy>` [projectmanagement];
  `ProjectAction /PROJECTNAME:<copy> /OpenMode:Exclusive /Action:devicelist /TYPE:IMPORT /IMPORTFILE:<candidate> /FORMAT:XDLCsvImporterExporter`;
  `ProjectAction /PROJECTNAME:<copy> /OpenMode:Exclusive /Action:reports /TYPE:PROJECT` [reports]; then the export
  steps on the copy into `<out>`.

`/NoRemoting` keeps the started EPLAN from opening a Remoting server [EPLANRemoting]. Never: ExecuteScript,
Remoting, a command without PROJECTNAME (ProjectAction without it uses the last opened project),
an action on the link other than read-only export and the snapshot copy. Step: timeout 600 s, the process tree ended on
timeout or Stop (taskkill /T /F of the started PID; the helper waits in 1 s slices so a stop signal is handled within
a second); a step passes when it exits 0 and its expected file exists
(export file, the copy's link file). Outcome `<out>/outcome.json` and stdout:

```json
{ "kind": "vera-eplan-outcome", "format": 1, "tool": "eplan-tool 0.1.0", "operation": "import",
  "status": "completed|failed|interrupted|refused", "reason": null,
  "profile": {"path": "...", "sha256": "..."}, "project": "C:\\...\\PlantM.elk", "copy": "C:\\...\\PlantM-vera.elk",
  "candidate": {"path": "...", "sha256": "..."}, "eplan": "C:\\Program Files\\EPLAN\\Platform\\2025.0.3\\Bin\\EPLAN.exe",
  "steps": [{"name": "snapshot", "command": "...", "exit": 0, "seconds": 1.2, "file": null}],
  "files": [{"table": "devices", "path": "eplan-runs/r1/devices.csv", "sha256": "..."}],
  "startedAt": "...", "finishedAt": "..." }
```

The copy must be a new `.elk` path in the same folder as the project link (`copy-folder` otherwise), also when an
export reads it back through `--outcome`. The helper checks the profile fields it passes to EPLAN (kind, format,
target, link, device tag column, scheme names, language); VERA's tools check the whole schema.

Refusals (exit 2, status refused, no file, EPLAN not started): `usage`, `platform`, `profile`, `project-missing`,
`copy-exists`, `copy-is-link`, `copy-folder`, `out-exists`, `out-outside`, `path`, `conflict` (candidate sha256), `outcome` (unusable import outcome),
`eplan-missing`. Failure (exit 1, outcome written): `step-failed:<name>` (non-zero exit), `no-file:<name>`,
`timeout:<name>`; `interrupted` on Stop (SIGINT/SIGTERM/SIGBREAK). Exit 0 only for completed.

## 6 Check result (`eplan_check`)

Request `{profile, documentationRun, exports {devices, terminals?, connections?}, base? {path, sha256}, candidate?, outcome?}`;
a candidate needs base; an outcome is read only with a candidate, and a missing outcome fails the `outcome`
criterion. Producer `eplan` / `check`, engine `vera-eplan` 1.0.0, method `eplan-exchange`,
inputs the documentation run's inputs, sources `eplan-profile:<path>@sha256:<hex>`, `documentation:<run>`,
`eplan-<table>:<path>@sha256:<hex>`, `eplan-base:`, `eplan-candidate:`, `eplan-outcome:`.

Criteria: `source:documentation` (fail when the documentation run is stale), `devices`, `part-numbers`, `terminals`,
`connections` (fail with the first ten differences; terminals and connections `not-evaluated` without their export),
and with a candidate `identity`, `unchanged`, `applied`, `outcome`. Comparison is by header name, so column order may
differ; a device the candidate appended as `-<tag>` is found in the re-export by its tag or, when EPLAN added its
structure, by its identifier. `outcome` passes only for status completed, operation import, the profile's link, the
candidate's current sha256, the current profile's sha256, the steps snapshot, import, reports and one export step per
named table each with exit 0, and, for each re-export file, its recorded sha256 equal to the named export's;
otherwise it fails with the reason, and `identity`, `unchanged` and `applied` cannot pass (a pass becomes unknown).
Status `incomplete` when `source:documentation` or `outcome` fails, `completed` otherwise: differences are failed
criteria of a completed check.

## 7 Not confirmed without an installation

Device list CSV headers, encoding and whether it has a header row; the TXT layout of XMActionDCCommonExport; EPLAN.exe
exit codes; the order of global parameters and the action; whether CREATESNAPSHOTCOPY needs SCHEME; the licence each
action needs and EPLAN's behaviour without one under /NoLicenseDialog; behaviour on a project open in another instance
or with unsaved work; whether ObjectIdentifier persists [StorableObject members: ToStringIdentifier is valid only while
the project is open, DatabaseIdentifier changes on reopen]; whether a user property holding the VERA ID survives the
device list round trip. These are the real-application parts of CAD-04-A..D and stay open.
