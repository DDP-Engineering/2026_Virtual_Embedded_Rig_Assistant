# Document viewer and Docs index panel

## Routing

Select for citation opening, the right panel Source tab, recent sources, PDF navigation/zoom/find/snippet,
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

Managed PDF downloads use downloads.list/open scoped IPC and a downloadId ViewerTarget; see [PDF downloads](pdf-downloads.md). Docs includes saved PDF history, and successful download tool cards open the existing viewer without indexing. Downloads open in the Source tab like every source, and uncited PDFs omit citation-only labels. Host publicPdfDownload scrubs metadata strings and drops invalid redacted records.


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
- DocumentViewerProvider owns the current source (load/error/retry), the ten most recent distinct
  sources of the provider scope (newest first, cleared with the scope) and open/close counters;
  `useDocumentSource()` exposes them. `SourcePanel` renders the Source tab: the current source
  with Close source and Open in default app, the body, and Recent sources. Opening focuses the
  panel unless the body already focused its cited unit; Escape or Close source returns focus to
  the opener, and Ctrl+F focuses PDF search (REQ-UX-712804c9, REQ-UX-aa068a49, REQ-UX-d64f086f).
- Shell shows the Source tab beside Docs and expands the right panel on every open. It keeps the
  tab the source was opened from mounted while hidden and returns to it (and to a collapsed
  panel) on close, so focus reaches the opener. While Source is selected the panel uses its own
  stored width `layout.source` (20-90 rem, capped at 60vw) (REQ-UX-b3231a55). Choosing another
  tab (mouse or keyboard) ends that return path; a scope change (session, workbench, settings)
  closes an open source and restores the tab/collapse without moving focus; when the opener is
  gone, focus goes to the visible tab or the main content.
- PDF Previous/Next hand focus to the other button when they become disabled at the first or
  last page, so keyboard focus never falls to the document.
- PDF renders one page via the pinned bundled module worker, supports page/range,
  zoom50..200%, all-page extracted-text find and cross-run snippet/search marks. A native disclosure presents the host-scrubbed text of the selected page for reading alongside the canvas.
- `path#h=` opens the untitled leading section (`data-heading=""`), current and
  focused like any heading anchor; Docs search keeps such hits (REQ-UX-9be5fd96,
  REQ-FUNC-73136b97). Its chip label is "<file> #start".
- Presentations render as sections titled "Slide N" (`data-slide`); the cited
  slides carry aria-current and the first is scrolled into view and focused.
  Document and spreadsheet sections render as `<pre>` text with the cited heading
  focused, like HTML.
- The viewer header offers "Open in default app" (`OpenExternally`,
  documents/open-externally.tsx) for allowlisted workbench documents outside `.vera/`; it calls
  app.openPath and shows errors in place (REQ-UX-f5d6e9e4); a text view opened from an ignored
  tree row (`ViewerTarget {textPath, ignored}`) has none. In Docs the same action is a tree
  row's context-menu item (`canOpenExternally`), with failures shown in the tree. Artifacts and
  managed downloads have no such action.
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
- Named document/text and PDF regions support keyboard scrolling; text windows use labelled previous/next-lines actions. Docs Open actions include path/ref identity in accessible names.
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
  original numbered lines and cited range retain their offsets; the renderer presents250 lines at a time with line navigation, bounding DOM cost for large sources.
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
| Source tab/recent/focus/width | viewer-context SourcePanel; shell.tsx; lib/layout.ts | documents.test.ts; workspace.test.ts; preferences.test.ts; e2e citations/documents/pdf-download |
| office slides/sections | viewer.ts; viewer-context DocumentBody; document-viewer.ts | viewer.test.ts; documents.test.ts; office-documents.spec.ts |
| tree listing/find/text/stat bounds | core workbench/tree.ts; WorkbenchService; shared docs.tree/find/read/stat | tree.test.ts; documents-ipc.test.ts |
| tree UI, ignored rows, memory, keys | documents/docs-tree.tsx; mockApi docs.tree/find/read | docs-tree.test.ts; documents.spec.ts; docs-tree.spec.ts |
| search box, In documents, actions row | documents/docs-tab.tsx (`useTreeExpansion`); styles `.docs-actions` | docs-tree.test.ts; documents.test.ts; documents.spec.ts |
| row context menu / Properties | documents/tree-menu.tsx; tree-properties.tsx; mockApi docs.stat | docs-tree.test.ts; documents.test.ts; docs-tree.spec.ts |
| Open in / Show in Explorer / Copy | main/openers.ts; index.ts docs.openers/openWith/reveal/copyPath/systemApps/openSystemApp; core locateEntry; docs-tree.tsx menuItems | openers.test.ts; tree.test.ts; documents-ipc.test.ts; docs-tree.test.ts; docs-tree.spec.ts |

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
pdf-viewer,docs-tree,tree-menu,tree-properties,open-externally}.tsx, documents.test.ts and
docs-tree.test.ts; session/{markdown,transcript,artifacts-tab};
App/Shell/styles/locales/mock documents+mockApi; electron.vite.config.ts/index.html;
tests/fixtures/llm-scripts/{document-viewer,office-citations}.jsonl;
tests/e2e/{citations,documents,office-documents,docs-tree}.spec.ts.
