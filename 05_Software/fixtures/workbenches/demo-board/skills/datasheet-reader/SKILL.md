---
name: datasheet-reader
description: Find electrical limits, pin assignments and register details in workbench datasheets and manuals. Use for questions about supply, pull-ups, pins, clocks, sensor addresses or register fields.
---
# Datasheet reader

## Procedure
1. Identify the board revision from WORKBENCH.md and the question. Load this skill with `load_skill` before applying it.
2. Use `search_docs` with English technical terms over the English sources, then `read_doc` to inspect the returned page or heading. Read `docs/pinout.csv` with `read` to cross-check named signals.
3. Distinguish board connections, operating limits, typical values and illustrative register settings. Keep units and seven-bit addresses separate from shifted register fields.
4. If indexing is still in progress, use `read` on the matching Markdown in `sources/` and the pinout instead of guessing or reading PDF binary bytes.
5. Answer with the exact source references returned by successful tools. State any disagreement or missing information; never invent a page, value or reference.

## Answer format
Give a concise answer, then a table of signal/value, condition or unit, and source. Mention relevant revision and limitations.

## Rules
- VERA-DEMO-01 is fictional; its values describe the example, not a real part.
- Search and read only; do not change files or claim to measure/control hardware.
- A register setting in the reference manual is an illustrative demo value, not a recommendation for a real MCU.
