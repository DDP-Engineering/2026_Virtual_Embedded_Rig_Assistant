# EPLAN exchange

EPLAN exchange lets the agent compare your EPLAN Electric P8 2025 project with VERA's electrical documentation and hand approved part data back to EPLAN. It reads the device list and the terminal and connection tables EPLAN exports, lists what differs from the documentation lists, builds a device list file to import, and has that file imported into a copy of your project, never into the original. A check then shows whether every value arrived and nothing else changed.

**Not yet verified with a real EPLAN installation.** It follows EPLAN's public API documentation; try it first on a copy of a test project.

## What it needs

- Your own licensed EPLAN Electric P8 2025 on Windows, installed in its default folder (Program Files\EPLAN\Platform\2025...). VERA installs and bundles nothing from EPLAN.
- The program **eplan-tool** of this plugin (a small Python script): use **Install dependencies** on the plugin page.
- A profile file in `electrical-automation-eplan/` that names your project file (.elk, path without spaces) and the column headers of your EPLAN exports. For terminals and connections, an EPLAN export scheme ("external editing") that writes semicolon-separated text with a header row.
- A current electrical documentation run (plugin Electrical documentation) to compare with.

## How to use it

- "Write an EPLAN profile for C:\EPLAN\Projects\PlantM.elk with these column headers." (skill `eplan-exchange`)
- "Export the device list and the terminal and connection tables from EPLAN."
- "Compare the EPLAN export with the latest documentation run."
- "Prepare an import file that corrects the part numbers in EPLAN."
- "Import it into a copy of the project and check that everything arrived."

## Risk and approvals

`eplan` only reads. `eplan_change` and `eplan_check` are write tools: they ask for your approval like a file write and are not offered in Read-only sessions. **eplan-tool export** is a device-read action: it starts EPLAN with your project opened read-only. **eplan-tool import** is a device-write action: it creates a new copy of your project and imports the approved file into that copy; your original project is not changed. Every EPLAN command names its project; nothing is attached to an EPLAN you have open, and no script from a project is run. A failed, refused or stopped import is never reported as applied.

## Limits

- Windows x64 only. Not yet run against a real EPLAN: file layouts, exit codes, licence messages and the behaviour with a project open elsewhere are unconfirmed.
- Only the device list (part numbers and the VERA ID column) is imported. Connections, terminals and macros are compared but never imported; macros are not handled at all.
- Paths given to EPLAN must not contain spaces or quotes.
- Results are preliminary engineering support: no verified design and no conformity statement.
