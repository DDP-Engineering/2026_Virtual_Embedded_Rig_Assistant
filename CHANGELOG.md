# Changelog

Notable changes to VERA. Format: Keep a Changelog; versions: Semantic Versioning. Every version below
1.0.0 is a pre-release with no upgrade path from earlier builds. Rules: `01_Documentation/Releases.md`.
Older releases: `06_SoftwareDocu/CHANGELOG-archive.md`.

## [Unreleased]

### Fixed

- Terminal: long output no longer flickers, loses the scroll position or drives CPU up once the buffer is full.
- Sessions: Stop and approval decisions no longer wait for plugin loading and program probing.
- Short values, user names and supplier ids stored with a credential are no longer masked as secrets.
- One unreadable credential or a damaged credentials file no longer disables all stored keys.
- Extraction cache files of changed or removed documents are deleted after indexing instead of piling up.
- Citations into the same document are verified with one read of the file per answer, not one per citation.
- A damaged session no longer prevents the other sessions of a workbench from loading.
- Documents with names VERA cannot address (":", trailing dot or space, device names) show as unsupported in Files.
- Run logs stop growing at 64 MiB and are marked truncated; the run and its live output continue.
- An interrupted plugin reinstall is recovered at start, and leftover staging folders are removed.
- Closing a read-only workbench no longer fails on a locked temp copy; stale database copies are removed.
- Queued grep and parse_log calls no longer time out before they run.
- list and glob stop collecting at 5,000 entries on very large folders and mark the result truncated.
- Web search keeps the valid sources when one provider result block is malformed.
- Power factor correction checks capacitor-bank resonance at the minimum fault level too, not only the maximum.
- Protection compares Iz and I2 with the largest cited rated current, so a derated value cannot pass the check.
- Power factor correction reads stored network values with their unit instead of assuming kA, kW and kvar.
- The network analysis warns when a motor's rated voltage differs from its supply voltage by more than 10 %.
- A second Ctrl-C exits the CLI at once with code 130 when cleanup hangs.
- power-quality-pfc 0.1.1: help and skill describe the resonance check at maximum and minimum fault level.
- platformio 0.2.1: Stop during an upload ends PlatformIO and the programmer at once; the run reads stopped.
- zephyr 0.2.1: Stop during a flash ends west and the programmer at once; the run reads stopped.
- scpi-instruments 0.2.1: texts say no profile is verified on a real instrument; output results warn about it.
- mqtt-tools 0.2.1: a console break event on Windows ends a run with unsubscribe, disconnect and a result.
- gdb-debug 0.2.1: step runs get a 30-minute timeout, enough for 100 steps.
- can-python 0.2.1: a capture with only --max-messages ends after 240 s on a quiet bus; the ip query cannot hang.
- electronics-calc 0.3.1: Monte Carlo redraws samples outside a model's domain and reports the rejected draws.
- micropython 0.2.1: read-file saves a board file named like a Windows device (COM1, NUL) under a safe name.
- ngspice 0.3.1: series rows that are unparseable, NaN or infinite are left out and reported as a warning.
- lab-validation 0.3.1: a capture's raw block is checked against its waveform before it is decoded.
- power-profiler 0.2.1: import stops reading a CSV one row past the 1 000 000 row limit.
- hil-testing 0.2.1: reports skip and count unreadable event lines; a malformed plan field no longer fails.
- Document indexing no longer re-reads unchanged indexed files on every refresh.
- A document that failed to index is retried once when the workbench opens, after it changes, or on Reindex.
- Large manuals index reliably: embeddings run in batches and the PDF time limit grows with file size.
- Document search with a path filter no longer loads every matching passage into memory.
- VERA starts even when its display identity key file is damaged; a new key is created.
- Quitting saves settings, credentials and logs even when one shutdown step fails.
- The window reloads after a renderer crash instead of staying blank.
- A display error shows a message with a Reload button instead of an empty window.
- Update release links are accepted only inside the configured update folder.
- Context compaction works with reasoning models and with models that wrap the summary in a code fence.
- Very large file changes show a "diff too large" note instead of holding the application on a long diff.
- Reading a pipe, socket or device file is refused at once instead of blocking the application on Linux.
- A change that completed just as you pressed Stop is reported to the model as applied, not as aborted.
- Settings load again after a temporary read failure instead of staying broken until restart.
- A workbench with a damaged lock file opens normally instead of failing with a conflict.
- A plugin zip or dependency archive that would inflate to an absurd size is refused as invalid.
- A run on Windows finishes even when stopping its process tree hangs.
- The plugin catalog stops waiting after 30 seconds when its server does not answer; downloads get 15 minutes.
- Session titles no longer end in a broken character when an emoji falls at the cut.
- The Files tab refreshes once per burst while indexing instead of once per document.
- The CLI reports its real version instead of 0.0.0 in workbenches it creates and in the agent prompt.
- Romanian: corrected "Anulează-o" and use "Acces web" consistently.
- Help: the Plugins and Documents pages match the Status block and the index status line.
- parts-search 0.3.1: bom.csv quotes cells that a spreadsheet would run as a formula; rail names stay as written.
- kicad 0.3.1: bom.csv quotes cells that a spreadsheet would run as a formula; rail names stay as written.
- kicad-layout 0.3.1: kicad-cli output is read as UTF-8, so non-ASCII messages no longer fail the DRC step.
- can-dbc 0.3.1: can-decode --limit must be a positive integer.
- circuitpython 0.2.1: deploy refuses target names ending in a dot or space or holding a colon.
- arduino-cli 0.2.1: upload with --programmer is irreversible and needs the typed confirmation.
- esp32-esptool 0.2.1: --encrypt, --encrypt-files and --ignore-flash-enc-efuse need the typed confirmation.
- stm32-cubeprog 0.2.1: the option-byte approval note leads with the permanent RDP level 2 warning.
- Shell commands run under PowerShell Constrained Language Mode; cmdlet text keeps the console code page there.
- Approval shortcuts A and D no longer fire while the command-prefix list has the key.
- Saved command prefixes no longer approve git forms that run a named program or discard work.
- A saved command prefix that is no longer eligible is ignored; its workbench still opens.
- On Linux, a file deleted while its bytes are read is reported as missing, not as a conflict.
- UI checks read the renderer's address from coloured output and wait for a pending bookmark update.
- Closing a terminal suspends its I/O and ignores late responses from the terminal being closed.
- Tool calls no longer show blank output blocks when the result is empty or contains only whitespace.
- Tool activity shows readable plan steps; translation catalogs refresh in an already running development app.
- Commands aligns Cancel and Save at the top right, matching Data & privacy.

