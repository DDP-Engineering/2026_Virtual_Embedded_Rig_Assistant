# Managed PDF downloads

## Routing

Select for web_download, PdfDownloads, public PDF transfer, .vera/downloads, download approvals or Open PDF cards/history. Start under 05_Software at core/src/web/{pdf-transfer,pdf-downloads}.ts and tools/web-download.ts. Focused proofs are web/pdf-{transfer,downloads}.test.ts, sessions/downloads.test.ts, shared/downloads.test.ts and tests/e2e/pdf-download.spec.ts. [Web access](web-search.md) owns global authorization/search credentials, [documents](document-viewer.md) owns the local PDF viewer, and [ingest](knowledge-ingest.md) owns RAG.

## Purpose and boundaries

Download a public PDF independently of search-provider credentials, preserve exact bytes/provenance in the workbench-owned .vera/downloads namespace, and let the user open it locally. No browser login/cookies, external file launching, generic binary download, text-file tool widening or automatic RAG indexing. Completed downloads belong to the workbench rather than the originating session.

## Public interface

- web_download({url,filename?}) is a prepared write tool. It returns only {download: metadata}, never binary/base64 or extracted PDF text.
- PdfDownloads.allocate makes a fresh UUID and portable PDF name (safe URL basename or document.pdf by default), with no network I/O. save transfers/validates then publishes through the host write queue; list/open are offline reads; close cancels and drains owned work.
- Metadata contains downloadId, name/path, sourceUrl/finalUrl, sessionId/callId, application/pdf, bytes, SHA-256, createdAt and page count. Files live at .vera/downloads/<UUID>/<name>.pdf with strict manifest.json provenance.
- ConfiguredWebProvider.withAccess leases global authorization without consulting search-provider keys/capabilities. Its live assertion and cancellation are checked around publication.
- downloads.list({workbenchId}) returns validated records newest first. downloads.open({workbenchId,downloadId}) validates current workbench identity and exact bytes before returning existing PDF ViewerContent.
- createDownloadPdfExtractor uses the existing disposable PDF worker with a 120-second deadline and 256 MiB old-generation heap limit; ordinary ingest defaults are unchanged.

## Invariants

Every HTTP(S) source/redirect is credential-free and resolved to public addresses; mixed/private DNS answers are rejected. Node HTTP lookup is pinned to a validated address while HTTPS keeps original-hostname certificate checks. Mapped/NAT64/tunneled IPv6 and local destinations are excluded. Source hosts receive only GET, PDF Accept, identity encoding and VERA user-agent headers; provider credentials and cookies are absent.

PDF or binary-download MIME, PDF signature and actual worker parsing are required. Transfer has at most five redirects, the existing 100 MiB PDF budget and a 120-second overall cooperative deadline. DNS, connector and body waits are cancellable, including late-response cleanup. Invalid/oversized/failed/revoked attempts publish nothing.

Read-only and per-workbench exclusions hide the tool. Ask and protected Auto-edit require source/destination/budget approval before network; Bypass uses the existing approval gate. A mode change revokes captured Bypass execution authority. Global Web access disable/reconfiguration cancels pending transfers, while saved PDFs remain readable offline.

Publication exclusively writes and fsyncs a UUID staging directory, verifies ordinary managed parents and live authority, then renames and checks authority again. Failed acceptance removes only the exact owned unpublished files/directory. Linked parents/files, malformed IDs/names, identity mismatches and changed hashes are rejected. Metadata and PDF reads use bounded asynchronous I/O with file identity checks. No overwrite or user docs folder creation; .vera remains excluded from ingest.

## Key behaviors

The successful transcript tool shows a compact localized saved status and an Open PDF card with name/source/date. Technical result JSON stays expandable. Completed download approval details collapse to their decision. Docs exposes the same local history. Downloads open in the right panel Source tab; direct PDFs have no misleading citation-only label, and retain page/zoom/find, Escape/Close, focus restoration and stale scope handling. en/ro/de translations cover new UI and tool descriptions. Host disclosure scrubs every metadata string, dropping unusable redacted identities while preserving binary PDFs through the existing viewer boundary.

## Files

- shared/src/{downloads,ipc,tools,events,session-state}.ts: metadata/IPC/catalog/approval contracts.
- core/src/web/{pdf-transfer,pdf-downloads,configured-provider,provider}.ts: wire/storage/authorization/public URL checks.
- core/src/tools/{web-download,registry,context,changes}.ts, sessions/service.ts, agent/approvals.ts: prepared permission and session lifetime.
- desktop main/{index,sessions,document-viewer}.ts and cli/{run,approval-prompt}.ts: host composition and disclosure.
- renderer/components/documents/{downloads,docs-tab,viewer-context,pdf-viewer}, session/{transcript,approval-card}, workbench-tools and locales: UI.

## Change map

Network/DNS/redirect/deadline changes attach to pdf-transfer.test.ts, including private/mixed answers, header/stream caps, noncooperative stalls and public redirects. Storage/provenance/cleanup/parser changes attach to pdf-downloads.test.ts (real PDF worker), permissions/lifetime to sessions/downloads.test.ts, IPC to shared/downloads.test.ts and existing preload/router checks. Native pdf-download.spec.ts checks approval, exact bytes, page rendering, centering, translations, no RAG, failure/revocation, restart/offline and stale scopes using a public-URL-to-owned-loopback fixture; its network guard rejects all other outbound calls. A separate manual public W3C sample smoke verifies the real pinned HTTPS connector without credentials or LLM spend.
