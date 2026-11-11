# CAN databases (cantools)

Enable **DBC decoding** in the CAN pack. The plugin provides two programs and
the `can-decode` skill:

- `cantools` (cantools 45 from PyPI): `dump`, `list`, `convert` and
  `generate_c_source` are safe. `decode` and `plot` read candump frames from
  standard input, which VERA closes, and `monitor` is an interactive terminal
  view; all three are refused with a pointer to `can-decode`.
- `can-decode`, a PEP 723 script on cantools 45.1.2 and python-can 4.6.1:
  `can-decode --dbc <database> --input <log> [--id HEX]... [--limit N]
  [--no-choices] [--no-strict]` decodes an ASC, BLF or candump log file. It
  prints one line per decoded frame (`time id message signal=value unit`) and a
  summary of decoded, failed and unknown IDs. Exit codes: 0 done, 2 invalid
  arguments or unreadable files.

`can-decode`, `dump` and `list` only read their inputs; `convert` and
`generate_c_source` also write their output files without approval, like
other analysis outputs.
