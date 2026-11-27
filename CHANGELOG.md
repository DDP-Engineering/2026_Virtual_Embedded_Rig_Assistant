# Changelog

Notable changes to VERA. Format: Keep a Changelog; versions: Semantic Versioning. Every version below
1.0.0 is a pre-release with no upgrade path from earlier builds. Rules: `01_Documentation/Releases.md`.
Older releases: `06_SoftwareDocu/CHANGELOG-archive.md`.

## [Unreleased]

### Added

- Configure chat image count and file size in Advanced settings, with a clear message for provider size refusals.
- Let the agent find saved artifacts in the current session with `artifact_list`.

### Changed

- Open session search on demand from a magnifier next to New session.
- Move delegated access and desktop notification settings to Data & privacy.
- Simplify plugin cards, group help under Details, and keep dependency actions on applicable cards.
- Install verified official skills-only plugins directly and show a compact confirmation when needed.
- Simplify workbench plugin selection and group agent tools and program setup in Details.
- analysis-skills 0.4.0: Route firmware analysis by intent and build manual plans from saved comparisons.
- analysis-skills 0.4.2: Find a saved comparison for manual test planning after reopening the session.
- Read verified text artifacts by reference in their owning session.
- Speed up paged reads of large files while retaining line counts and file verification.
- Reduce filesystem work when listing and searching large directories.
- Verify document reads with bounded memory and reuse locator checks within each message.
- Reduce document search work on large indexes by applying filters before loading fragments and vectors.
- Return keyword results when hybrid document search reaches the time limit for semantic ranking.
- Start commands faster with focused Windows shell lookup and batched pruning of old run logs.
- Skip rebuilding and resending unchanged terminal output between polls.
- Reuse decoded chat images during a turn while their files stay unchanged.
- Stream web downloads to disk and validate staged PDFs in their worker.
- Reuse an Exa connection within each turn for faster web search and reading.

### Fixed

