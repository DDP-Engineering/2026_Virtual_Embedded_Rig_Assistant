# TASK-41c72419 diagrams

The [design](TASK-41c72419.md) defines the contract.

## Structure

`CitationChip`, `SessionService` and packet output change. `CaptureCitation`, the IPC handler and
native Wireshark integration are added. `OfflineTshark` is reused.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854b0b
  classDef removed stroke-dasharray:4 3
  packet["Packet output"]:::changed ==> session["SessionService"]:::changed
  chip["CitationChip"]:::changed ==> dialog["CaptureCitation"]:::added
  dialog ==> ipc["wireshark.openFrame"]:::added
  ipc ==> session
  ipc ==> viewer["Native Wireshark integration"]:::added
  viewer ==> tshark["OfflineTshark"]
```

## Sequence

```mermaid
sequenceDiagram
  actor User
  participant Citation as CaptureCitation
  participant Main as wireshark.openFrame
  participant Session as SessionService
  participant Viewer as Wireshark Desktop
  User->>Citation: Submit open action
  Citation->>Main: Session, message, token, optional filter
  Main->>Session: Load issued evidence
  Session-->>Main: Capture and frame identity
  Main->>Main: Snapshot, verify frame and assess filter
  Main->>Viewer: Start with separate file, frame and filter arguments
  Main-->>Citation: Launch result and adjustment status
```

## State

```mermaid
stateDiagram-v2
  [*] --> Citation
  Citation --> Dialog: Open action
  Dialog --> Pending: Submit
  Pending --> Error: Validation or launch failed
  Error --> Pending: Retry
  Pending --> Launched: Native process started
  Dialog --> Citation: Cancel
  Launched --> Citation: Close dialog
```
