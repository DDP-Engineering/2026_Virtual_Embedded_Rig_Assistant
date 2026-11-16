---
name: eplan-exchange
description: Exchange device, terminal and connection data with EPLAN Electric P8 2025 - write an EPLAN mapping profile, export a project read-only with eplan-tool, reconcile it with the electrical documentation lists, build a device list import candidate, import it into a project copy and check the round trip. Use when asked about EPLAN, .elk projects, EPLAN device lists, part numbers in EPLAN or comparing EPLAN with VERA's documentation.
---

The host tools `eplan` (read), `eplan_change` and `eplan_check` (write, with approval) and the program `eplan-tool`
(through `run_program`) work together. EPLAN-side behaviour is not yet verified on a real installation: say so when you
report results, and propose a test project first.

## 1. Profile

Ask for the project link file (`C:\...\Project.elk`, no spaces), the header names the user's EPLAN device list export
writes, and, for terminals and connections, the external-editing scheme names and language. Write
`electrical-automation-eplan/<id>.json` (kind `vera-eplan-profile`, format 1; target EPLAN Electric P8 2025,
windows-x64). Map only columns that exist; add `partPrefixes` per catalog manufacturer when EPLAN part numbers carry a
prefix such as `SE.`. Never guess a header name.

## 2. Export and reconcile

1. `run_program eplan-tool plan export --profile <profile> --out eplan/<run>` and show the command lines.
2. `run_program eplan-tool export --profile <profile> --out eplan/<run>` (device-read). Read the printed outcome:
   only `completed` has files. On `refused` or `failed` report the reason; never retry with another project.
3. Needs a current `electrical_documentation_check` run (skill `electrical-documentation`). Call
   `eplan {"view": "reconcile", "profile": ..., "documentationRun": ..., "devices": "eplan/<run>/devices.csv",
   "terminals": ..., "connections": ...}` and list differing, EPLAN-only and VERA-only entries and duplicates. Offer the
   proposed `electrical_model_change` operations; do not apply them unasked.

## 3. Import candidate

`eplan {"view": "inspect", ...}` gives the base sha256. `eplan_change {"action": "candidate", "profile": ..., "base":
"eplan/<run>/devices.csv", "sha256": ..., "documentationRun": ..., "path": "eplan/<name>.csv"}`. Explain the report:
updated, added, unchanged, EPLAN-only, and what cannot transfer (connections, terminals, macros, unmapped fields).

## 4. Import into a copy and check

1. `run_program eplan-tool import --profile <profile> --candidate eplan/<name>.csv --sha256 <candidate sha256> --copy
   C:\...\<Project>-vera.elk --out eplan/<run2>` (device-write). The original project is never changed.
2. `eplan_check {"profile": ..., "documentationRun": ..., "exports": {"devices": "eplan/<run2>/devices.csv", ...},
   "base": {"path": ..., "sha256": ...}, "candidate": "eplan/<name>.csv", "outcome": "eplan/<run2>/outcome.json"}`.
3. Report identity, unchanged, applied and outcome. Only when all pass is the import shown to have arrived; otherwise say
   which failed and that the copy must not be adopted. The engineer reviews the copy in EPLAN and keeps or deletes it;
   `eplan-tool export --outcome eplan/<run2>/outcome.json --out ...` re-reads the copy later.

Never run EPLAN.exe or scripts directly, never name the open project of a running EPLAN, and never call a failed,
refused or interrupted import applied.
