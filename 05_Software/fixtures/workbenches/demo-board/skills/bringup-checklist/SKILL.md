---
name: bringup-checklist
description: Draft an evidence-backed board bring-up checklist from the workbench application note, pinout, notes and logs. Use for first power-up planning, acceptance checks and identifying measurements still needed.
---
# Bring-up checklist

## Procedure
1. Load this skill with `load_skill`, then read WORKBENCH.md, `docs/notes/bringup.md`, `docs/pinout.csv` and `logs/boot-0412.log` using `read`.
2. Use `search_docs` and `read_doc` to inspect `docs/vera-demo-01-application-note.pdf` and the relevant datasheet/manual pages. If indexing is pending, read the matching files under `sources/`.
3. Draft the documented power/reset, UART/clock, I2C wiring/timing, sensor ID, status LED and watchdog sequence. Keep the source's order and units; cite each step's source reference.
4. For each step list action, expected result and evidence status: recorded, partially recorded or still to measure. Notes and log statements are supplied observations, not measurements you performed.
5. Keep unobserved acceptance checks open. The existing log's ready line does not prove sensor ID 0xA1 or a 500 ms LED toggle; request that evidence before declaring acceptance.

## Answer format
Markdown checklist with action, expected result, evidence status and source. Finish with the missing measurements and any inconsistent evidence.

## Rules
- This is a fictional board exercise; no real hardware is controlled.
- Answer in chat. Save a checklist file only if the user explicitly requests it and normal permissions allow it.
- Never mark a check passed solely because the expected value appears in a source document.
