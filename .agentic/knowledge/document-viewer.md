# Document viewer and Docs index panel

## Routing

Select for citation opening, the document tabs of the chat area (open, select, close, kept places,
per-session sets saved per session), continuous PDF/text scrolling with zoom/find/go-to-line/snippet,
Markdown/HTML/office anchors, presentation slides, numbered lines and Docs
status/search/reindex/progress, and the Docs folder tree (single search box, ignored entries,
memory, keyboard, context menu, Properties).
Select file-mode.ts for ordinary-file toolbar modes and extension preferences; image-source.ts and image-viewer.tsx own index-independent PNG/JPEG/GIF/WebP/BMP/SVG preview, fit and zoom.
Start under05_Software at main/display-documents.ts and display-identities.ts for conditional
Display masking, shared/documents.ts, core/knowledge/viewer.ts and
renderer/components/documents (hex-{source,rows,viewer} for byte viewing; text-encoding.ts, read-text-file.ts, use-text-rows.ts, large-text-{source,index,find,window,rows,viewer} for byte-backed text). Focused tests are viewer.test.ts, search.test.ts,
documents.test.ts, docs-tree.test.ts, core workbench/tree.test.ts and
tests/e2e/{citations,documents,office-documents,docs-tree}.spec.ts.
[Document search](document-search.md) owns retrieval/extraction validity;
[sessions](sessions.md) owns successful-tool issuance; [ingest](knowledge-ingest.md)
owns the index queue; [artifacts](artifacts.md) owns managed content/actions.

## Purpose and boundaries

Core DocumentViewer resolves verified current content over guarded sources and
persisted full extraction. WorkbenchService serializes reads with its lifecycle;
SessionService resolves issued citation provenance/snippets and session artifacts.
The sandboxed renderer renders typed data through authorized IPC. Host services
own authority and bytes; the provider scope owns presentation and lifetime; index
progress travels through existing workbench events.

## Public interface

- Plain path/textPath targets use file-mode.ts: docs.stat supplies a real extension key computed by main before path identity projection; recognized extensions use their lower-case public vocabulary and unknown suffixes use the existing host-keyed identity namespace, independent of filename/workbench/Display state. Unknown extensions default Hex; recognized text uses a fixed4096-byte prefix to detect binary control bytes with BOM-aware decoding. Core statEntry supplies a compact rendered capability from the current indexed record, matching size/mtime, extraction presence (or needs-OCR PDF pages) and current ignore rules, using a direct path lookup rather than loading all documents or source bytes. Available indexed PDF/Markdown/HTML/Office sources and recognized images offer Rendered/Text/Hex. Images default Rendered independently of indexing. Other files offer Text/Hex: unavailable Markdown/HTML defaults Text, unavailable binary containers default Hex. A saved unavailable Rendered preference remains unchanged. Raw text remains explicitly available for unknown formats, with existing encoding/replacement controls. No complete large text is fetched to choose a mode.
- ImageFile is transient host-owned metadata with MIME, never persisted or placed in shared ViewerContent. Plain-image Rendered uses the same confined stat boundary as Hex and never calls docs.open. ImageViewer owns a fresh HexSource and AbortController per effect; readImageBlob assembles64KiB Display-policy byte parts, yields between parts and rechecks final size/mtime before creating a MIME Blob. Encoded data and the decoded browser image require memory proportional to image size; there is no arbitrary size cutoff. The effect creates/revokes its Blob URL; replacement, Display attempt refresh and unmount abort stale publication. SVG enters only img, with no live markup, scripts, handlers, navigation or external-resource loads. Only img-src adds Blob to local resources; other CSP restrictions remain. Decode failure uses safe localized text and Retry; typed read failures retain ErrorMessage and Retry, and the parent Text/Hex toolbar remains available. Fit shrinks to the available width/height without enlarging small images; Intrinsic CSS max-width/max-height recomputes fit, and25–400 percent scales the original decoded resource. No canvas/screenshot resampling or image-mask bypass exists.
- The strict version1 localStorage record `vera.viewer.modes` stores `{version:1,extensions:{[realExtension]:mode}}`. Only deliberate toolbar choices or the Files Hex action write it; automatic defaults, load errors, unsupported preferences and metadata refresh do not. Malformed/unavailable records resolve defaults; quota denial keeps the explicit current-tab choice. Another extension is independent. Rendered failures retain the toolbar and Retry so Text/Hex remains reachable.
- An explicit click on the effective mode also remembers that choice while retaining the current body/place/attempt. Switching to another mode clears incompatible place/content, increments the provider-wide attempt and uses the existing owner/attempt settlement guards. Verified refs/citations never enter the plain-file loader or get mode controls; artifacts, downloads and run logs keep their loaders. HexSource is created and disposed by the owning mount effect so development effect replay creates a fresh source and old operations remain cancelled.
- SessionService admits UTF8 control-byte logs only for successful parse_log line-ref provenance. The viewer uses guarded direct reads up to50MiB, fatal UTF8 and matching source hashes, independent of document indexing; ordinary document/file refs retain binary and index checks.