- Terminal text follows the code/output text size setting immediately and refits its rows and columns.

- Files shows active indexing or failures; large-selection advice stays in the documentation setup preview.

- Terminal history replay no longer injects control replies into the shell when reopening or switching tabs.

- Windows command Stop waits for descendant cleanup and reaps children created during process-tree termination.

### Changed

- German texts use formal Sie, masculine Workbench and Tastenkombinationen in interface, help and release notes.
- Romanian texts use informal address and one term each: workbench, furnizor, folder, skill-uri, instrumente.
- French texts say Contournement, Autorisations, Compétences and banc de travail in interface, help and notes.
- npmw.py warns when the installed packages are older than package-lock.json.
- setup.py shows npm's own error text when npm ci fails; a damaged uv download cache is downloaded again.
- Git ignores private keys and certificates (*.pem except *.pub.pem, *.pfx, *.p12, *.key) and plain .env files.
- The log folder is cleaned once per day; embedding warm-up is retried after the first documents are indexed.
- Release builds no longer show Reload and Developer Tools in the View menu.
- Release packaging refuses any VERA_TEST_ test hook left in the release build, not only the listed ones.
- npm run test:e2e builds the instrumented desktop by default; setting VERA_TEST=1 first is no longer needed.
- Test runs of the renderer dev server take a free port instead of 5173.
- Setup requires Python 3.11.4 or newer.
- Planning and architecture documents match the code again: tools, settings, plugins, indexing limits, plans.
- About opens with What's new collapsed, leaving application details visible first.
- Runs cards separate command, status, duration and metadata with compact icons and readable rows.
- UI checks follow compact viewer controls, await terminal creation and use the renderer's actual port.
- Test startup caches transformed modules and isolates native processing; complex UI checks tolerate loaded hosts.
- Chat describes tool actions and results clearly, with raw data and duration in expandable technical details.
- Files places icon actions beside search and shows compact indexing progress with expandable failures.
- The Context tab and icon tooltip are named Instructions and skills in all four interface languages.
- Commands offers detected shell choices and Custom, with native Cmd and Bash support on Windows.
- Right-panel tabs and terminal actions use compact icons; assistant replies omit the repeated VERA heading.
- Chat messages are centered in the space beside the navigation rail, with balanced horizontal margins.
- Image zoom, text wrap and encoding, and Hex actions share the file-mode toolbar.
- Workbench overview shows the total .vera folder size with an on-demand refresh.

