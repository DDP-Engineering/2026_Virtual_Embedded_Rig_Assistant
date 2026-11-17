# TASK-d6ed6549 diagrams

Illustrates the authoritative task Design.

## Structure

Map: provider/tree/useTextRows/core viewer/readWindow/readBytes/Display/schema changed;
large source/index/find/window/rows/viewer and fileRevision added. Session verification is reused.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 provider["DocumentViewerProvider / Files tree"]:::changed ==> viewer["LargeTextViewer"]:::added
 viewer ==> source["LargeTextSource"]:::added
 viewer ==> index["LargeTextIndex"]:::added
 viewer ==> find["findLargeText"]:::added
 viewer ==> rows["LargeTextRows / readTextWindow"]:::added
 rows ==> measure["useTextRows"]:::changed
 index ==> source
 find ==> source
 source ==> host["DisplayDocuments / docs.readBytes"]:::changed
 provider ==> citation["SessionService.openCitation"]
 citation ==> core["DocumentViewer / readWindow"]:::changed
 core ==> version["fileRevision"]:::added
 core ==> host
 host ==> schema["shared documents schemas"]:::changed
```

## Sequence

```mermaid
sequenceDiagram
 participant U as User
 participant V as DocumentViewerProvider
 participant C as SessionService / DocumentViewer
 participant H as DisplayDocuments
 participant S as LargeTextSource
 U->>V: Open issued large-text citation
 V->>C: docs.open with original provenance
 C->>C: Issuance, SHA, range and source snapshot checks
 C-->>H: Compact source with original ref/snippet/range
 H->>H: Seal revision to owner and original path
 H-->>V: Bounded byteSource descriptor
 V->>S: Open source and settle cited line
 loop Bounded chunks with yielding
 S->>H: readBytes with sealed revision
 H->>H: Check current revision, capture original line ends, mask bytes
 H-->>S: Bounded validated bytes and line ends
 end
 S-->>V: Exact cited source rows
```

## State

```mermaid
stateDiagram-v2
 [*] --> Window
 Window --> Scanning: Find / Go to line / byte navigation
 Scanning --> Window: exact result / no match / Cancel
 Scanning --> Scanning: superseding request aborts old operation
 Window --> Error: inconsistent source / read failure
 Scanning --> Error: inconsistent source / read failure
 Error --> Loading: parent Retry
 Loading --> Window: provenance and metadata validated again
 Window --> Disposed: Display refresh / unmount
 Scanning --> Disposed: Display refresh / unmount
 Disposed --> [*]
```
