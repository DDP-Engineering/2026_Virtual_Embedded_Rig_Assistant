# Document viewer and document tabs

## Routing

Select for citation opening, the document tabs of the chat area (open, select, close, kept places,
per-session sets saved per session), continuous PDF scrolling with zoom/find/snippet, Markdown/HTML/office
anchors, presentation slides, numbered lines of verified refs, run-log and download tabs, and
Git comparison and history tabs, recorded session edit tabs, and conditional Display masking of document names, refs and content.
Start under05_Software at main/display-documents.ts and display-identities.ts for conditional
Display masking, shared/documents.ts, core/knowledge/viewer.ts and
renderer/components/documents (viewer-context, document-tabs, pdf-viewer). Focused tests are viewer.test.ts, search.test.ts,
documents.test.ts, document-tabs.test.ts and tests/e2e/{citations,documents,office-documents}.spec.ts.
[File viewing modes](document-viewer-file-modes.md) owns ordinary-file Rendered/Text/Hex modes,
byte-backed text, Hex, image preview and docs.readBytes; the [Docs panel](document-viewer-docs-panel.md)
owns Docs status/search/reindex/progress, the folder tree, its menus, file actions and OS openers.
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

- Files exposes Attach image on PNG, JPEG, GIF and WebP entries and lets users drag eligible image rows into the composer. Attachment admission still uses a guarded primary-workbench read. Attach as context continues to send path mentions.

- docs.open accepts workbenchId with indexed path, document ref, or
  sessionId/messageId/ref. It returns scoped ViewerContent for PDF bytes/pages,
  presentation slides with the cited page/pageEnd, Markdown/HTML/document/
  spreadsheet sections and extraction slugs, numbered source lines or artifact.
- DocumentViewer.open(ref,snippet?) and openPath(path) check source/locators;
  SessionService.openCitation resolves a completed assistant citation against
  preceding successful tool results and current file/artifact content.
- SessionService admits UTF8 control-byte logs only for successful parse_log line-ref provenance. The viewer uses guarded direct reads up to50MiB, fatal UTF8 and matching source hashes, independent of document indexing; ordinary document/file refs retain binary and index checks.
- Managed PDF downloads use downloads.list/open scoped IPC and a downloadId ViewerTarget; see [PDF downloads](pdf-downloads.md). Docs includes saved PDF history, and successful download tool cards open the existing viewer without indexing. Downloads open in a document tab of the chat area like every source, and uncited PDFs omit citation-only labels. Host publicWebDownload scrubs metadata strings and drops invalid redacted records.
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
  ordinary identity checks for responses without correlation. Display/config events invalidate affected cached file scopes and their labels/content, except an app `settings.changed` marked `masking: false`;
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
- Finished run logs use a validated runId target and `run:<id>` tab key. The provider loads `runs.log({workbenchId,id,full:true})`, rejects mismatched IDs, then renders ordinary text lines in the existing viewer; the host returns at most the last 8 MiB, and a truncated reply is shown under a first line saying that earlier output is not shown. Run targets persist at renderer version 1 and do not enable file-path actions; log IPC derives the path from the current workbench and ULID.
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
- Git comparison targets use a distinct key per path and comparison. History uses a separate target keyed by path. They share tab operations and keep Chat mounted. The provider holds results for the enabled workbench activation, verifies workbench, lease, path and applicable comparison, and clears content on Display refresh. A retired activation drops Git tabs, their results and opener references. The provider stores ordinary targets in the existing version-1 record and keeps Git targets transient. PatchDocument presents masked source context and hunks through DiffViewer. GitHistoryView presents inert commit text and localized dates and bounded status notices.
- Recorded session edit tabs open from Changes and use a transient sessionChange target with
  change ID, session ID and path. The provider scopes tabs to workbench and session, checks the
  detail response IDs and shares per-attempt retry. SessionChangeDiff presents the stored patch
  and confined reveal. See [Changes](changes.md).
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
- The document panel shows its applicable Rendered/Text/Hex toolbar ([file viewing modes](document-viewer-file-modes.md)) and the document (or its load error with Retry), without a path line or file-action buttons for ordinary documents; the path is the tab's tooltip (REQ-UX-968b89b0). Patch documents show a source heading and comparison context. A tab menu action's error or notice
  shows in `[data-tab-notices]`, the row between the tab strip and the panels, also while Chat is
  selected, and clears when another tab is selected. Tab keys and stale menus: the window listener
  is idle while any `[data-tree-menu]` is open, and a menu whose tab closed goes away.
