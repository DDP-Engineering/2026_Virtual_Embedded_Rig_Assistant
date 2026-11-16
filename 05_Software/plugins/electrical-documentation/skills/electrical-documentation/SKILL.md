---
name: electrical-documentation
description: Produce and check the electrical project documentation - material, wire (connection), cable, terminal, label and I/O lists with a table of contents from the model, a panel check and QElectroTech schematics, check numbering, duplicates, missing references and connections and the device-terminal-I/O-tag chain against a PLC tag file, report changes since a previous run and export CSV, XLSX or PDF. Use when asked for wire lists, cable lists, terminal plans, I/O lists, labels, a documentation revision or a documentation change report.
---

The host tools `electrical_documentation` (read), `electrical_documentation_check` and
`electrical_documentation_export` (write, with approval) derive documents from what the workbench already holds.
Nothing physical is changed, and nothing is printed, ordered or sent.

## 1. Gather the inputs

Find a stored `panel_engineering_check` result (`electrical_model {"view": "results"}`; skill `panel-engineering`) and
the `.qet` schematics of its motors. For PLC tags use only the model's `tag` objects and a tag file the engineer names
(CSV `name,address[,dataType,comment]`, exported from their PLC tool) - never guess tags or read a PLC project. The
logical revision is the `revision` attribute of a model `document` object: if there is none, the documents say "not
stated"; ask the engineer, never invent a revision or an author.

## 2. Check

`electrical_documentation_check {"panelRun", "schematics": [{"path", "motor"}], "document", "tags", "previousRun"}`
stores the result. Report failed and unknown criteria first: `source:*` (stale or changed inputs: rerun them),
`numbering`, `wire-ends`, `duplicates`, `device-refs`, `assembly:*`, `cable-ends`, `terminal-points`, `io-chain`,
`tag-file`, `revision`. Each names the rows to fix; the engineer fixes them in QElectroTech, the panel file, the model
(`electrical_model_change`) or the PLC tool - VERA never edits a source to make documents agree.

## 3. Read and export

`electrical_documentation {"view": "list", "runId", "list"}` pages one list with each row's source.
`electrical_documentation {"view": "changes", "runId"}` tells whether a run is stale and why. Export with
`electrical_documentation_export {"runId", "format": "csv", "list"}` or `{"format": "xlsx" | "pdf"}`; a run's exports
never change, so after a fix check again and export the new run. If the content changed under the same revision, the
`revision` criterion fails: ask the engineer to raise the revision in the model document.