Managed PDF downloads use downloads.list/open scoped IPC and a downloadId ViewerTarget; see [PDF downloads](pdf-downloads.md). Docs includes saved PDF history, and successful download tool cards open the existing viewer without indexing. Downloads open in a document tab of the chat area like every source, and uncited PDFs omit citation-only labels. Host publicWebDownload scrubs metadata strings and drops invalid redacted records.


- DisplayDocuments uses the live createMaskingResolver(() => settings.get().settings) for Files,
  Find, document list/search, text/viewer content and index document/guard presentation. App Display
  defaults false; workbench default/on/off overrides it. Entries, ordering, counts and truncation stay
  unchanged. Sensitive path segments and complete refs use deterministic AES-GCM identities,
  authenticated to workbench ID, canonical folder and original parent using a format-1 host-local key
  in userData/display-identities.json. Path identities end in a dot, outside valid host path syntax;
  ordinary prefix names stay ordinary. Ref identities append a separate authenticated reference
  segment and retain one file tab key. Session citations pass original refs to core provenance checks.
  The exact protocol is in specs/REQ-SEC-df8a595a.md. displayPath/displayRef and Find labels carry presentation only.
  Every host action resolves identity before existing confinement; no index/model/export rule changes.
  A closed/switching workbench invalidates pending replies, while stored tabs reopen after restart
  with the same key and owning folder. Text opens verify the exact original path/ref in main before
  echoing the per-attempt requestId; renderer verifies owner and request correlation and retains its
  ordinary identity checks for responses without correlation. Display/config events invalidate affected cached file scopes and their labels/content;
  restored file tabs begin with safe labels and fetch host metadata, including raw targets saved before
  credential registration. Inactive file tabs reload metadata without loading file bytes, while inactive scopes refresh on
  return. App changes reset all cached workbench Display query data; workbench events reset that
  owner only. Properties reloads its current host presentation. Privacy enum protocol stays structural
  even if a stored short secret equals on/off/default. Format-1 saved target/key bounds admit opaque
  expansion through 262144 characters. Run full-log tabs use runs.log and the live Program runs choice, default off, independently of Display.
  Settings/config events clear cached run content and bump attempts across inactive session scopes; late
  replies cannot restore old presentation. Download views retain their separate policy. PDF bytes remain exact; only
  extracted PDF text follows Display. Sensitive-name entries cannot attach opaque identities to chat;
  the existing model admission still rejects stored-secret message text.
- `docs.readBytes({workbenchId,path,offset,length})` reads any ordinary owning-workbench file,
  ignored or binary included, at original physical offsets (safe integers, length1..1048576).
  It returns `{workbenchId,path,displayPath,offset,size,data}` with base64 data through EOF;
  `docs.stat` retains file/folder Properties and the original physical size. Core read-bytes.ts
  uses bounded positional I/O, ordinary/canonical root and path rechecks, and descriptor inode/dev/
  size/mtime/ctime checks before/after reading; missing sources return NOT_FOUND, changed sources
  CONFLICT, invalid windows INVALID and disallowed paths DENIED. Bypass/additional folders never
  extend viewer scope. A fixed64 KiB host-only context per side bounds input to1MiB+128KiB.
  DisplayDocuments rechecks owner/generation and current Display/secrets after asynchronous work.
  On replaces all overlapping literal/JSON-escaped secret bytes in UTF8, UTF16LE/BE, Windows1252,
  ISO88591/2 with0x2A, preserving length/offset/physical size; overlong representations mask the
  entire returned window. UTF16 masked pairs decode as U+2A2A. Off returns exact original bytes.
  Exact contract: specs/REQ-FUNC-69645e84.md. Ordinary text consumes it through the reader and bounded large-text source.
- docs.list({workbenchId}) returns scoped document statuses/reasons.
- docs.search({workbenchId,query}) returns at most20 current keyword hits after deduplicated per-source SHA/status/kind/locator verification and index epoch checks.
- docs.open accepts workbenchId with indexed path, document ref, or
  sessionId/messageId/ref. It returns scoped ViewerContent for PDF bytes/pages,
  presentation slides with the cited page/pageEnd, Markdown/HTML/document/
  spreadsheet sections and extraction slugs, numbered source lines or artifact.
- docs.reindex({workbenchId?}) checks identity/ownership before ingest admission.
- DocumentViewer.open(ref,snippet?) and openPath(path) check source/locators;
  SessionService.openCitation resolves a completed assistant citation against
  preceding successful tool results and current file/artifact content.
- Finished run logs use a validated runId target and `run:<id>` tab key. The provider loads `runs.log({workbenchId,id,full:true})`, rejects mismatched IDs or truncated replies, then renders ordinary text lines in the existing viewer. Run targets persist at renderer version 1 and do not enable file-path actions; log IPC derives the path from the current workbench and ULID.
- DocumentViewerProvider keeps one tab set per `scope` (`<workbench>/<session>`) for the run:
  `{tabs, active}` with `active` = `CHAT` or a tab key (REQ-UX-5fc1d7d3). `useDocumentViewer()`
  returns `open(target)`: the document key (`file:<path>` from path, textPath or the path of a
  page/heading/line ref; `artifact:<name>`; `download:<id>`; `ref:<raw>` for an unparsable ref)
  selects an existing tab and reloads it at the new place, or appends one (REQ-FUNC-89161a95,
  REQ-UX-712804c9); every open calls the `reveal` prop so App shows the chat area
  (REQ-UX-37821e01). Attempts come from one provider-wide counter, so a closed and reopened tab
  never takes an older answer. A tab caches its content per attempt; a failed load keeps its error and Retry
  in that tab only (REQ-REL-6fc27952). `useDocumentTabs()` exposes select/close/retry, the kept
  place (`{page}`, `{line, scroll?}` or `{scroll}`, held in a ref so scrolling never re-renders), the opener
  and a one-shot focus request.
