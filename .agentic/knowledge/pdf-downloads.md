# Managed PDF downloads

## Routing

Select for web_download, WebDownloads, public PDF transfer, .vera/downloads, download approvals or Open PDF cards/history. Start under 05_Software/src/libraries at core/src/web/{download-transfer,downloads}.ts and core/src/tools/web-download.ts. Focused proofs are web/{download-transfer,downloads}.test.ts, sessions/downloads.test.ts, shared/downloads.test.ts and tests/e2e/pdf-download.spec.ts. [Web access](web-search.md) owns global authorization/search credentials, [documents](document-viewer.md) owns the local PDF viewer, and [ingest](knowledge-ingest.md) owns RAG.

## Purpose and boundaries

Download a public file independently of search-provider credentials and preserve exact bytes and provenance in the workbench-owned .vera/downloads namespace. PDFs open in VERA and other files can be shown in the file manager. There is no browser login, cookie use or automatic RAG indexing. Completed downloads belong to the workbench.

## Public interface

- web_download({url,filename?}) is a prepared write tool. It returns only {download: metadata}, never binary/base64 or extracted PDF text.
- WebDownloads.allocate assigns a UUID and a portable name (safe URL basename or download.bin) without network I/O. Save streams to an owned staging file with incremental SHA-256, validates PDFs from the open file in the worker, then publishes through the host write queue. List/open are offline reads and close cancels and drains owned work.
- Metadata contains downloadId, name/path, sourceUrl/finalUrl, sessionId/callId, application/pdf, bytes, SHA-256, createdAt and page count. Files live at .vera/downloads/<UUID>/<name>.pdf with strict manifest.json provenance.
- ConfiguredWebProvider.withAccess leases global authorization without consulting search-provider keys/capabilities. Its live assertion and cancellation are checked around publication.
- downloads.list({workbenchId}) returns validated records newest first. downloads.open({workbenchId,downloadId}) validates current workbench identity and exact bytes before returning existing PDF ViewerContent.
- createDownloadPdfExtractor uses the existing disposable PDF worker with a 120-second deadline and 256 MiB old-generation heap limit; ordinary ingest defaults are unchanged.

## Invariants

Every HTTP(S) source/redirect is credential-free and resolved to public addresses; mixed/private DNS answers are rejected. Node HTTP lookup is pinned to a validated address while HTTPS keeps original-hostname certificate checks; `firstReachable` tries the addresses in order (CONNECT_PATIENCE_MS, 10 s, for every one but the last). A refused local destination names run_command (LOCAL_NETWORK_HINT in web/provider.ts). An unexpected Content-Encoding is stored as sent and a missing or malformed content type becomes application/octet-stream. Mapped/NAT64/tunneled IPv6 and local destinations are excluded. Source hosts receive only GET, PDF Accept, identity encoding and VERA user-agent headers; provider credentials and cookies are absent.

A download detected or named as a PDF requires a PDF signature and worker validation. Transfer has at most five redirects, the approved size (default 100 MiB, range 10–1000 MiB, REQ-FUNC-8a1eea8b) and the configured Download time limit (default 120 s). The PDF validator uses the Document extraction time limit as its base (REQ-FUNC-aa35b135). DNS, connector and body waits are cancellable, including late-response cleanup. Invalid, oversized, failed or revoked attempts publish nothing.

Read-only and per-workbench exclusions hide the tool. Ask and protected Auto-edit require source/destination/budget approval before network; Bypass uses the existing approval gate. A mode change revokes captured Bypass execution authority. Global Web access disable/reconfiguration cancels pending transfers, while saved PDFs remain readable offline.

Publication exclusively writes and fsyncs a UUID staging directory, verifies ordinary managed parents and live authority, then renames and checks authority again. Failed acceptance removes only the exact owned unpublished files/directory. Linked parents/files, malformed IDs/names, identity mismatches and changed hashes are rejected. Metadata and PDF reads use bounded asynchronous I/O with file identity checks. No overwrite or user docs folder creation; .vera remains excluded from ingest.

## Key behaviors

The successful transcript tool shows a compact localized saved status and an Open PDF card with name/source/date. Technical result JSON stays expandable. Completed download approval details collapse to their decision. Docs exposes the same local history. Downloads open in a document tab of the chat area. en/ro/de translations cover new UI and tool descriptions. Host disclosure scrubs every metadata string, dropping unusable redacted identities while preserving binary PDFs through the existing viewer boundary.

## Files

- shared/src/{downloads,ipc,tools,events,session-state}.ts: metadata/IPC/catalog/approval contracts.
- core/src/web/{download-transfer,downloads,configured-provider,provider}.ts: wire/storage/authorization/public URL checks.
- core/src/tools/{web-download,registry,context,changes}.ts, sessions/service.ts, agent/approvals.ts: prepared permission and session lifetime.
- desktop main/{index,sessions,document-viewer}.ts and cli/{run,approval-prompt}.ts: host composition and disclosure.
- renderer/components/documents/{downloads,docs-tab,viewer-context,pdf-viewer}, session/{transcript,approval-card}, workbench-tools and locales: UI.

## Change map

Network/DNS/redirect/deadline changes attach to download-transfer.test.ts, including private/mixed answers, header/stream caps, noncooperative stalls and public redirects. Storage/provenance/cleanup/parser changes attach to downloads.test.ts (real PDF worker), permissions/lifetime to sessions/downloads.test.ts, IPC to shared/downloads.test.ts and existing preload/router checks. Native pdf-download.spec.ts checks approval, exact bytes, page rendering, centering, translations, no RAG, failure/revocation, restart/offline and stale scopes using a public-URL-to-owned-loopback fixture; its network guard rejects all other outbound calls. A separate manual public W3C sample smoke verifies the real pinned HTTPS connector without credentials or LLM spend.
