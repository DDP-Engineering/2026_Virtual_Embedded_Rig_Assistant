# eplan

EPLAN Electric P8 2025 exchange for VERA's electrical project model: strict reading of EPLAN's device list and of the
terminal and connection tables your export schemes write, a reconcile with a stored `electrical_documentation_check`
run, a device list import candidate, and a helper that runs EPLAN's documented command line on a copy of the project.

**Status: not verified with a real EPLAN installation.** Everything EPLAN-side follows the public EPLAN API 2025
documentation (https://www.eplan.help/en-us/Infoportal/Content/api/2025/API%20Reference.html, pages dated 17.02.2025)
and has not been run against EPLAN: the exact file layouts, exit codes, licence behaviour and the behaviour on a
project open in another EPLAN are open. Treat the first runs as a trial on a copy of a test project.

- **Profile** `electrical-automation-eplan/<id>.json` (kind `vera-eplan-profile`, format 1): the declared target
  (EPLAN Electric P8 2025, windows-x64), the project link file (`C:\...\Project.elk`, no spaces), the header names of
  the device list columns (tag, part, description, VERA ID), the manufacturer prefixes of part numbers (`SE.`), and
  for terminals and connections the export scheme name, language and columns.
- **The tool `eplan`** (read): `inspect` reads one exported table strictly (UTF-8, `;`, a header row, every mapped header
  once, equal field counts) and pages it with the unmapped columns; `reconcile` compares devices (by VERA ID or by the
  identifier after `=plant+location-`), part numbers, terminal points and connections (ends and wire numbers) with the
  documentation lists and proposes `electrical_model_change` operations recording `attributes.eplanTag`, never applied.
- **The tool `eplan_change`** (write) `candidate`: a NEW device list `.csv` from a base export and its sha256. Untouched
  records are copied byte for byte; matched devices get the documented order code (with the prefix) and their model ID
  in an empty VERA ID column; missing devices are appended as `-<tag>`; nothing is removed. The report lists what
  cannot transfer: connections and terminals (the device list import carries neither; the external-editing `.edc`
  format is not documented), macros (format not documented), unmapped fields.
- **The tool `eplan_check`** (write) stores one result: `source:documentation`, `devices`, `part-numbers`, `terminals`,
  `connections`, and after an import `identity`, `unchanged`, `applied` and `outcome`. An import counts only when
  eplan-tool's outcome is `completed` for this candidate and project and the re-export shows every value; a missing,
  refused, failed or interrupted outcome fails `outcome` and leaves the run incomplete.
- **The program `eplan-tool`** (PEP 723 script, standard library only) finds `EPLAN.exe` under
  `<SystemDrive>\Program Files\EPLAN\Platform\2025*\Bin` and runs, one command at a time,
  `"EPLAN.exe" /Variant:"Electric P8" /NoRemoting /Quiet:1 /NoLicenseDialog /NoUserRightsDialog /Auto <action>`:
  - `export`: `ProjectAction /PROJECTNAME:<project> /OpenMode:ReadOnly /Action:devicelist /TYPE:EXPORT
    /FORMAT:XDLCsvImporterExporter` and, per scheme table, `/Action:XMActionDCCommonExport /CONFIGSCHEME:<scheme>
    /COMPLETEPROJECT:1 /LANGUAGE:<lang> /EXECUTIONMODE:0`;
  - `import`: `projectmanagement /TYPE:CREATESNAPSHOTCOPY /PROJECTNAME:<project> /FILENAME:<copy>`, then on the copy
    `ProjectAction /OpenMode:Exclusive /Action:devicelist /TYPE:IMPORT /FORMAT:XDLCsvImporterExporter`,
    `/Action:reports /TYPE:PROJECT`, and the export steps into a new folder;
  - `plan`: prints those command lines and starts nothing.
  It refuses before EPLAN starts (status `refused`, exit 2) on an invalid profile, a missing project, a copy outside the
  project's folder, an existing copy or output folder, a changed candidate (`conflict`), paths with spaces or quotes, another system or no EPLAN 2025. A step
  that exits non-zero, times out (600 s) or leaves no file stops the run (`failed`, exit 1); Stop ends EPLAN's process
  tree (`interrupted`). Every run writes `outcome.json` (kind `vera-eplan-outcome`) in its output folder.
  It never runs `ExecuteScript`, never uses EPLAN Remoting (which attaches to a running EPLAN), never acts without
  `/PROJECTNAME` and never imports into the profile's project.
- **Skill**: `eplan-exchange`, from a profile to a checked import in a copy.

Licences: EPLAN and its licence are yours; VERA bundles nothing. Command-line actions need a licensed EPLAN; which
licence each needs is not stated in the API documentation. Results are preliminary engineering support. The exact
formats are the specification REQ-DATA-203d52e6 in VERA's `.agentic/specs/`.
