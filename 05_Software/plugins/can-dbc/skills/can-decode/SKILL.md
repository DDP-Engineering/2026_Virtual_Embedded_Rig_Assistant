---
name: can-decode
description: Decode a captured CAN log into message and signal values with a DBC (or KCD, SYM, ARXML) database, and inspect the database.
---

Use `run_program` with programs `can-decode` and `cantools`. Inspect the
database first so you name messages and signals correctly:

```text
cantools dump fixtures/board.dbc
cantools list fixtures/board.dbc
```

Decode a capture (ASC, BLF or candump `.log`) with the database:

```text
can-decode --dbc fixtures/board.dbc --input captures/bus.asc --limit 200
can-decode --dbc fixtures/board.dbc --input captures/bus.asc --id 0x200 --id 0x100
```

Each line is `time id message signal=value unit ...`; the summary counts the
decoded frames per message, the frames whose ID the database does not define
(`unknown <id>: <n>`) and frames that failed to decode (wrong length or
multiplexing). Long captures produce long outputs: narrow them with `--id` and
`--limit`, and read the rest from the run log. Choice names (`Enable=On`) are
shown unless `--no-choices` asks for raw numbers; `--no-strict` loads a
database that fails cantools' consistency checks, and you should say so.

`cantools convert` (for example DBC to KCD) and `cantools generate_c_source`
write output files. `cantools decode`, `plot` and `monitor` are unavailable:
they need standard input or an interactive terminal. Cite the capture, the
database and the frame times behind every finding, and report unknown IDs as
traffic the database does not describe rather than as errors.