- analysis-skills 0.4.1: Save exact tool-issued line citations in firmware reports and manual test plans.
- Keep the chat controls in place when the provider returns a reasoning error.
- Continue file and artifact reads from the last line delivered when a page is shortened.
- Return unchanged file writes and edits without approval or rewriting.
- Limit diff calculation time while keeping large file changes available for approval.
- Report when a file was saved and the change history is still pending.
- Identify UTF-16 as an unsupported editing encoding in file write errors.
- Classify large files from their first bytes and in parallel batches during `grep`, so a search over a workbench with a build folder no longer reads every object file.
- Read and search a file that is being appended to, such as a serial capture or a running build's log; `read` marks it as growing.
- Keep CRLF line endings, the UTF-8 BOM and a Latin-1 encoding when `write` overwrites a file.
- Match an LF passage in a file with mixed line endings when `edit` receives it as written.
- Say why `grep` cannot search a file it is given by name when the file is binary or above the size limit, instead of returning no matches.
- Name a missing file or a folder in the `read` error instead of passing on the system message with its absolute path.
- Return the page or line count from `read_doc`, the next heading of a section, and all headings when no heading is given, so Word, spreadsheet and HTML documents can be read from start to end.
- Say why `read_doc` cannot read a document by its index state: not in the workbench documents, waiting to be indexed, scanned without text, too large, unsupported type or failed.
- Let `program_output` wait up to 10 minutes for a background run in one call.
- Show the passage that holds the searched terms in `search_docs` snippets instead of the start of the fragment.
- Leave `.vera`, `.git` and `node_modules` out of `grep` and `glob` searches in Bypass unless the search path or pattern names them, so a search finds the sources instead of timing out in dependencies.
- Name the credential environment variables a failed `run_command` ran without, so the agent can say why a tool reports that it is not signed in.
- Tell the agent how a terminal is shared when `terminal_read` finds none shared.
- Report missing search locations and apply filename filters to explicitly selected files.
- Keep discovery results when a file disappears and stop directory enumeration on cancellation.
- Apply grep file limits to distinct paths and return complete counts for fully searched files.
- Keep document citations and pagination aligned with the configured response limit.
- Omit outdated results when indexed document sources change or disappear.
- Bound command cancellation on Windows and keep the final output when command results are shortened.
- Preserve background output after cancelled reads and report timeouts and startup errors.
- Preserve the end of long terminal lines and mark shortened terminal reads.
- Accept bracketed terminal pastes at the text limit and explain when input is too long.
- Let users reduce image attachments and resend after a provider size refusal.
- Let Stop end the turn while an image is decoding.
- Preserve web citations when results are shortened, including Tavily links to sections.
- Report the configured time limit when a web download times out.
- Send the first message to a model with a 32K context window: before a model's first answer a request counts two bytes per token instead of one.
- Read web pages that state a publication date or an author; `web_read` refused them with the default provider.
- Continue a long web page or document with `web_read`: a shortened result gives the position to continue from and the page's length, and `offset` reads from any position.
- Report a web page as shortened when its text was cut at the requested size.
- Read large documents through Tavily instead of failing on the reply size.
- Download from a host's next address when the first cannot be reached, as on a network that announces IPv6 without routing it.
- Save a download whose server states no content type or a malformed one, or marks the reply as encoded, instead of refusing it.
- Tell the agent to use `run_command` for a device or server on the local network when a web tool refuses the address.
- Suggest adding an API key when a web provider's limit is reached without one.
- Save and verify session artifacts asynchronously, skipping identical overwrites.
- Shorten long session artifact descriptions while still saving the full artifact content.
- Save a session artifact whose name has spaces, accents or a folder separator under a portable name instead of refusing it.
- Replace an artifact when its name is given in another letter case, instead of two contradictory refusals on Windows.
- Accept saving an artifact's stored content again without `overwrite`.
- Retry and explain an artifact save refused because another program has the file open.
- Name the artifact name, not its content, when the name holds protected data, and correct spacing in artifact messages.
- Stop turns without waiting for workbench preparation and retain question replies that exceed the text limits.
- Keep plan steps valid after masking and let the agent read the complete saved plan in pages.
- Track delivery of queued delegated instructions and read status without replaying the full child conversation.
- Keep the opening and conclusion when shortening delegated replies and clarify the scope of delegated Stop.
- Wait up to five minutes for a delegated turn by default, so a parent no longer spends its tool calls polling a working child.
- Report a delegated child's approval request once and then wait for the user's decision instead of returning at once on every wait.
- Tell the parent why a delegated turn failed and whether trying again can help.
- Take a question's recommendation written as text, so its mark and automatic answer are kept.
- Ask a plan decision as an ordinary question when the session has no plan, instead of an unexplained tool failure.
- Accept a plan with another word for a status or a step that is too long, and drop blank steps.
- Keep each skill's metadata and files tied to the selected source, skip plugin scans for local skills, and report missing and disabled skills distinctly.
- Stop waiting on Help promptly, page long Help and skill text, and open Help citations in the cited language.
- Load a skill file cited with a leading `./`, which was refused as restricted.
- Read skills saved as UTF-16 or in the ANSI code page, as PowerShell and older editors write them.
- Say whether a skill or its file is missing and list the enabled skills, and name the help pages when one does not exist.
- Take a skill or help page name written in another letter case, with spaces or with `.md`.
- Warn about invalid draft skills, check trial replacement before approval, and honor Stop before installation.
- Validate and install a plugin draft kept under version control: `.git`, compiled caches, a virtual environment and desktop files are left out of the package and listed.
- Explain each plugin validation error and say why a draft cannot be read, instead of codes and a bare tool failure.
- Say why a trial plugin was not installed after the approval, such as a draft changed since its review.
- Preserve browser citations, release empty sessions, and report tab selection and scroll movement accurately.
- Analyse a serial capture that holds stray bytes or one overlong line instead of refusing the whole log.
- Analyse a log that is still being written, as the bytes it had when opened, and a capture saved as UTF-16.
- Cite a PDF page or a heading as the source of a register definition, and define registers of any width up to 64 bits with notes and up to 256 enumerated values.
- Name each problem of a register definition and its place, and the argument a log or register call got wrong.
- Take a register value written as a number, in binary, with a hex suffix or digit separators, a register name in another letter case, and log level names such as WARNING.
- Preserve log counts and citation revisions, make register decoding cancellable, and clarify invalid arguments.
- Open and validate citations to a log that holds stray bytes, was saved as UTF-16 or kept growing after its analysis.
- Number log lines the way `read` and the viewer do, so a cited line is the reported one in captures with CR CR LF endings or rewritten progress lines.
- Apply the tolerant reading of tool arguments in sessions as well: plan statuses, skill and help names, register values and log levels were still refused there.
- Find a session artifact by any part of its name, in any letter case and by the name it was asked to be saved under; a filter that matches nothing says how many artifacts the session has.
- Read an artifact by its name in another letter case, and say that an artifact does not exist instead of a bare tool failure.

