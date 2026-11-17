# VIEW — A lister for any workbench file

PURPOSE: open any workbench file inside VERA the way a file manager's lister does: as text with word wrap and a
chosen encoding, as hex, or rendered, without a size limit and without an external program.
STATE: VIEW-01 committed at 2a886177455e1c2adc669072b768e7af50f62367 (TASK-64079701, #286 closed); VIEW-02 committed at c6ede1959372fd1c39b7411f35a4a40a6bb3d91b (TASK-9a5b9ff2, #287 closed); VIEW-03 committed at b33e44979a840b3a945316b4d43fed8e5631475a (TASK-d6ed6549, #288 closed); VIEW-04 committed at e1e477afbeccd86ff96fd48e65b23bc5e28ebe5f (TASK-5bdc042a, #289 closed); VIEW-05 committed at f272ad5179e6f52f36263b12cbbf3d444eb48407 (TASK-a4d526f6, #290 closed); VIEW-06 implemented candidate (TASK-180f3be3, #291; coordinator owns acceptance/commit and #291/#285 closure). Product code follows AEGIS, one work package per task.

## Current implementation (2026-11-17)

- The Files tab lists every file and folder, ignored ones marked; it skips symbolic links and stops at 5,000
  entries per folder (`core/src/workbench/tree.ts`).
- The viewer renders PDF, Markdown, HTML and Office text. Ordinary text files up to 5 MiB assemble masked byte windows and detect UTF8/UTF16 BOMs, otherwise UTF8; users may select six
  encodings or explicitly Show as text with replacement characters. Word wrap measures virtual
  source rows for Find/Go to line and retains the visible source anchor across width/wrap changes.
  Larger text uses64 KiB windows, a byte scrollbar, bounded sparse progressive indexing, exact-settling
  Go to line and cancellable windowed Find with matching-line counts and wrapping. Verified large-text
  citations use compact, sealed revision-bound sources and retain their original range; rendered
  formats keep their established paths. Hex offers bounded16-byte virtual rows, offset navigation, cancellable UTF8/hex Find and masked selection copy from the Files menu. Plain-file toolbar modes use real host extension keys and current indexed Rendered availability, retain readable Text for unindexed/ignored Markdown/HTML, and remember deliberate choices across restart; binary/unknown files default Hex. PNG/JPEG/GIF/WebP/BMP/SVG previews are index-independent, fitted and zoomable through400%; SVG stays an inert image, and Text/Hex remain available.
- Display masking is live, defaults off and supports per-workbench overrides. Opaque workbench-owned identities
  retain secret-named Files/Find entries. MASK-02 is committed at cb8f0bcd; the completed MASK predecessor
  sequence ends at b709882a9f23d64966c0e44cedbb1dc3bcd23e06 (VIEW-01 base).
- VIEW-01 adds `docs.readBytes` and reuses `docs.stat`: physical offsets/size, at most 1 MiB returned and
  64 KiB host-only matching context per side. Masking replaces intersecting secret bytes with 0x2A for UTF-8,
  UTF-16 LE/BE and supported single-byte encodings, with whole-window masking for overlong secrets.
  Contract: `.agentic/specs/REQ-FUNC-69645e84.md`. Done A/B: focused shared/core/host/transport tests and
  real stored-credential/200 MiB Windows and WSL2 probes in ignored `evaluation-outputs/view01`.
  VIEW-01 coordinator commit: 2a886177455e1c2adc669072b768e7af50f62367. Native Ubuntu and final delivery gates remain deferred.

- VIEW-02 Done A/B browser/native acceptance: tests/e2e/text-encodings.spec.ts, original geometry
  receipts/screenshots/logs in evaluation-outputs/view02. Focused tests cover decoding, explicit
  replacement, bounded consistent reads and existing viewer consumers. Coordinator committed VIEW02 at c6ede1959372fd1c39b7411f35a4a40a6bb3d91b and closed #287.
- VIEW-03 DoneA/B uses tests/e2e/large-text.spec.ts and a genuine 200 MiB variable-row log, with original
  browser/native receipts, heap/pulse measurements and logs in evaluation-outputs/view03. Bounded
  source/index/search and boundary/cancellation tests sit in large-text.test.ts. TASK-d6ed6549/#288
  was committed by the coordinator at b33e44979a840b3a945316b4d43fed8e5631475a; #288 is closed.

- VIEW-04 Done A/B: hex-source.test.ts, hex-viewer.test.ts and native tests/e2e/hex-viewer.spec.ts prove cross-window Find, partial rows/nonprintables, keyboard selection across displayed windows, actual clipboard, bounded rows and live stored-credential Display refresh. Original proof: evaluation-outputs/view04. TASK-5bdc042a/#289 was committed by the coordinator at e1e477afbeccd86ff96fd48e65b23bc5e28ebe5f; #289 is closed.

- VIEW-05 Done A/B: file-mode.test.ts and document-tabs.test.ts cover defaults, mode switches, opaque extensions, storage failures and citation provenance; tests/e2e/viewer-modes.spec.ts provides browser and Windows Electron acceptance with two Markdown files and a full application restart. TASK-a4d526f6/#290 was committed by the coordinator at f272ad5179e6f52f36263b12cbbf3d444eb48407; #290 is closed. Original proof remains in evaluation-outputs/view05.

- VIEW-06 Done A/B: image-source.test.ts, image-viewer.test.ts and file-mode.test.ts cover bounded consistent reads, cancellation/URL cleanup, errors and independent applicability/preferences. tests/e2e/image-preview.spec.ts previews PNG/JPEG/GIF/WebP/BMP/SVG and checks real Hex signatures for each, scripted SVG inertness and no external loads, original-resource400% raster/SVG geometry, zoom back/fit/resize, opaque identities, live stored-credential Display refresh and corrupt-image Retry. Browser and Windows Electron proof/logs/screenshots remain in evaluation-outputs/view06. TASK-180f3be3/#291 is an unstaged candidate based on VIEW05 commit f272ad5179e6f52f36263b12cbbf3d444eb48407; coordinator alone accepts/commits/closes #291 and epic #285.
- All six VIEW implementations are present. This is focused feature acceptance, not the deferred final integrated gate: there is no calibrated comparison with the session-open performance budget. Native Ubuntu, final complete app/plugin/E2E suites and exact-source delivery verification remain user-deferred/coordinator-owned. Unchanged byte/native/packaging proof is reused; no200MiB rerun or delivery rebuild is claimed. Encoded image Blob and browser decoded surfaces require memory proportional to image size and remain subject to browser decoder resources, without an arbitrary image file cutoff.

## Decisions (2026-11-15)

- **Extend VERA's own viewer; bundle no external viewer.** An external program would add per-platform binaries
  and licenses and could not show citations. Chromium's `TextDecoder` already decodes the encodings needed.
- **One viewer, several modes:** Rendered (PDF, Markdown, HTML, Office, images), Text and Hex, switched in the
  viewer's toolbar. The last mode is remembered per file extension.
- **Large files are read in byte windows** from main, confined to the workbench like every file read; nothing
  loads a whole large file into the renderer.
- **Masking of stored secrets follows the [secret masking plan](secret-masking.md)** (Display area): off by
  default, settable per workbench; when on, the viewer masks them in Text and Hex.
- **Read-only.** The viewer never writes; editing stays with the agent's write and edit tools and approvals.

## Work packages

| WP | Title | Result |
|---|---|---|
| VIEW-01 | Byte-window reads | `docs.readBytes {workbenchId, path, offset, length}` (length at most 1 MiB) and `docs.stat` with the file size: ordinary files only (no links, no outside paths, ignored files allowed as today), the inode checked against the stat like `readText`, a typed error for a file that changed or vanished |
| VIEW-02 | Text mode with wrap and encodings | Word wrap on/off; encoding detected from a BOM (UTF-8, UTF-16 LE/BE), otherwise UTF-8, with a chosen alternative (Windows-1252, ISO-8859-1, ISO-8859-2, UTF-16 LE/BE); "Show as text" for a file with a few invalid bytes, shown as replacement characters; Find and Go to line keep working; with wrap on, lines are measured so the virtual scroll stays exact |
| VIEW-03 | Large text files | Text beyond 5 MiB is read through VIEW-01 windows on demand: the scrollbar maps to byte offsets, lines are indexed as windows load, Go to line jumps by an approximate offset and settles on the line, Find searches window by window with a cancel |
| VIEW-04 | Hex mode | Offset, 16 bytes in hex and their printable characters per row, virtualized over any size through VIEW-01; go to offset; find text or a hex byte sequence; copy the selection as hex or text |
| VIEW-05 | Mode switch and binary files | Toolbar with Rendered, Text and Hex where they apply; a binary or unknown file opens in Hex instead of the "not text" message; the remembered mode per extension; Open externally stays |
| VIEW-06 | Image preview | PNG, JPEG, GIF, WebP, BMP and SVG (SVG as an image, never as live markup) shown fitted with zoom, read through VIEW-01; Hex stays available |

Order: VIEW-01 first (it reads its masking from MASK-02); VIEW-02 and VIEW-04 after it, independent of each other; VIEW-03 after VIEW-02; VIEW-05
after VIEW-02 and VIEW-04; VIEW-06 last. Help pages (app help, Documents and search) and the four interface
languages are updated inside each work package.

## Verification

- Unit: `readBytes` refuses links, outside paths, a negative or oversized window and a file replaced between
  stat and read; it masks a stored secret in text and hex only when the Display area resolves on; encoding
  detection by BOM; hex row formatting.
- Component: wrap on/off keeps Find and Go to line correct; Hex finds a byte sequence across a window border;
  a binary file opens in Hex; the mode is remembered per extension.
- E2E (browser mock and native): a 200 MB generated log opens, scrolls to the end, finds a late line and jumps to
  a line number without the window freezing; a Latin-1 and a UTF-16 file show correctly; an image previews.
- Performance: opening a 200 MB file shows the first screen within the same budget as a session open; memory
  stays bounded while scrolling to the end.

## Out of scope

- Editing files in the viewer, syntax highlighting for every language, and indexing more formats (code and logs
  stay unindexed, RULING-005); following symbolic links in the Files tab.
