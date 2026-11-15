# CAN databases (cantools)

CAN databases turns captured CAN traffic into named signals with units. The agent decodes ASC, BLF and candump log files with a DBC, KCD, SYM or ARXML database, and can dump, list or convert databases and generate C source from them with cantools. It reads files only; it never opens a bus. To capture traffic, use the can-python plugin.

## What it needs

- **cantools** 45 from PyPI and **can-decode**, a script in the plugin: both installed automatically by **Install dependencies** on the plugin page.
- A CAN database and a captured log file in the workbench.
- No required plugins, hardware or configuration.

## How to use it

- "List the messages and signals in fixtures/board.dbc."
- "Decode captures/bus.asc with fixtures/board.dbc and summarize the signals." (skill `can-decode`)
- "Show only messages 0x100 and 0x200 from the first 200 frames."
- "Convert board.dbc to KCD."
- "Generate C source for board.dbc."

Each decoded line shows the time, ID, message and signal values with units, followed by a summary of decoded frames per message, frames that failed to decode and IDs the database does not define. The agent reports unknown IDs as traffic the database does not describe, not as errors, and cites the capture, database and frame times behind each finding. Long captures are narrowed by message ID and frame limit.

## Risk and approvals

Every command this plugin allows is safe and runs without asking: decoding, dumping and listing only read their inputs; converting and generating C source write their output files, like other analysis outputs. There are no device-read, device-write or irreversible commands.

Three cantools commands are blocked: `decode` and `plot` read frames from standard input, which VERA closes, and `monitor` is an interactive terminal view that opens a bus. The agent uses `can-decode` instead.

## Limits

- Windows x64 and Linux x64.
- A database that fails cantools' consistency checks can still be loaded on request (`--no-strict`); the agent says when it did so.
- Reference: https://cantools.readthedocs.io/en/latest/
