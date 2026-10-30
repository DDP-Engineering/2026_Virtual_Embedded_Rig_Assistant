# TASK-6bbaec5c diagrams

Illustrates `## Design` in `TASK-6bbaec5c.md`. The Design text is authoritative.

## Structure

Node map: web_download/PdfDownloads/pdf-transfer/Downloads UI added; ApprovalGate (payload), ConfiguredWebProvider, IPC and ViewerContext changed; PdfExtractor/PDFViewer reused unchanged.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 tool["web_download"]:::added --> approval["ApprovalGate"]:::changed
 approval --> store["PdfDownloads"]:::added
 store --> access["ConfiguredWebProvider.withAccess"]:::changed
 access --> transfer["pdf-transfer"]:::added
 store --> worker["PdfExtractor"]
 ui["Downloads UI"]:::added --> ipc["downloads.list/open IPC"]:::changed
 ipc --> store
 ui --> viewer["ViewerContext"]:::changed
 viewer --> pdf["PDFViewer"]
```

## Sequence

```mermaid
sequenceDiagram
 participant Agent
 participant ApprovalGate
 participant PdfDownloads
 participant PublicServer
 participant PdfExtractor
 participant User
 participant PDFViewer
 Agent->>ApprovalGate: prepared web_download
 ApprovalGate->>PdfDownloads: approved source and destination
 PdfDownloads->>PublicServer: validated pinned public GET
 PublicServer-->>PdfDownloads: bounded binary PDF
 PdfDownloads->>PdfExtractor: validate in cancellable worker
 PdfExtractor-->>PdfDownloads: pages
 PdfDownloads-->>Agent: atomically saved metadata only
 User->>PDFViewer: Open PDF by scoped identifier
 PDFViewer->>PdfDownloads: verified local content
 PdfDownloads-->>PDFViewer: PDF bytes and pages
```

## State

```mermaid
stateDiagram-v2
 [*] --> Prepared
 Prepared --> AwaitingApproval
 AwaitingApproval --> Aborted: denied or cancelled
 AwaitingApproval --> Downloading: approved and web enabled
 Downloading --> Validating: bounded public response
 Downloading --> Aborted: network or gate failure
 Validating --> Publishing: parseable PDF
 Validating --> Aborted: invalid or cancelled
 Publishing --> Saved: atomic guarded commit
 Publishing --> Aborted: guard failure
 Saved --> Viewing: verified local open
 Viewing --> Saved: close
 Aborted --> [*]: unpublished scratch removed
```