- Test runners parallelize isolated checks, share renderer/CLI preparation and validate desktop build reuse.
- Milestone tests refresh viewer/session fixtures, align plugin versions and isolate costly checks.

- Agent/model and artifact/export masking follow independent live app/workbench choices, both defaulting on.

- Program runs and user terminal output follow live app/workbench masking, defaulting off; agent reads use their own policy.

- Display masking follows app and workbench choices while keeping secret-named files visible and openable.

- Auto-edit uses saved command prefixes; destructive shell commands always ask outside Bypass.

- lab-validation 0.3.0: HIL validation reads host-approved outside inputs with workbench-owned output.

- Bypass extends to analysis, plugin drafts, HIL plans, bench resources and electrical inputs.

- Bypass runs declared programs in outside folders, binds outside files and stops its runs when Bypass ends.

- Bypass confirms each mode change; agent file access refuses VERA application data in every mode.
- Delete settings.json from earlier pre-releases after removal of the Bypass warning suppression preference.

### Added

- Workbenches can choose visible right-panel tabs, with saved preferences and draft default restoration.
- Image previews fit PNG, JPEG, GIF, WebP, BMP and inert SVG, with original-image zoom through 400% and Hex.
- File viewer modes switch between Rendered, Text and Hex, with binary defaults and remembered extension choices.

- Hex view offers virtual byte rows, offset jumps, cancellable text/byte Find and selection copy.

- Large text files open in bounded windows with byte scrolling, progressive line jumps and cancellable Find.

- Text files offer BOM detection, encoding selection, explicit replacement decoding and measured word wrap navigation.

- Bounded document byte reads prepare large-file and hex viewers with byte-preserving Display masking.

- Data & privacy offers app masking defaults and per-workbench choices, with confirmation before agent masking is off.

- Masking configuration contracts and a shared resolver prepare per-area app defaults and workbench choices.

- User terminal tabs support interactive shells, resizing and explicit per-terminal consent for agent output reads.

- Runs shows shell commands, folders, live output and durations, with Stop and complete logs in the viewer.

- Workbenches grant file tools and shell working directories access to user-selected additional folders.

- The agent runs approved shell commands with configurable shells, full logs and monitored background runs.

- Bookmarked rail markers stand out, with configurable next and previous bookmark shortcuts.

- User messages and rail previews share bookmark controls; previews show the first prompt line and reply start.

- Per-session user-message bookmarks persist across restarts and remain in session exports.
- The document selection, its preview and the Files tab honor the workbench's .gitignore files (switch on by default).
- Per-workbench maximum file size (lowers the fixed limits) and maximum indexed files settings in Documents & RAG.
- Count guard: a selection above the maximum indexed files is not indexed until Index anyway or narrower exclusions.
- Documents preview in New workbench and the editor counts with the indexer's selection (ignore files, size and count limits), says "at least" when its 5-second limit stops it, and shows the count guard before saving.

## [0.2.0] - 2026-11-15

### Added

- Session sizes in the workbench overview's sessions table.
- Electrical project model with units, provenance and stale results, shared by the electrical plugins.
- electrical-network 0.1.0: radial LV load balance, cable sizing, voltage drop and short circuit.
- industrial-catalog 0.1.0: cited catalog items and documented component selection.
- protection-coordination 0.1.0: breaking capacity, disconnection times and table-based selectivity.
- motor-drives 0.1.0: motor starter and drive selection.
- power-quality-pfc 0.1.0: measurement import, compensation need, bank steps and resonance check.
- lighting-design 0.1.0: preliminary estimate, IES/LDT import and DIALux report check.

### Changed

- The conversation rail's preview shows only the message text, without its number.

### Fixed

- Disabling plugin skills was slow, left the workbench editor with false unsaved changes and reported the
  disabled skills as unresolved names.
