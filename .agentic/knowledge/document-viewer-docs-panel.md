# Docs panel and file tree

## Routing

Select for the Docs tab: index status/search/reindex/progress and the count guard, the Docs folder
tree (single search box, ignored entries, memory, keyboard, context menu, Properties), the file
actions (Attach as context, Open in, Show in Explorer, Copy) and the OS openers.
Start under05_Software at renderer/components/documents (docs-tab.tsx, docs-tree.tsx, tree-menu.tsx,
tree-properties.tsx, file-actions.tsx), core/workbench/tree.ts and main/openers.ts. Focused tests are
docs-tree.test.ts, documents.test.ts, core workbench/tree.test.ts, openers.test.ts and
tests/e2e/{documents,docs-tree}.spec.ts.
[Files Git status](files-git-status.md) owns the opt-in Git overlay, Git refresh and virtual rows.
[Document viewer](document-viewer.md) owns the tabs and bodies that rows and hits open;
[file viewing modes](document-viewer-file-modes.md) owns the mode a file row opens in;
[Document search](document-search.md) owns retrieval/extraction validity; [ingest](knowledge-ingest.md)
owns the index queue; [Chat UI](chat-ui.md) owns the attached-entry chips.

## Purpose and boundaries

The Docs tab lists the whole workbench folder as a tree with index status, searches file names and
indexed documents from one box and offers OS actions on entries. Core workbench/tree.ts owns the
confined listing, find and properties; main owns program launches and the clipboard; the active-lease status arrives through
a current snapshot and coalesced workbench updates.

## Public interface

- Docs tab layout (documents/docs-tab.tsx): one search box (`data-docs-search`,
  "Search files and documents", 200 characters), then one `.docs-actions` row with Reindex and
  Collapse all (wrapping only when too narrow; Collapse all is disabled while the box has
  text), status and the tree. While the count guard stops indexing
  (documents/index-guard.tsx, `data-index-guard`, role alert), Files shows the localized
  count and limit, the top folders (`data-guard-folder`), Index anyway
  (docs.approve with the shown count, disabled read-only) and Edit exclusions, which App turns
  into openEditor(active, "documents") (REQ-UX-0c1aea14, REQ-UX-597b7c82). One 250 ms
  debounce feeds both the tree's name filter and docs.search; while the box has text the
  keyword hits render under the tree in an "In documents" section (`data-docs-hits`, with its
  own loading, empty and retry states) (REQ-UX-2504362b, REQ-UX-d455531b).
- docs.list({workbenchId}) returns scoped document statuses/reasons.
- docs.search({workbenchId,query}) returns the scoped document search metadata and up
  to 20 keyword hits. One bounded revision check covers ranking and deduplicated
  per-source SHA/status/kind/locator verification. The results area distinguishes
  complete no-match results, no matches within a limited index, and temporary unavailability.
- docs.reindex({workbenchId?}) checks identity/ownership before ingest admission.
- FilesIndexControls and the sidebar subscribe to the same workbench id and activation lease.
  They merge the latest snapshot into status-only query data. On a new activation App drops
  file query data for that id, also when the workbench was copied to another folder.
  Files reports actionable exceptions,
  includes the count guard and Restart controls, and disables Reindex while stopped or read-only.
  The document tree uses its existing coalesced refresh for document publication.
- Docs tree (documents/docs-tree.tsx) lists the whole workbench folder.
  docs.tree({workbenchId,path}) lists one folder (folders first, natural order, at most 5,000
  with `truncated`, links left out); a folder's entries load when it is expanded. Entries the
  .vera, .git, node_modules and .veraignore rules hide from the agent and the index, or that a
  .gitignore excludes while docs.gitignore is on (REQ-FUNC-ed6a4de8; left out of Find too), come with
  `ignored: true` (inherited inside ignored folders) and render in italic muted text at AA
  contrast with faded icons (`data-ignored`, screen-reader "Ignored by VERA"); they expand, are
  remembered and use the applicable [file mode](document-viewer-file-modes.md) like other rows, but never offer Open in default app, which
  PathGuard refuses (REQ-UX-ed65cbbc).
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
  offers Open (folders expand), Attach as context (inside the app only, disabled
  for ignored entries, a read-only workbench or a full chat; see [Chat UI](chat-ui.md)), Open in,
  Show in Explorer, Copy and Properties. Disabled items carry `aria-disabled`,
  stay reachable by the arrow keys and do nothing.
  It opens at the pointer or below the row, focuses its first item, wraps arrows, runs on
  Enter/Space and closes on Escape/Tab (focus back to the row), outside press, blur, resize or
  scrolling of what holds it. Rows contain no buttons (REQ-UX-541a5bee). Items with `items`
  are submenus (`aria-haspopup`, `data-submenu`, items at `data-menu-depth` 0 or 1): one open at
  a time, by click or hover (a click never closes what hover opened) and by Enter, Space or
  ArrowRight with focus on its first item; ArrowLeft or Escape close it and focus its item; a submenu that would leave the window opens to the left
  (`data-side="left"`) (REQ-UX-89cdb49d).
