# Changelog

Notable changes to VERA. Format: Keep a Changelog; versions: Semantic Versioning. Every version below
1.0.0 is a pre-release with no upgrade path from earlier builds. Rules: `01_Documentation/Releases.md`.
Older releases: `06_SoftwareDocu/CHANGELOG-archive.md`.

## [Unreleased]

### Added

- Filter the plugin library by requirements (skills only, Python script, program VERA downloads, program you install, settings) and show them as badges on each plugin card.
- Show delegated sessions as an expandable tree under their parent in the session list, with their outcome and attention state; Move up and Move down keep children with their parent (#407).
- Open cited frames from verified saved captures in Wireshark Desktop.
- Evaluate synthetic Wireshark workflows with deterministic replay, exact frame checks and guarded model probes.

- wireshark-tshark 0.3.2: Inspect saved captures offline with typed packet queries and verified capture references.
- wireshark-tshark 0.4.0: Analyze saved traffic, timing, diagnostics and streams with frame evidence.
- wireshark-tshark 0.5.0: Analyze saved DoIP, SOME/IP and Service Discovery traffic with PDU and frame evidence.
- wireshark-tshark 0.6.0: Query saved networking observations and export compact, redacted frame evidence.
- wireshark-tshark 0.7.0: Inspect, select, split, merge, convert, reorder, deduplicate and clean saved captures.
- wireshark-tshark 0.8.0: Import firmware and UART hexdumps as verified PCAPNG with provenance.
- wireshark-tshark 0.9.0: Compare saved captures offline with directional metrics, coverage and frame references.
- wireshark-tshark 0.10.0: Profile saved Wi-Fi, BLE, USB and VoIP captures with RTP statistics and frame links.
- wireshark-dumpcap 0.1.0: Capture bounded local traffic and retain verified PCAPNG segments.

### Changed

- Raise the default Tool calls per turn to 200 and Concurrent turns to 4; a turn that reaches its tool-call limit now ends with the agent's summary of what is done and what remains, and Chat offers Continue instead of stopping silently (#406).
- Group completed program and shell operations in chat and clarify approval details.
- Remove the Delegated sessions list from the parent chat and the Parent session link from a child's chat; the sidebar tree replaces both, and the child chat keeps its delegated turn outcome (#407).
- Start a Bypass parent's delegated session in Auto-edit when Full Access for delegated tasks is off, instead of refusing the launch; with it on, the child follows the direct Bypass policy, including shell commands without saved prefixes (#405).

### Fixed

- Allow changing reasoning during delegated work without changing its admitted first request.
- Verify update metadata against the installer files and blockmaps in each delivery.
- Set the model of the first API-key or local provider as the default, and say "No model is selected" instead of "The request is invalid" when none is chosen.
- Show a dialog naming the file and keys when `settings.json` is invalid, instead of exiting silently.
- Offer Retry after a provider error, only while the failed message is still the latest one.
- Stop refusing messages, session names and settings that contain a stored secret; masking still applies.
- Search the file itself when `grep` gets a file as path, match bare patterns such as `*.log` at any depth in `grep` and `glob`, and report unsearched files as `skippedFiles`.
- Keep the other bytes of a file that is not UTF-8 when `edit` changes it.
- Report the real exit code of shell commands in Windows PowerShell 5.1, and tell the model which shell `run_command` uses.
- Let the agent read the full log of a command it ran, in `.vera/runs`.
- Keep subscripts, superscripts and font changes on their line in text extracted from PDFs. Delete `.vera/cache/extract` and reindex to apply it to documents indexed before.
- Render a PDF that is not indexed instead of showing it as hex.
- Accept a citation of one page inside a page range the agent read.
- Ignore a click on the indexing progress indicator instead of queuing a full reindex.
- Keep text typed in the message box when another session, Settings, Help or Plugins is opened.
- Send text typed in the message box as the answer when the agent waits on a question; Enter in the question's text field submits it.
- Show a notice with Continue when the model stops at its output limit.
- Open web links from answers directly; the dialog appears only when a link cannot be opened.
- Focus Stop in the stop confirmation, so Esc then Enter stops the turn.
- Allow renaming a session while its turn runs.
- Allow saving command prefixes for `idf.py`, `pio run -e`, `make -C`, `ninja -C` and `git -C`.
- Accept absolute paths inside the workbench in file tools, and apply Windows file-name rules only on Windows.
- Stop refusing an embedding model change because a document finished indexing meanwhile.
- Keep the message box locked in an archived session, and show Bypass by name in the workbench overview.
- Open files without a known extension (Makefile, Kconfig, linker scripts, device trees, map files) and logs with ANSI colour codes as text instead of hex.
- Treat a log with a few stray NUL bytes as text in `read`, `grep` and the viewer.
- Find register names by an all-capital fragment, such as MODER in GPIOx_MODER.
- Compute embeddings on up to four threads.
- Describe the parameters of `read`, `grep`, `glob` and `edit` for the model.
- Title the secret masking switches in Data & privacy.
- Log the error type and code location when an internal request fails.
- Search sessions by title and message text from the sidebar.
- Scroll to the end of the conversation when a message is sent.
- Draw PDF pages at the display's pixel density, zoom up to 400 %, and draw an oversized page at lower resolution instead of leaving it blank.
- Add Cancel to the ChatGPT branch of the Add provider dialog.
- Say what to do when a PDF is not indexed, instead of pointing `read` and `read_doc` at each other.
- Add an Open Providers button to errors about a missing model, a refused credential or a removed model, and show the missing-model hint on the empty start screen.
- Open a new session right after a workbench is created.
- Say that a session's model or provider was removed, instead of reporting an internal error.
- Let a parent session wait up to 10 minutes for a delegated session in one call.
- Offer Compact now on a context-limit error in chat.
- Step through transcript search matches with Enter and Shift+Enter.
- Keep Save off in Edit workbench while chunk size, overlap, results per search or the default model is invalid.
- Go to a page in a PDF with Ctrl+G or the document menu, and start Find at the page in view.
- Accept a compaction summary with text around its JSON object, a missing list or non-text list items.

## [0.3.0] - 2026-11-25

### Added

- Show an open document or Git diff beside Chat, with an adjustable divider and compact tab view.
- Reopen recently closed tabs, pin important tabs, and search open tabs beside Chat.
- Delete old `vera.tabs.<workbenchId>.<sessionId>` localStorage records to clear obsolete saved tab layouts.
- Open the current plan from Chat and get a notification while away when a plan needs a decision.
- Receive desktop alerts for pending chat questions and manage them in Settings > Notifications.
- Catch up on unread replies and pending session activity across workbenches from the title bar.
- Ask structured chat questions and optionally apply the recommended answer after a workbench timeout.
- Receive desktop alerts for completed replies and pending approvals, and click to open their sessions.
- Configure desktop alerts for completed turns and background approval requests in Settings > Notifications.
- Organize Advanced settings and configure browser navigation, dictation and model discovery deadlines.
- Send follow-ups to delegated sessions and authorize Full Access launches with independent session modes.

- Open local Git file history from Files in a tab beside Chat.
- Open staged and unstaged Git diffs from Files in tabs beside Chat.
- Opt in to read-only Git status, changed-file badges and a changes filter in Files.

- See workbench indexing status in the sidebar and document search limitations on the affected chat turns.
- Add durable Plan feedback, revision-only review requests, safe retry restoration and live session privacy refresh.
- Sessions keep running in background workbenches, within Concurrent turns; the sidebar shows, opens and stops them.
- Verbose chat shows the send date and time beneath user messages, alongside token usage.
- Connect Hugging Face Inference Providers, NVIDIA NIM and Vercel AI Gateway with full model IDs.

- Connect Fireworks AI, Together AI, Groq and Cerebras with catalog discovery and manual model IDs.

- Connect Alibaba Cloud and Xiaomi MiMo APIs and plans using their region and workspace settings.

- Connect international MiniMax and Z.AI through separate API and subscription presets.

- Connect DeepSeek, international Moonshot AI and Kimi For Coding with separate API keys and model profiles.

- Connect QwenCloud Standard and Token Plan with scoped keys, model setup and connection diagnostics.

- Connect OpenCode Console and OpenCode Go and choose models from each plan.

- Search provider presets and see provider identity, model limits and capabilities when choosing a model.

- Manage Interactive Browser in Web access and grant, show, stop, revoke or close it from Chat.
- Authorized Desktop agents can read rendered public pages, follow links, and cite the final URL.

- Interactive browsing requires app and workbench opt-in and limits each session to approved public origins.
- Desktop has an on-demand, verified Chromium runtime and isolated browser sessions for interactive browsing.

- Dictate into the chat draft with the microphone or a configurable shortcut, then review and send.
- Desktop dictation captures bounded microphone audio and transcribes offline with multilingual Whisper.
- Dictation Settings downloads and manages local Whisper models and remembers the spoken language.
- Chat replies and code blocks offer exact copying; explicit Bash and PowerShell blocks run in compatible terminals.
- Desktop links delegated sessions, shows their outcomes and lets users stop a running child.
- Agents can launch, monitor, stop and collect results from delegated inspection sessions.
- Core sessions can launch inspection-only children with durable ownership and bounded workbench concurrency.
- Windows and Linux packages ship both pinned local embedding models and their MIT licence notices.
- The local embedding registry and model preparation now include pinned Multilingual E5 Small q8 assets.
- The agent can inspect workbench images with image-capable models using the view_image tool.
- Sent chat images open from transcript thumbnails, and deleted images show their saved paths.
- Paste, drop or attach images in chat, with removable previews and a warning for text-only models.
- Chat can send workbench images to supported models and keeps their paths in history and exports.
- Settings > Providers can save image input capability for each local or compatible model.
- CLI: --key-env <NAME> takes the provider key from the named environment variable, for any provider.
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
- Documents preview in New workbench and the editor counts with the indexer's selection: ignore files and limits.
- The Documents preview says "at least" when its 5-second limit stops it and shows the count guard before saving.

### Changed

- Control delegated Full Access for all workbenches from Settings > Permissions, off by default.
- Enable recommended answers and set their timeout on one row in Agent and chat.
- Align the Reindex button with the indexing details in Workbench overview.
- Align Agent and chat fields in compact label-and-control rows.
- Align the empty Plugins list actions on one row when space allows.
- Move indexing details to the single-column Workbench overview and keep Files compact.
- Show workbench tools with installed providers and add a catalog shortcut when no plugins are installed.
- Show command shells as individual choices with the detected executable paths.
- Put Restore default text sizes beside the interface language selector.
- Keep provider actions on one row and remove redundant labels in Settings.
- Choose a provider, set model defaults, edit LM Studio models and follow connection-test progress in Settings.
- Evaluators: one folder per family with code, method, cases and baselines; perf:sessions is now eval:performance.
- Open recorded session edits beside Chat from the Changes list.
- Changes paginates long session histories and retains the selected diff across pages.
- Chat shows one working indicator below the composer at every detail level.
- Group compact Chat model choices by provider and make all composer selectors visibly bordered.
- Long chats use calibrated token estimates and compact in the background; context summaries survive restarts.
- Close VERA and delete each workbench's .vera/vera.db, .vera/vera.db-wal and .vera/vera.db-shm from earlier builds.
- Switch local embedding models per workbench while keyword search continues during the background rebuild.

- Indexing and semantic search use the workbench model and its token budget. Idle embedding workers stop.

- Workbench Tools keeps core capabilities; Plugins groups specialized allowances by provider and shared ecosystem.
- Skills clarifies activation and scopes, opens new instructions immediately and supports read-only viewing and retries.
- Electron 44.11.4, zod 4.6.7 and Vite 7.3.8; undici, hono and fast-uri are raised through the lock file.
- The BenchPilot reference copy under 09_Others is removed; the planning documents no longer cite it.
- Tests: the last three plugin suites with real-tool gates report named skips.
- Help: additional folders, command approvals and terminal consent are each explained once, with links.
- Packaging warns about files in the model and Windows runtime folders that their manifests do not name.
- Lint: non-null assertions are allowed in tests and the CSS specificity rule is off; about 300 warnings are gone.
- Tests: plugin suites that need a real tool or archive report a named skip saying what enables them.
- Tests: the command integration test reports a named skip on Windows hosts without PowerShell 7.
- Test fixtures have a provenance list; five files are listed with no recorded origin.
- Delivery verify warns about unsigned installers, an unsigned catalog, mixed commits and a dirty tree.
- Packaging warns about files in the bundled plugins folder that no catalog index lists.
- catalog sign warns when the signing key is not checked against a public key.
- The plugin catalog workflow template runs with read-only repository permissions.
- The planning overview and the test, evaluator and sandbox READMEs are in English and match the code.
- Shell commands run under PowerShell Constrained Language Mode; cmdlet text keeps the console code page there.
- Tool activity shows readable plan steps; translation catalogs refresh in an already running development app.
- Commands aligns Cancel and Save at the top right, matching Data & privacy.
- Files shows active indexing or failures; large-selection advice stays in the documentation setup preview.
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
- Program runs and user terminal output follow live app/workbench masking, default off; agent reads keep their policy.
- Display masking follows app and workbench choices while keeping secret-named files visible and openable.
- Auto-edit uses saved command prefixes; destructive shell commands always ask outside Bypass.
- lab-validation 0.3.0: HIL validation reads host-approved outside inputs with workbench-owned output.
- Bypass extends to analysis, plugin drafts, HIL plans, bench resources and electrical inputs.
- Bypass runs declared programs in outside folders, binds outside files and stops its runs when Bypass ends.
- Bypass confirms each mode change; agent file access refuses VERA application data in every mode.
- Delete settings.json from earlier pre-releases after changes to Bypass and desktop notification preferences.

### Fixed

- Keep the long-history compaction evaluation within the replay budget and include the planted instruction.
- Center the open-tab search dialog and keep its controls within the window.
- Reuse a model's measured context estimate in new sessions that share the same application data folder.
- Keep the conversation and composer visible when the update banner takes space in a compact window.
- Keep Windows portable session alerts in VERA without registering with the Windows shell.
- Write the VERA product name into unsigned Windows packages.
- mqtt-tools 0.2.2: CLI output stays intact with MQTT usernames, and passwords remain masked.
- Show concrete citation examples to models for local files, indexed documents and VERA help.
- GitHub release downloads include the Chromium and Whisper archives and licence notices for offline installation.
- Chat and Files search published documents while indexing continues and recover from concurrent publication.
- Run verified plugin subcommand help without a device approval.
- arduino-cli 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- ble-tools 0.2.1: Exact help for supported subcommands no longer needs a device approval.
- bus-tools 0.1.1: Exact help for supported subcommands no longer needs a device approval.
- can-python 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- circuitpython 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- esp32-efuse 0.2.1: Exact help for supported subcommands no longer needs a device approval.
- esp32-esptool 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- micropython 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- mqtt-tools 0.2.3: Exact help for supported subcommands no longer needs a device approval.
- platformio 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- power-profiler 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- probe-rs 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- raspberry-pi-linux 0.2.1: Exact help for supported subcommands no longer needs a device approval.
- serial-monitor 0.2.2: Exact help for supported subcommands no longer needs a device approval.
- wokwi 0.2.1: Exact help for supported subcommands no longer needs a device approval.
- zephyr 0.2.2: Exact help for supported subcommands no longer needs a device approval.

- Report redirected workbench runtime folders before closing the workbench.
- Keep saved Plan feedback live-masked, require stale-fragment recapture and skip discovery during review preparation.
- Chat Run skips terminals after startup timeout until their verified prompt arrives without intervening input.
- Chat Run skips ineligible terminals and disables invalid command blocks before creating a terminal.
- Chat Run requires a verified empty shell prompt, preserves user input, and restores focus when selection is cancelled.
- Open document tabs no longer reload when only theme, language, text size, shortcuts or session order change.
- Opening a run log larger than 8 MiB shows its last 8 MiB instead of loading the whole file into memory.
- Saving a provider API key masks it in open document tabs at once.
- String-launcher programs (ESP-IDF via EIM) refuse arguments with typographic quotes, which PowerShell reads as quotes.
- Agent runtime errors carry the standard keys errors.INTERNAL and errors.PROVIDER.
- About lists the libraries of the core and shared packages too; installers carry THIRD-PARTY-NOTICES.txt.
- Help: the shortcuts page uses one term per language and describes F10 as it works.
- eval:performance prints the stack trace when a run fails.
- stm32-cubeprog 0.2.1: writing readout protection level 2 (RDP=0xCC) asks for its own typed word; it is permanent.
- wireshark-tshark 0.3.1: commands that write a file (-w, --export-objects, key or log files) ask for approval.
- ngspice 0.3.1: a run whose log and series outgrow 4 GiB is stopped with a message naming the limit.
- kicad-layout 0.3.1: the helper no longer runs a script or editor named by test environment variables.
- probe-rs 0.2.1: the flash skill refers to the esp32-flash skill only when the esp32-esptool plugin is enabled.
- Session search reads only the messages that can match instead of every message of every session.
- File completion in the composer stops after 50,000 folder entries instead of walking the whole workbench.
- A secret pasted into the first message no longer appears in the automatic session title.
- Offline dependency kit: a wheel that differs from its SHA-256 in kit.json is refused and named before install.
- Bench leases: a lease left from before a restart no longer blocks a resource when its process ID is reused.
- Catalog check reports plugins that require each other in a circle.
- PDF indexing runs under a memory limit and stops at 50,000 pages or 32 million characters of text.
- read_doc reads a page, slide or line longer than 12,000 characters in parts instead of failing.
- Closing or switching a workbench waits at most 5 seconds for a busy embedding worker.
- Document chunks are validated before the database transaction that stores them.
- Quitting VERA while an export save dialog is open no longer hangs; the dialog no longer stalls session calls.
- A second VERA instance exits before it opens the first instance's data, key files or workers.
- Session, workbench and app events are validated once per event instead of once per subscriber.
- Chat: a list with blank lines between its items no longer reflows when a streamed answer completes.
- Chat: a link confirmation opened while an answer streams stays open when the answer completes.
- Chat: live reasoning and tool output keep only their most recent text during very long turns.
- Chat: a session view recovers by itself when a background refresh call never answers.
- ChatGPT sign-in status is polled only while a sign-in is in progress.
- Errors with an unknown message key show the message for their error code, not "internal error".
- PDF viewer: long documents open sooner; page sizes are measured in the background.
- CLI: OPENAI_API_KEY is used only for the OpenAI provider, never sent to a custom provider's host.
- Commands with one-letter options such as -p, -r, -m, -d or -h can be saved for automatic approval.
- Internal turn and model stream failures are written to the application log, with secrets masked.
- Register definitions have length limits on names, labels and addresses.
- Parallel parts searches of one supplier start 250 ms apart to avoid request bursts.
- Windows runtime preparation matches the Microsoft signer exactly.
- The release-notes check no longer crashes when Git is not installed.
- kicad-layout 0.3.1: a library table that names a network path is left out of the candidate, with a warning.
- kicad-layout 0.3.1: the KiCad API socket is looked up in the user's temporary directory on Linux too.
- freerouting 0.3.1: --run follows the shared path rules; help no longer claims nothing leaves the computer.
- renode 0.3.1: platform files with ordinary words such as "empty" or "description" are no longer refused.
- mqtt-tools 0.2.1: a run that sends a stored credential warns which broker host and port received it.
- lab-validation 0.3.1: reports and help state that a verdict is only as trustworthy as its result folders.
- serial-monitor 0.2.1: --duration is capped at 7 days and --until at 1024 characters, with a clear message.
- gdb-debug 0.2.1: the approved registry hash is accepted in upper or lower case.
- zephyr 0.2.1: a manifest path or probe serial starting with "-" is refused with the reason.
- zephyr 0.2.1: flash results say whether the registry was verified against the approved hash.
- platformio 0.2.1: upload results say whether the registry was verified against the approved hash.
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
- Approval shortcuts A and D no longer fire while the command-prefix list has the key.
- Saved command prefixes no longer approve git forms that run a named program or discard work.
- A saved command prefix that is no longer eligible is ignored; its workbench still opens.
- On Linux, a file deleted while its bytes are read is reported as missing, not as a conflict.
- UI checks read the renderer's address from coloured output and wait for a pending bookmark update.
- Closing a terminal suspends its I/O and ignores late responses from the terminal being closed.
- Tool calls no longer show blank output blocks when the result is empty or contains only whitespace.
- Terminal text follows the code/output text size setting immediately and refits its rows and columns.
- Terminal history replay no longer injects control replies into the shell when reopening or switching tabs.
- Windows command Stop waits for descendant cleanup and reaps children created during process-tree termination.
