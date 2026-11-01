# Document viewer and Docs index panel

## Routing

Select for citation opening, the document tabs of the chat area (open, select, close, kept places,
per-session sets saved per session), continuous PDF/text scrolling with zoom/find/go-to-line/snippet,
Markdown/HTML/office anchors, presentation slides, numbered lines and Docs
status/search/reindex/progress, and the Docs folder tree (single search box, ignored entries,
memory, keyboard, context menu, Properties).
Start under05_Software at shared/documents.ts, core/knowledge/viewer.ts and
renderer/components/documents. Focused tests are viewer.test.ts, search.test.ts,
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

Managed PDF downloads use downloads.list/open scoped IPC and a downloadId ViewerTarget; see [PDF downloads](pdf-downloads.md). Docs includes saved PDF history, and successful download tool cards open the existing viewer without indexing. Downloads open in a document tab of the chat area like every source, and uncited PDFs omit citation-only labels. Host publicPdfDownload scrubs metadata strings and drops invalid redacted records.


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
  The right panel has no Source tab or Source width (REQ-UX-aa068a49, REQ-UX-b3231a55 retired).
- The document panel shows only the document (or its load error with Retry): no path line or
  buttons; the path is the tab's tooltip (REQ-UX-968b89b0). A tab menu action's error or notice
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
- Continuous viewers (TASK-4c04273a), with no navigation toolbar. `TextViewer` (text-viewer.tsx)
  lays every line out at one measured, unwrapped height (`.document-lines` is `count * lineHeight`
  tall) and mounts only the lines in view plus 40 each side; it opens at the kept first visible
  line, else with the cited start a third down, and reports the first visible line
  (REQ-UX-8a994f4b, REQ-NFR-0fe89e49). `FindBar` (find-bar.tsx) is the on-demand field: Enter and
  Shift+Enter step, Escape closes it and focuses the document body without leaving the tab
  (REQ-UX-fe9ec5c2, REQ-UX-58cf59b2, REQ-UX-3eb27a6c).
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
  text), progress, warnings and the tree. One 250 ms
  debounce feeds both the tree's name filter and docs.search; while the box has text the
  keyword hits render under the tree in an "In documents" section (`data-docs-hits`, with its
  own loading, empty and retry states) (REQ-UX-2504362b, REQ-UX-d455531b).
- Docs tree (TASK-66b7d4aa, documents/docs-tree.tsx) lists the whole workbench folder.
  docs.tree({workbenchId,path}) lists one folder (folders first, natural order, at most 5,000
  with `truncated`, links left out); a folder's entries load when it is expanded. Entries the
  .vera, .git, node_modules and .veraignore rules hide from the agent and the index come with
  `ignored: true` (inherited inside ignored folders) and render in italic muted text at AA
  contrast with faded icons (`data-ignored`, screen-reader "Ignored by VERA"); they expand, are
  remembered and open as text like other rows, but never offer Open in default app, which
  PathGuard refuses (REQ-UX-ed65cbbc, TASK-b34f2cc7).
  Documents from docs.list mark their rows with a status icon whose tooltip and screen-reader
  text give the status and reason (`data-document`, `data-status`); other files are dimmed
  (`data-indexed=false`). A cut-off listing says so on its folder row or, for the top level,
  above the tree (`data-tree-truncated`). Folder rows count the indexed documents beneath them and
  mark failed, needs-OCR or unsupported ones (`folderSummaries`, from the index, no disk walk).
  Activation opens indexed and needs-OCR documents with docs.open and any other file as text
  through docs.read (`ViewerTarget {textPath}`) (REQ-UX-c28dde55, REQ-UX-795a7f61,
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
  5,000 entries per folder, 200 matches and 50,000 walked entries per find, 5 MiB per text
  view; binary (NUL probe or invalid UTF-8) and larger files fail with INVALID and
  `documents.textBinary` / `documents.textTooLarge`. statEntry refuses the workbench folder
  itself. Main drops
  listed or found paths the credential scrub would change and scrubs text views.
- Scoped source selections and disposed requests prevent late content replacing another view while Shell/Welcome drafts stay mounted; there is no modal viewer.
  Controls use rem/theme tokens and en/ro/de; inner page scrolling contains overflow.

## Change map

| Change | Start | Focused proof |
|---|---|---|
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
| Open in / Show in Explorer / Copy | main/openers.ts; index.ts docs.openers/openWith/reveal/copyPath/systemApps/openSystemApp; core locateEntry; file-actions.tsx useFileActions | openers.test.ts; tree.test.ts; documents-ipc.test.ts; docs-tree.test.ts; docs-tree.spec.ts |

## Key behaviors

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
core/sessions/service.ts, workbench/{service,tree}.ts/test and knowledge/search.test.ts;
desktop/main/{index,document-viewer,security,content-policy,openers}.ts, openers.test.ts and
document-viewer.test.ts; renderer/components/documents/{viewer-context,docs-tab,
pdf-viewer,docs-tree,tree-menu,tree-properties,open-externally,document-tabs,file-actions}.tsx, documents.test.ts and
docs-tree.test.ts; session/{markdown,transcript,artifacts-tab};
App/Shell/styles/locales/mock documents+mockApi; electron.vite.config.ts/index.html;
tests/fixtures/llm-scripts/{document-viewer,office-citations}.jsonl;
tests/e2e/{citations,documents,office-documents,docs-tree}.spec.ts.