- `DocumentTabs({chat})` (documents/document-tabs.tsx) renders the tablist: Chat first without a
  close button, document tabs labelled by file (artifact) name and titled by path (REQ-UX-388cf31a);
  close button, Delete on a focused tab or middle click removes a tab and selects its right, else
  left neighbour, else Chat (REQ-UX-89428322); Left/Right wrap, Home/End (REQ-UX-be7140e4). The Chat panel stays mounted
  while hidden (draft and scroll survive); only the selected document panel (`[data-source-current]`,
  keyed by tab and attempt) is mounted and reopens at its kept place: PdfViewer `page`/`onPage`,
  TextViewer `line`/`onLine`, other bodies their scroll offset (REQ-UX-1f53a583). Opening moves
  focus into the panel unless the body focused its cited unit; Escape selects Chat and focuses the
  opener when it is still shown, else the Chat tab. In the panel Ctrl+F asks a PDF or text body for its
  find field (or focuses an open one) and Ctrl+G asks a text body for its go-to-line field, by
  bumping `findRequest` / `gotoRequest` (REQ-UX-d64f086f, REQ-UX-58cf59b2).
- The document panel shows its applicable Rendered/Text/Hex toolbar and the document (or its load error with Retry), without a path line or file-action buttons; the path is the tab's tooltip (REQ-UX-968b89b0). A tab menu action's error or notice
  shows in `[data-tab-notices]`, the row between the tab strip and the panels, also while Chat is
  selected, and clears when another tab is selected. Tab keys and stale menus: the window listener
  is idle while any `[data-tree-menu]` is open, and a menu whose tab closed goes away.
- Document tabs (TASK-6c4aeed8): HTML5 drag and drop moves a document tab before the tab it is
  dropped on or to the strip end (`[data-tab-strip-end]`); Chat is not draggable and refuses drops
  (REQ-UX-e0410483). The tab context menu (right click, Shift+F10, menu key; `TreeMenu`) offers
  Close, Close others, Close to the right, Move left, Move right, then the file actions
  (REQ-UX-67abf562); the provider's `move(key, before)` and `closeMany(keys, keep)` back it. One
  window keydown listener, idle while a `dialog[open]` exists or an IME composes, handles
  Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp (select with wrap, REQ-UX-fd131983),
  Ctrl+Shift+PageDown / PageUp (move the selected document tab, REQ-UX-6ecb6c83) and Ctrl+W / Cmd+W
  (close it, REQ-UX-a45c4384). These keys are fixed: the shortcut registry's grammar cannot express
  Tab or PageUp and reserves Mod+W. A managed download's tab has no Open in default app (`.vera/` is
  outside the allowlist; DEVIATION in TASK-6c4aeed8).
