# VIEW — A lister for any workbench file

PURPOSE: open any workbench file inside VERA the way a file manager's lister does: as text with word wrap and a
chosen encoding, as hex, or rendered, without a size limit and without an external program.
STATE: planned 2026-11-15. Product code follows AEGIS, one work package per task.

## Today (2026-11-15)

- The Files tab lists every file and folder, ignored ones marked; it skips symbolic links and stops at 5,000
  entries per folder (`core/src/workbench/tree.ts`).
- The viewer renders PDF (pdf.js), Markdown, HTML and Office text, and shows any UTF-8 text up to 5 MiB as
  numbered lines (`docs.read` → `readText`, `TEXT_VIEW_LIMIT`). It refuses other encodings and binary files
  ("This file is not text") and larger files ("larger than 5 MB"). Lines never wrap; there is no hex view and no
  image view. Open externally hands a file to a system program.
- Stored secrets (provider keys, plugin credentials) are always replaced by `[REDACTED]` in what VERA shows:
  viewer text, document lists, program run arguments and logs; the Files tab and Find even drop entries whose
  path contains a stored secret (`credentials.scrub` in `desktop/src/main/index.ts`).

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