## [0.4.0] - 2026-11-26

### Added

- Filter the plugin library by requirements and show the same requirements on each plugin card.
- Show delegated sessions under their parent with their latest outcome and keep the tree together when moving rows (#407).
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

- Raise default tool calls per turn to 200 and concurrent turns to 4 (#406).
- End turns that reach the tool-call limit with a summary of the work and offer Continue (#406).
- Group completed program and shell operations in chat and clarify approval details.
- Replace in-chat parent and child navigation with the sidebar tree and keep the child's outcome visible in chat (#407).
- Start delegated turns from Bypass in Auto-edit by default and use Bypass when delegated Full Access is enabled (#405).
- Update in-app help for chat, indexing, providers, and startup in all four languages.

### Fixed

- Bound compaction prefix selection and skip failed automatic summary retries within a turn.
- Keep successful index rows on retry and support legacy text encodings in document extraction.
- Scope program log reads, preserve approval rules, and reclaim stale workbench locks safely.
- Preserve chat drafts, paginate sessions, and improve transcript and terminal navigation.
- Keep open documents during unrelated settings changes and reuse bounded results in log search.
- Allow changing reasoning during delegated work without changing its admitted first request.
- Verify update metadata against the installer files and blockmaps in each delivery.
- Set the first API-key or local provider's model as the default and explain when no model is selected.
- Show a dialog naming the file and keys when `settings.json` is invalid, instead of exiting silently.
- Offer Retry after a provider error, only while the failed message is still the latest one.
- Stop refusing messages, session names and settings that contain a stored secret; masking still applies.
- Search file paths directly in `grep`, report skipped files, and match bare `grep` and `glob` patterns at any depth.
- Keep the other bytes of a file that is not UTF-8 when `edit` changes it.
- Report real Windows PowerShell 5.1 exit codes and tell the model which shell runs commands.
- Let the agent read the full log of a command it ran, in `.vera/runs`.
- Keep subscripts, superscripts and font changes on their line in PDF text. Delete `.vera/cache/extract` and reindex.
- Render a PDF that is not indexed instead of showing it as hex.
- Accept a citation of one page inside a page range the agent read.
- Ignore a click on the indexing progress indicator instead of queuing a full reindex.
- Keep text typed in the message box when another session, Settings, Help or Plugins is opened.
- Answer a waiting question from the message box or press Enter in the question's text field to submit.
- Show a notice with Continue when the model stops at its output limit.
- Open web links from answers directly; the dialog appears only when a link cannot be opened.
- Focus Stop in the stop confirmation, so Esc then Enter stops the turn.
- Allow renaming a session while its turn runs.
- Allow saving command prefixes for `idf.py`, `pio run -e`, `make -C`, `ninja -C` and `git -C`.
- Accept absolute paths inside the workbench in file tools, and apply Windows file-name rules only on Windows.
- Stop refusing an embedding model change because a document finished indexing meanwhile.
- Keep the message box locked in an archived session, and show Bypass by name in the workbench overview.
- Open files without known extensions and logs with ANSI colour codes as text.
- Treat a log with a few stray NUL bytes as text in `read`, `grep` and the viewer.
- Find register names by an all-capital fragment, such as MODER in GPIOx_MODER.
- Compute embeddings on up to four threads.
- Describe the parameters of `read`, `grep`, `glob` and `edit` for the model.
- Title the secret masking switches in Data & privacy.
- Log the error type and code location when an internal request fails.
- Search sessions by title and message text from the sidebar.
- Scroll to the end of the conversation when a message is sent.
- Render PDF pages at display density, zoom up to 400 %, and render oversized pages at a lower resolution.
- Add Cancel to the ChatGPT branch of the Add provider dialog.
- Say what to do when a PDF is not indexed, instead of pointing `read` and `read_doc` at each other.
- Offer Open Providers for missing models and refused credentials, and show the missing-model hint on the start screen.
- Open a new session right after a workbench is created.
- Say that a session's model or provider was removed, instead of reporting an internal error.
- Let a parent session wait up to 10 minutes for a delegated session in one call.
- Offer Compact now on a context-limit error in chat.
- Step through transcript search matches with Enter and Shift+Enter.
- Keep Save off in Edit workbench while chunk size, overlap, results per search or the default model is invalid.
- Go to a page in a PDF with Ctrl+G or the document menu, and start Find at the page in view.
- Accept a compaction summary with text around its JSON object, a missing list or non-text list items.