- Document tabs: HTML5 drag and drop moves a document tab before the tab it is
  dropped on or to the strip end (`[data-tab-strip-end]`); Chat is not draggable and refuses drops
  (REQ-UX-e0410483). The tab context menu (right click, Shift+F10, menu key; `TreeMenu`) offers
  Close, Close others, Close to the right, Move left, Move right, then the file actions of the [Docs panel](document-viewer-docs-panel.md)
  (REQ-UX-67abf562); the provider's `move(key, before)` and `closeMany(keys, keep)` back it. One
  window keydown listener, idle while a `dialog[open]` exists or an IME composes, handles
  Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp (select with wrap, REQ-UX-fd131983),
  Ctrl+Shift+PageDown / PageUp (move the selected document tab, REQ-UX-6ecb6c83) and Ctrl+W / Cmd+W
  (close it, REQ-UX-a45c4384). These keys are fixed: the shortcut registry's grammar cannot express
  Tab or PageUp and reserves Mod+W. A managed download's tab has no Open in default app (`.vera/` is
  outside the allowlist).
- The Chat panel (`[data-chat-panel]`) shares the grid cell of the document panel; while a document
  is selected it is `inert` with `visibility: hidden` (never the `hidden` attribute, whose
  `display: none` resets the transcript's scroll in Chromium), so the transcript keeps its scroll. While it is hidden,
  SessionWorkspace ignores its window shortcuts; a composer focus request (Attach as context) is
  taken once (`composerFocused` clears it in App), selects Chat once and focuses the composer when
  it is enabled.
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
- Named document/text and PDF regions support keyboard scrolling. Docs Open actions include path/ref identity in accessible names.
- Document menu: right-click, Shift+F10 or the menu key in a document panel (not
  in its find or line field) opens a `TreeMenu` beside the panel (outside it, so the menu's Escape
  does not leave the tab). Items carry `keys` (`aria-keyshortcuts`, shown with Ctrl): text -> Copy,
  Find, Go to line; PDF -> Copy, Find, Zoom in/out, Reset zoom; others -> Copy. Copy keeps the
  selection taken when the menu opened (only one inside the panel; disabled otherwise) and runs
  the editing `copy` command on it, because every web permission (so `navigator.clipboard`) is
  denied (REQ-UX-c514899c, REQ-FUNC-6d1fb02f). Find and Go to line bump the same requests as
  Ctrl+F/Ctrl+G; zoom sends a `ZoomRequest {step, id}` to PdfViewer (REQ-UX-160f9f68).
- Saved tabs: `lib/document-tabs-store.ts` keeps one localStorage record per
  workbench session, `vera.tabs.<workbenchId>.<sessionId>`, `{version: 1, active, tabs: [{target,
  place?}]}` under a strict zod schema; a missing, unreadable or invalid record reads as none, and
  storage errors never throw (REQ-DATA-3b6664f9, REQ-REL-f19a4bc2). The provider restores a
  session the first time it is shown in a run: it checks downloads (`downloads.list`), artifacts
  (`artifacts.list`) and files (`docs.stat`, only NOT_FOUND drops a tab; other failures keep the
  tab with its load error), puts the restored tabs before tabs opened meanwhile and keeps their
  places (REQ-FUNC-8a061992, REQ-REL-4622d972). A delegation link explicitly selects Chat, even
  when stored document tabs are still being restored. Only restored sessions are saved: 500 ms after a
  change and at once on `pagehide`. Deleting a session removes its record (REQ-FUNC-d9d16533).

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
| tab menu, drag, tab keys | documents/document-tabs.tsx; viewer-context move/closeMany; file-actions.tsx | document-tabs.test.ts; citations.spec.ts (real drag) |

## Key behaviors

- REQ-FUNC-c07a945e, REQ-SEC-df8a595a — live conditional Display with stable restart-safe workbench-owned identities.
- REQ-FUNC-28ad0001 — guarded scoped viewer payload and citation provenance.
- REQ-UX-28ad0002 — accessible offline locator viewer and snippet navigation.
- REQ-UX-64738341 — extracted office text shown as numbered slides or sections with the cited unit in view.

## Files

Under05_Software: shared/{documents,ipc}.ts; core/knowledge/viewer.ts/test,
core/sessions/service.ts, workbench/service.ts/test and knowledge/search.test.ts;
desktop/main/{index,document-viewer,display-documents,display-identities,security}.ts and
document-viewer.test.ts; renderer/components/documents/{viewer-context,pdf-viewer,document-tabs,text-viewer}.tsx,
documents.test.ts and document-tabs.test.ts; renderer lib/document-tabs-store.ts; session/{markdown,transcript,artifacts-tab};
App/Shell/styles/locales/mock documents+mockApi; electron.vite.config.ts/index.html;
tests/fixtures/llm-scripts/{document-viewer,office-citations}.jsonl;
tests/e2e/{citations,documents,office-documents}.spec.ts.
