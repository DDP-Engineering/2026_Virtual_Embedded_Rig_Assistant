# TASK-6ca805fc diagrams

The journal's Design is authoritative.

## Structure

New nodes are `wireshark_dumpcap_start`, `Dumpcap` and `LiveCaptureSessions`. `ApprovalGate` changes. `ProgramRunner` and `publishCaptures` are reused.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    tool["wireshark_dumpcap_start"]:::added ==> gate["ApprovalGate"]:::changed
    tool ==> sessions["LiveCaptureSessions"]:::added
    sessions ==> runner["ProgramRunner"]
    runner ==> native["Dumpcap"]:::added
    sessions ==> storage["publishCaptures"]
```

## Sequence

```mermaid
sequenceDiagram
    participant Tool as wireshark_dumpcap_start
    participant Gate as ApprovalGate
    participant Runner as ProgramRunner
    participant Dumpcap
    participant Storage as publishCaptures
    Tool->>Gate: Request and consume exact approval
    Tool->>Runner: Compile filter for observed local interface
    Runner->>Dumpcap: Run bounded capture
    Dumpcap-->>Runner: Exit and finalize file receipts
    Runner-->>Tool: Owned terminal outcome
    Tool->>Storage: Publish validated retained segments and manifest
```

## State

```mermaid
stateDiagram-v2
    [*] --> Running: Approved run starts
    Running --> Finalizing: Native exit or owned Stop
    Finalizing --> Expired: Time or storage reaches a limit
    Finalizing --> Stopped: Owned cancellation
    Finalizing --> Failed: Acquisition or publication error
```