- The Chat panel (`[data-chat-panel]`) shares the grid cell of the document panel; while a document
  is selected it is `inert` with `visibility: hidden` (never the `hidden` attribute, whose
  `display: none` resets the transcript's scroll in Chromium), so the transcript keeps its scroll. While it is hidden,
  SessionWorkspace ignores its window shortcuts; a composer focus request (Attach as context) is
  taken once (`composerFocused` clears it in App), selects Chat once and focuses the composer when
  it is enabled.
- TextViewer offers a Word wrap checkbox for numbered source text. `use-text-rows.ts` measures
  mounted row heights and keeps estimates for unseen rows, with 40 overscan rows per side. Pending
  Find/Go to line targets settle after measurement; wrap/width/font changes invalidate measurements
  while preserving the source anchor before the browser clamps a shrinking spacer. The kept first
  line wins over citation start, and scroll reports retain source line numbers. FindBar stays
  on demand with Enter/Shift+Enter stepping and Escape returning focus to the body.
- Ordinary file text up to 5 MiB uses read-text-file.ts: docs.stat, sequential <=1MiB docs.readBytes,
  consistent owner/host identity/physical offsets/size/exact lengths and matching final stat mtime.
  An empty file still reads once. Larger ordinary text uses a transient LargeTextFile descriptor,
  four cached64 KiB byte windows and one decoded/measured window. A separate byte-position scrollbar
  reaches arbitrary offsets; inner scrolling and edge wheel/keys move through adjacent fragments.
  UTF8/UTF16 boundary handling retains complete characters; long lines use bounded fragments marked ….
  LargeTextIndex retains one progressive cursor and <=1026 sparse checkpoints, with physical stride
  derived from file size. Approximate row labels (≈) settle exactly after yielding chunk scans.
  Go to line shows an estimated window first, then scans/settles exactly, clamping beyond EOF.
  Find scans256 KiB at a time with query-sized raw overlap, scalar matching-line counters and first/last/selected hits; Enter/Shift+Enter wrap, with current/total counts;
  Cancel, a superseding request or unmount aborts publication. Search/index loops yield per chunk.
  Find keeps its physical match column visible inside long-line fragments, including after wrap changes.
  All byte replies validate owner/path/offset/physical size/base64/exact lengths and opening metadata
  before publication; mismatches use CONFLICT. Display refresh remounts the attempt, aborts old work
  and clears caches/indexes. No source bytes or line index are persisted; kept large-file scroll is
  its physical byte offset. Indexed ordinary text tree entries use textPath directly, avoiding a
  complete extraction reply. Verified text above5MiB returns empty lines plus compact byteSource after
  existing issued-reference/SHA checks; original ref/snippet/start/end remain, and the large viewer
  settles the cited initial line and aria-current range. Core captures size, actual stat date and
  dev/ino/size/mtimeMs/ctimeMs revision from the verified streaming snapshot; Display seals revision
  to owner/path, and readBytes refuses a changed revision before returning masked bytes. Bounded
  original CR/CRLF/LF lineEnds preserve source identities when Display masking hides newline bytes.
  Verified UTF8/control-log admission stays host-owned. Retry repeats parent provenance/loading,
  Escape focuses the body. Runs and rendered formats retain their existing host content paths.
  Exact compact contract: specs/REQ-FUNC-ed0b45c5.md.
- text-encoding.ts uses TextDecoder: UTF8/UTF16LE/BE BOM detection, otherwise UTF8, with explicit
  UTF8/Windows1252/ISO8859-1/ISO8859-2/UTF16LE/BE selection. ISO8859-1 follows Chromium's Windows1252
  alias. Invalid strict decoding or NUL requests Show as text; explicit replacement decoding uses
  U+FFFD for invalid sequences. Changing encoding retries strict decoding without another host read.
  Small verified references, runs, downloads, artifacts and rendered PDF/Markdown/Office retain
  existing host content/provenance; larger text references use the verified revision-bound windows above.
- Hex opens automatically for unknown extensions or binary control bytes in a recognized text prefix, or from the toolbar and Files row menu. The explicit menu uses `textPath` with `hex:true`, retaining the original file tab key and identity; normal Open resolves the remembered extension preference. A later toolbar choice clears the menu override in the saved target. Its transient HexFile adopts the host-owned byte path from stat, including a newly opaque identity after credential registration. Format-1 tab storage admits the explicit Hex target and physical `{offset}` place. Citations retain their verified paths and ranges.
  HexSource owns four64KiB cached windows and serializes reads; each renderer window/scan/copy is at most64KiB. HexRows mounts at most100 rows, each16 bytes with physical uppercase hexadecimal offset, spaced uppercase bytes and ASCII0x20..0x7E (dot otherwise), including partial EOF rows. A byte slider spans arbitrary safe-integer file sizes without giant DOM/spacers; local scrolling/wheel and keyboard cross bounded windows.
  Go to offset accepts decimal or0x-prefixed hex in0..size-1 (zero for empty files). Find uses case-sensitive UTF8 or even hexadecimal pairs with optional whitespace, <=4096 bytes, streaming KMP across64KiB borders, next/wrap and scalar hit state. Query/mode replacement, Cancel, Escape, owner/attempt change and unmount abort publication. Input/paint yields once per scan window.
  Selection stores anchor/focus physical bytes; pointer drag/Shift-click and Shift+arrows extend it. Ctrl+C copies spaced uppercase hex; Ctrl+Shift+C copies UTF8 replacement-decoded text. Copy checks metadata before/after a fresh masked read and rejects ranges above64KiB. Clipboard uses a temporary offscreen textarea with execCommand, keeping sandbox permissions unchanged. All Find/copy bytes follow live Display; cached sources disappear on settings/config refresh. Malformed input shows localized feedback; read failures show the structured error and Retry (the parent reloads metadata). Escape closes fields/cancels before returning focus to the byte region. Hex context actions name Find and Go to offset.
- PdfViewer reads every page box at load, so `.pdf-scroll` holds one `.pdf-sheet[data-page-number]`
  per page; only pages within 2 of the page in view draw a canvas and text layer (pinned bundled
  module worker). The page in view is the one at a third of the view height; `.pdf-indicator`
  shows "page / count" (REQ-UX-e4d5ce0f). Zoom 50-200% in steps comes from Ctrl+wheel (non-passive
  listener) and Ctrl+= / Ctrl+- / Ctrl+0, keeping the page in view (REQ-UX-e8dfdec3). Find covers
  the extracted text of every page with cross-run snippet/search marks. A native disclosure
  presents the host-scrubbed text of the page in view.
- `path#h=` opens the untitled leading section (`data-heading=""`), current and
  focused like any heading anchor; Docs search keeps such hits (REQ-UX-9be5fd96,
  REQ-FUNC-73136b97). Its chip label is "<file> #start".
- Presentations render as sections titled "Slide N" (`data-slide`); the cited
  slides carry aria-current and the first is scrolled into view and focused.
  Document and spreadsheet sections render as `<pre>` text with the cited heading
  focused, like HTML.
- File actions live in one hook, `useFileActions(workbenchId, menuFor)` (documents/file-actions.tsx,
  TASK-6c4aeed8): Attach as context, Open in (Default app for allowlisted documents outside
  `.vera/` through app.openPath, detected editors, Linux system apps of `menuFor`, the Open with
  dialog), Show in Explorer/Finder/folder, Copy and Properties, with `error`/`notice` for the
  caller to show. The Files tree row menu prepends Open; the document tab menu appends them to the
  tab actions for workbench file tabs (`file:` keys) that are not artifacts; a managed download's
  tab offers Show in Explorer only (downloads.reveal); an artifact tab none (REQ-UX-f261c988,
  REQ-UX-f5d6e9e4). An ignored file has no Default app item. `useDescribeDocument()` gives the
  localized index status for Properties in both places.
- Docs tab layout (TASK-b34f2cc7, documents/docs-tab.tsx): one search box (`data-docs-search`,
  "Search files and documents", 200 characters), then one `.docs-actions` row with Reindex and
  Collapse all (wrapping only when too narrow; Collapse all is disabled while the box has
  text), progress, warnings and the tree. While the count guard stops indexing
  (documents/index-guard.tsx, `data-index-guard`, role alert) it replaces progress and the volume
  warning with the localized count and limit, the top folders (`data-guard-folder`), Index anyway
  (docs.approve with the shown count, disabled read-only) and Edit exclusions, which App turns
  into openEditor(active, "documents") (REQ-UX-0c1aea14, REQ-UX-597b7c82). One 250 ms
  debounce feeds both the tree's name filter and docs.search; while the box has text the
  keyword hits render under the tree in an "In documents" section (`data-docs-hits`, with its
  own loading, empty and retry states) (REQ-UX-2504362b, REQ-UX-d455531b).
- Docs tree (TASK-66b7d4aa, documents/docs-tree.tsx) lists the whole workbench folder.
  docs.tree({workbenchId,path}) lists one folder (folders first, natural order, at most 5,000
  with `truncated`, links left out); a folder's entries load when it is expanded. Entries the
  .vera, .git, node_modules and .veraignore rules hide from the agent and the index, or that a
  .gitignore excludes while docs.gitignore is on (REQ-FUNC-ed6a4de8; left out of Find too), come with
  `ignored: true` (inherited inside ignored folders) and render in italic muted text at AA
  contrast with faded icons (`data-ignored`, screen-reader "Ignored by VERA"); they expand, are
  remembered and use the applicable file mode like other rows, but never offer Open in default app, which
  PathGuard refuses (REQ-UX-ed65cbbc, TASK-b34f2cc7).
  Documents from docs.list mark their rows with a status icon whose tooltip and screen-reader
  text give the status and reason (`data-document`, `data-status`); other files are dimmed
  (`data-indexed=false`). A cut-off listing says so on its folder row or, for the top level,
  above the tree (`data-tree-truncated`). Folder rows count the indexed documents beneath them and
  mark failed, needs-OCR or unsupported ones (`folderSummaries`, from the index, no disk walk).
  Activation opens indexed and needs-OCR document paths or ordinary `textPath` targets through the metadata-first mode loader (REQ-UX-c28dde55, REQ-UX-795a7f61,
  REQ-UX-775eb693, REQ-FUNC-70dc2e8f).
- The search box's text filters the tree through docs.find({workbenchId,query}): matching file
  paths of the whole workbench outside ignored entries, first 200 with a "more matches" note,
  shown with their ancestor folders expanded ("No files match." when none); find results are
  dropped when the text changes (gcTime 0) and index events invalidate them. Expanded folders
  persist in localStorage `vera.docs.tree.<workbenchId>` through `useTreeExpansion`, which
  DocsTab owns so its Collapse all can clear them; a saved folder whose listing
  fails with NOT_FOUND or DENIED (deleted, renamed, or replaced by a link) is dropped silently. ARIA tree with aria-level and one roving tab stop: ArrowUp/Down,
  Home/End, ArrowRight/Left expand/collapse or move to child/parent, Enter opens
  (REQ-FUNC-2e3fad2d, REQ-UX-9f16abf2, REQ-UX-2d9cdf43, REQ-UX-fdd495b8).
- A row's context menu (right click, Shift+F10 or the ContextMenu key; documents/tree-menu.tsx)
  offers Open (folders expand), Attach as context (TASK-2fef1397; inside the app only, disabled
  for ignored entries, a read-only workbench or a full chat; see [Chat UI](chat-ui.md)), Open in,
  Show in Explorer, Copy and Properties (TASK-eae3a69e). Disabled items carry `aria-disabled`,
  stay reachable by the arrow keys and do nothing.
  It opens at the pointer or below the row, focuses its first item, wraps arrows, runs on
  Enter/Space and closes on Escape/Tab (focus back to the row), outside press, blur, resize or
  scrolling of what holds it. Rows contain no buttons (REQ-UX-541a5bee). Items with `items`
  are submenus (`aria-haspopup`, `data-submenu`, items at `data-menu-depth` 0 or 1): one open at
  a time, by click or hover (a click never closes what hover opened) and by Enter, Space or
  ArrowRight with focus on its first item; ArrowLeft or Escape close it and focus its item; a submenu that would leave the window opens to the left
  (`data-side="left"`) (REQ-UX-89cdb49d).
- Open in lists Default app for allowlisted files VERA does not ignore (app.openPath, accessible
  name "Open in default app: <path>", REQ-UX-f5d6e9e4) and the programs main detected, from the
  `docs.openers` query: VS Code, Cursor and Notepad++ for files, VS Code, Cursor and Terminal for
  folders; for a file, "Other app..." last on Windows (the system Open with dialog) or, on Linux,
  the applications the system registers for its type from a `docs.systemApps` query run when the
  menu opens on that file (TASK-c49f03d5); what a platform cannot do never appears; Open in is left
  out when empty (REQ-UX-25c814e1). Show in Explorer (Show in Finder on
  macOS, Show in folder elsewhere, from app.info) calls docs.reveal (REQ-UX-ef3e2304). Copy
  offers Absolute path, Relative path and File name through docs.copyPath and says "Copied to
  the clipboard." (`data-tree-notice`) (REQ-UX-3a3d67c1). Failures of every action share the
  tree's error slot.
- Properties (documents/tree-properties.tsx) is a modal dialog: path and type from the row,
  size and modified time from docs.stat({workbenchId,path}) -> {workbenchId, properties:
  {path,type,size|null,modified}}, and from the index a document's status/reason and pages or
  "Not indexed", "Ignored by VERA" for an ignored entry, or a folder's indexed count. Close or
  Escape returns focus to the row
  (REQ-FUNC-98e9d760, REQ-UX-4d1b3324). Rename and Delete are a later task.
- Named document/text and PDF regions support keyboard scrolling. Docs Open actions include path/ref identity in accessible names.
- Document menu (TASK-0ec8c0d0): right-click, Shift+F10 or the menu key in a document panel (not
  in its find or line field) opens a `TreeMenu` beside the panel (outside it, so the menu's Escape
  does not leave the tab). Items carry `keys` (`aria-keyshortcuts`, shown with Ctrl): text -> Copy,
  Find, Go to line; PDF -> Copy, Find, Zoom in/out, Reset zoom; others -> Copy. Copy keeps the
  selection taken when the menu opened (only one inside the panel; disabled otherwise) and runs
  the editing `copy` command on it, because every web permission (so `navigator.clipboard`) is
  denied (REQ-UX-c514899c, REQ-FUNC-6d1fb02f). Find and Go to line bump the same requests as
  Ctrl+F/Ctrl+G; zoom sends a `ZoomRequest {step, id}` to PdfViewer (REQ-UX-160f9f68).
- Saved tabs (TASK-061fe00e): `lib/document-tabs-store.ts` keeps one localStorage record per
  workbench session, `vera.tabs.<workbenchId>.<sessionId>`, `{version: 1, active, tabs: [{target,
  place?}]}` under a strict zod schema; a missing, unreadable or invalid record reads as none, and
  storage errors never throw (REQ-DATA-3b6664f9, REQ-REL-f19a4bc2). The provider restores a
  session the first time it is shown in a run: it checks downloads (`downloads.list`), artifacts
  (`artifacts.list`) and files (`docs.stat`, only NOT_FOUND drops a tab; other failures keep the
  tab with its load error), puts the restored tabs before tabs opened meanwhile and keeps their
  places (REQ-FUNC-8a061992, REQ-REL-4622d972). Only restored sessions are saved: 500 ms after a
  change and at once on `pagehide`. Deleting a session removes its record (REQ-FUNC-d9d16533).
- Docs subscribes to index events, displays status/reasons/progress, searches,
  opens sources/results and disables Reindex on read-only snapshots.

## Invariants

- Exact active workbench identity and host ownership are checked around reads.
  Lifecycle serialization keeps storage alive until the read completes.
- Current confined SHA256 and extraction kind/count/bounds are checked. Missing,
  stale, ignored, escaping, binary and invalid targets return structured errors.
  Office sources are archives: they are never decoded as text, accept only slide
  (presentation) or heading (document, spreadsheet) locators, and currentBounds
  reports no line bounds for them.
- Line refs from file tools can open unindexed ordinary text within20MB; full
  original numbered lines and cited range retain their offsets; the renderer scrolls them
  continuously and mounts only the lines near the view, bounding DOM cost for large sources.
- Citation requests require completed valid assistant projection and successful
  preceding structured ref issuance in the same session. Client snippets are absent.
- HTML executes as visible extracted text; Markdown uses inert links/images/raw
  HTML skipping. Artifact content uses the same renderer body as ArtifactsTab.
- Main omits Docs rows/hits whose locator identities contain known secrets, redacts remaining user text and bounds snippets after redaction, while retaining exact binary PDF bytes. Renderer has no Node/fs.
- Worker/resources are pinned local build assets; protocol realpath confinement,
  same-origin connect/worker CSP and local font blobs retain offline operation.
  PDF page canvases are bounded at16million pixels; parse/render errors offer retry.
- OS actions on tree entries (main/openers.ts) run only after core `locateEntry` passed the
  tree confinement (links, outside paths and Windows aliases DENIED, ignored entries allowed).
  Programs are detected once per start from standard install folders and PATH with `pathExists`
  (lstat: the `WindowsApps\wt.exe` app execution alias is invisible to `existsSync`) (Windows:
  Code.exe, also beside `bin/code.cmd`; Cursor.exe, also above `resources/app/bin/cursor.cmd`;
  notepad++.exe; Windows Terminal else PowerShell; rundll32.exe for the Open with dialog; on
  Linux `code`, `cursor` and `x-terminal-emulator` on PATH) and start detached with no
  `ELECTRON_*` variables. The Open with dialog is `rundll32 shell32.dll,OpenAs_RunDLL <path>` with
  verbatim arguments (it refuses a quoted path). Linux system applications come from `gio`
  (GLib 2.68 or later, C locale): `gio info` gives the content type, `gio mime` the registered
  desktop ids, the .desktop `Name`/`Name[lang]` their names (NoDisplay/Hidden skipped, detected
  editors left out); `docs.openSystemApp` re-reads that list and runs `gio launch <desktop file>
  <file>` only for an id in it. No entry path reaches a shell or command-line parser: editors get it as an argument;
  terminals get the folder as working directory (`wt -d .`, because Windows Terminal splits
  arguments on `;`; PowerShell through a fixed `cmd /c start` line, since a detached console
  program has no window). A program that is not detected or does not take the entry's kind is
  INVALID, a launch failure INTERNAL.
  The clipboard is written by main (`clipboard.writeText`), since the renderer has no clipboard
  permission; copied paths use the platform separator.
- Tree reads (core workbench/tree.ts) are confined to the active workbench folder: every
  segment must be ordinary (no links); absolute and `..` paths and PathGuard's Windows aliases
  (`validateRelativePath`: trailing dot or space, `:` streams, device names) are DENIED;
  missing ones NOT_FOUND. Ignored entries are listed, read and inspected for the user's own
  panel only (TASK-b34f2cc7): docs.find skips them, and the agent's PathGuard, ingest
  selection and providers still never see them. Bounds:
  5,000 entries per folder, 200 matches and 50,000 walked entries per find. The legacy docs.read
  API retains its strict UTF8/NUL and 5MiB checks; the ordinary file UI uses the byte-backed text
  path above with explicit replacement and selected encodings. statEntry refuses the workbench folder
  itself. Main retains every result and applies conditional Display presentation with separate host authority.
- Scoped source selections and disposed requests prevent late content replacing another view while Shell/Welcome drafts stay mounted; there is no modal viewer.
  Controls use rem/theme tokens and en/ro/de/fr; inner page scrolling contains overflow.

## Change map

| Change | Start | Focused proof |
|---|---|---|
| conditional Display / stable identity | main/display-documents.ts, display-identities.ts; renderer documents | display-documents.test.ts; display-identities.test.ts; e2e/display-masking.spec.ts |
| wire/source/locator bounds | documents.ts; viewer.ts | documents-ipc.test.ts; viewer.test.ts |
| provenance/session artifact | SessionService.openCitation | search.test.ts; citations.spec.ts |
| ownership/lifecycle | WorkbenchService.readDocuments | service.test.ts |
| PDF worker/assets/CSP | pdf-viewer;electron.vite.config;security | native citations.spec.ts; documents.spec.ts |
| document tabs, places, focus | viewer-context DocumentViewerProvider; documents/document-tabs.tsx; App.tsx center | document-tabs.test.ts; documents.test.ts; workspace.test.ts; e2e citations/documents/pdf-download |
| office slides/sections | viewer.ts; viewer-context DocumentBody; document-viewer.ts | viewer.test.ts; documents.test.ts; office-documents.spec.ts |
| tree listing/find/text/stat bounds | core workbench/tree.ts; WorkbenchService; shared docs.tree/find/read/stat | tree.test.ts; documents-ipc.test.ts |
| tree UI, ignored rows, memory, keys | documents/docs-tree.tsx; mockApi docs.tree/find/read | docs-tree.test.ts; documents.spec.ts; docs-tree.spec.ts |
| tab menu, drag, tab keys | documents/document-tabs.tsx; viewer-context move/closeMany; file-actions.tsx | document-tabs.test.ts; citations.spec.ts (real drag) |
| search box, In documents, actions row | documents/docs-tab.tsx (`useTreeExpansion`); styles `.docs-actions` | docs-tree.test.ts; documents.test.ts; documents.spec.ts |
| row context menu / Properties | documents/tree-menu.tsx; tree-properties.tsx; mockApi docs.stat | docs-tree.test.ts; documents.test.ts; docs-tree.spec.ts |
| Image previews and resource lifetime | documents/image-source.ts; image-viewer.tsx/CSS; file-mode.ts; content-policy.ts and renderer index.html | image-source.test.ts; image-viewer.test.ts; content-policy.test.ts; browser/native e2e/image-preview.spec.ts |
| File modes and extension preferences | documents/file-mode.ts; viewer-context; document-tabs; main/display-documents; core/workbench/service statEntry; shared documents metadata | file-mode.test.ts; document-tabs.test.ts; native/browser e2e/viewer-modes.spec.ts |
| Hex rows/search/copy | renderer/documents hex-{source,rows,viewer}, viewer-context, docs-tree, document-tabs-store | hex-source.test.ts; hex-viewer.test.ts; native e2e/hex-viewer.spec.ts |
| Large text windows/index/search | renderer/documents large-text-{source,index,find,window,rows,viewer} | large-text.test.ts; read-text-file.test.ts; e2e/large-text.spec.ts genuine 200 MiB browser/native heap/pulse proof |
| Text decoding and measured wrap | renderer/documents text-encoding, read-text-file, text-viewer, use-text-rows | sibling tests; e2e/text-encodings.spec.ts browser/native |
| Bounded physical byte reads | core/workbench/read-bytes.ts and service.ts; shared documents/ipc.ts; main display-documents.ts and display-bytes.ts | read-bytes.test.ts; display-bytes.test.ts; display-documents.test.ts; documents-ipc.test.ts; focused service/bridge tests |
| Open in / Show in Explorer / Copy | main/openers.ts; index.ts docs.openers/openWith/reveal/copyPath/systemApps/openSystemApp; core locateEntry; file-actions.tsx useFileActions | openers.test.ts; tree.test.ts; documents-ipc.test.ts; docs-tree.test.ts; docs-tree.spec.ts |

## Key behaviors

- REQ-FUNC-71a6501a: six index-independent image formats through bounded bytes and retained Hex.
- REQ-SEC-21021e27: SVG remains an inert image resource under restrictive CSP.
- REQ-UX-2b81bcdc: resize-aware fit and original decoded image zoom through400%.
- REQ-REL-35fd9a5f: safe failures/Retry.
- REQ-REL-2b14e715: effect-owned cancellation and Blob URL lifetime.

- REQ-FUNC-bc3f25bd, REQ-FUNC-12972046, REQ-DATA-7af13314, REQ-REL-2c2e6e93: applicable file modes, bounded automatic Hex selection and independent persistent extension choices.
- REQ-FUNC-94765114, REQ-FUNC-69596c3b, REQ-FUNC-b66d2d80, REQ-FUNC-53b3527c, REQ-REL-63f0f1cc, REQ-REL-a4d21663: bounded Hex rows, offset navigation, cancellable byte Find, selection copy, invalid input and Retry.

- REQ-FUNC-c5def0c3, REQ-UX-5a886e34, REQ-UX-77baabba, REQ-REL-3bb0b405: selected text decoding, explicit replacement, measured wrapped navigation and consistent bounded assembly.

- REQ-FUNC-69645e84, REQ-FUNC-e4204219, REQ-SEC-f561466e, REQ-REL-0fa2a8e9,
  REQ-SEC-d707ed8d, REQ-FUNC-c21cc184 — bounded physical bytes, confinement, typed races and live encoded masking.

- REQ-FUNC-c07a945e, REQ-SEC-df8a595a — live conditional Display with stable restart-safe workbench-owned identities.
- REQ-FUNC-28ad0001 — guarded scoped viewer payload and citation provenance.
- REQ-UX-28ad0002 — accessible offline locator viewer and snippet navigation.
- REQ-UX-28ad0003 — live Docs index, search/open/reindex and progress.
- REQ-UX-64738341 — extracted office text shown as numbered slides or sections with the cited unit in view.
- REQ-FUNC-889beffd, REQ-FUNC-2e3fad2d, REQ-FUNC-70dc2e8f, REQ-FUNC-98e9d760 — confined tree
  listing, name find, text read and entry properties.
- REQ-UX-c28dde55, REQ-UX-795a7f61, REQ-UX-775eb693, REQ-UX-9f16abf2, REQ-UX-2d9cdf43,
  REQ-UX-fdd495b8, REQ-UX-541a5bee, REQ-UX-4d1b3324 — Docs tree, folder counts, opening,
  filter, memory, keyboard, context menu and Properties.
- REQ-UX-ed65cbbc, REQ-UX-2504362b, REQ-UX-d455531b — ignored entries in italic with faded icons, document
  hits under the filtered tree, one search box with Reindex and Collapse all on one row.

## Files

Under05_Software: shared/{documents,ipc}.ts; core/knowledge/viewer.ts/test,
core/sessions/service.ts, workbench/{service,tree,read-bytes}.ts/test and knowledge/search.test.ts;
desktop/main/{index,document-viewer,display-documents,display-bytes,display-identities,security,content-policy,openers}.ts, openers.test.ts and
document-viewer.test.ts; renderer/components/documents/{viewer-context,docs-tab,
pdf-viewer,docs-tree,tree-menu,tree-properties,open-externally,document-tabs,file-actions,text-viewer}.tsx;
image-source.ts/test, image-viewer.tsx/CSS/test and e2e/image-preview.spec.ts with generated support/image-preview-fixtures.ts;
file-mode.ts/test and e2e/viewer-modes.spec.ts; hex-source.ts, hex-rows.tsx, hex-viewer.tsx/CSS with sibling source/component tests;
text-encoding.ts, read-text-file.ts, use-text-rows.ts with sibling tests, documents.test.ts and
docs-tree.test.ts; session/{markdown,transcript,artifacts-tab};
App/Shell/styles/locales/mock documents+mockApi; electron.vite.config.ts/index.html;
tests/fixtures/llm-scripts/{document-viewer,office-citations}.jsonl;
tests/e2e/{citations,documents,office-documents,docs-tree}.spec.ts.