- File actions live in one hook, `useFileActions(workbenchId, menuFor)` (documents/file-actions.tsx): Attach as context, Open in (Default app for allowlisted documents outside
  `.vera/` through app.openPath, detected editors, Linux system apps of `menuFor`, the Open with
  dialog), Show in Explorer/Finder/folder, Copy and Properties, with `error`/`notice` for the
  caller to show. The Files tree row menu prepends Open; the document tab menu appends them to the
  tab actions for workbench file tabs (`file:` keys) that are not artifacts; a managed download's
  tab offers Show in Explorer only (downloads.reveal); an artifact tab none (REQ-UX-f261c988,
  REQ-UX-f5d6e9e4). An ignored file has no Default app item. `useDescribeDocument()` gives the
  localized index status for Properties in both places.
- Open in lists Default app for allowlisted files VERA does not ignore (app.openPath, accessible
  name "Open in default app: <path>", REQ-UX-f5d6e9e4) and the programs main detected, from the
  `docs.openers` query: VS Code, Cursor and Notepad++ for files, VS Code, Cursor and Terminal for
  folders; for a file, "Other app..." last on Windows (the system Open with dialog) or, on Linux,
  the applications the system registers for its type from a `docs.systemApps` query run when the
  menu opens on that file; what a platform cannot do never appears; Open in is left
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
  (REQ-FUNC-98e9d760, REQ-UX-4d1b3324).

## Invariants

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
  panel only: docs.find skips them, and the agent's PathGuard, ingest
  selection and providers still never see them. Bounds:
  5,000 entries per folder, 200 matches and 50,000 walked entries per find. The legacy docs.read
  API retains its strict UTF8/NUL and 5MiB checks; the ordinary file UI uses the byte-backed text
  path of [file viewing modes](document-viewer-file-modes.md) with explicit replacement and selected encodings. statEntry refuses the workbench folder
  itself. Main retains every result and applies conditional Display presentation with separate host authority.

## Change map

| Change | Start | Focused proof |
|---|---|---|
| tree listing/find/text/stat bounds | core workbench/tree.ts; WorkbenchService; shared docs.tree/find/read/stat | tree.test.ts; documents-ipc.test.ts |
| tree UI, ignored rows, memory, keys | documents/docs-tree.tsx; mockApi docs.tree/find/read | docs-tree.test.ts; documents.spec.ts; docs-tree.spec.ts |
| search box, In documents, actions row | documents/docs-tab.tsx (`useTreeExpansion`); styles `.docs-actions` | docs-tree.test.ts; documents.test.ts; documents.spec.ts |
| row context menu / Properties | documents/tree-menu.tsx; tree-properties.tsx; mockApi docs.stat | docs-tree.test.ts; documents.test.ts; docs-tree.spec.ts |
| Open in / Show in Explorer / Copy | main/openers.ts; index.ts docs.openers/openWith/reveal/copyPath/systemApps/openSystemApp; core locateEntry; file-actions.tsx useFileActions | openers.test.ts; tree.test.ts; documents-ipc.test.ts; docs-tree.test.ts; docs-tree.spec.ts |

## Key behaviors

- REQ-UX-28ad0003 — live Docs index, search/open/reindex and progress.
- REQ-FUNC-889beffd, REQ-FUNC-2e3fad2d, REQ-FUNC-70dc2e8f, REQ-FUNC-98e9d760 — confined tree
  listing, name find, text read and entry properties.
- REQ-UX-c28dde55, REQ-UX-795a7f61, REQ-UX-775eb693, REQ-UX-9f16abf2, REQ-UX-2d9cdf43,
  REQ-UX-fdd495b8, REQ-UX-541a5bee, REQ-UX-4d1b3324 — Docs tree, folder counts, opening,
  filter, memory, keyboard, context menu and Properties.
- REQ-UX-ed65cbbc, REQ-UX-2504362b, REQ-UX-d455531b — ignored entries in italic with faded icons, document
  hits under the filtered tree, one search box with Reindex and Collapse all on one row.

## Files

Under05_Software: shared/{documents,ipc}.ts; core workbench/{service,tree}.ts/test;
desktop/main/{index,openers}.ts and openers.test.ts; renderer/components/documents/{docs-tab,
docs-tree,tree-menu,tree-properties,open-externally,file-actions,index-guard}.tsx with documents.test.ts and
docs-tree.test.ts; mock documents+mockApi; tests/e2e/{documents,docs-tree}.spec.ts.
