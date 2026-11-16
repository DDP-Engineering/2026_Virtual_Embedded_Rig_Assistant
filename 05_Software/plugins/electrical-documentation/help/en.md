# Electrical documentation

Electrical documentation lets the agent produce the lists of your project - materials, wires (connections), cables, terminals, labels and I/O, with a table of contents - from what VERA already knows: the electrical model, a stored panel check and the QElectroTech schematics you name. Every row shows the file it comes from with that file's hash, and the lists are checked against each other.

## What it needs

- **No program.** The agent uses VERA's built-in tools `electrical_documentation`, `electrical_documentation_check` and `electrical_documentation_export`, which are offered only while this plugin is enabled. There is nothing to install or download, so **Install dependencies** has nothing to do here.
- A stored panel check (plugin Panel engineering) and the QElectroTech schematics of the motors (plugin QElectroTech schematics).
- For PLC tags, optionally a tag file you export from your PLC tool: a CSV file with the columns `name` and `address` (and optionally `dataType`, `comment`). No PLC project is opened.
- For the revision, a document object in the electrical model with a `revision` attribute (and optionally `date`, `author`).

## How to use it

- "Make the documentation for the MCP1 panel from the latest panel check and the M1 and M2 schematics, with the tags in plc/tags.csv." (skill `electrical-documentation`)
- "Show me the wire list."
- "Which I/O have no tag or a different address in the tag file?"
- "What changed since the last documentation run?"
- "Export the terminal list as CSV and everything as PDF."

The result is stored in `electrical-automation-results/<run-id>/`; exports are written next to it as new files.

## What is checked

- Wire numbering: one number per potential, no number on two potentials, every conductor numbered and connected at both ends, no two conductors between the same terminals.
- Labels drawn in a schematic that are neither in the panel nor in the model, and starter connections the schematic does not draw.
- Cables without a panel-side or load-side end, and terminals beyond the size of their strip.
- For every I/O: the device, the physical terminal, the address on a PLC module of the panel and exactly one tag, and the same address in the tag file.
- The revision: content that changed under the same revision, or a schematic sheet with another revision.

## Risk and approvals

`electrical_documentation` only reads. `electrical_documentation_check` and `electrical_documentation_export` are write tools: they ask for your approval like a file write and are not offered in Read-only sessions. They write only their new result or export file; the model, the panel file, the schematics and the tag file are never changed - differences are reported for you to fix. Nothing is printed, ordered or sent.

## Limits

- The lists contain only what the model, the panel check, the named schematics and the tag file contain; the revision and author are never invented.
- Exports are in English. PDF text uses the standard Courier font: characters outside Western European text are shown as `?`.
- Verified on Windows x64 and with QElectroTech-format projects written by VERA; not yet run on native Ubuntu x64 or on numbered projects saved by QElectroTech itself.
