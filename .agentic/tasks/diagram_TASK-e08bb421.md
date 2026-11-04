# TASK-e08bb421 diagrams
Illustrates Design in TASK-e08bb421.md.
## Structure
Map: registry/worker entry/NodeWorkerPool changed; scanner/schema added; PathGuard reused; citation verifier, readWindow, SessionService and DocumentViewer changed.
```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 registry["ToolRegistry"]:::changed ==> schema["parseLogArgsSchema"]:::added
 registry ==> host["NodeWorkerPool"]:::changed
 host --> entry["grep-worker dispatcher"]:::changed
 entry ==> scanner["scanLog"]:::added
 scanner ==> guard["PathGuard"]
 service["SessionService"]:::changed --> registry
 service ==> citations["validateCitations / issuedLogRefs"]:::changed
 citations ==> reader["readWindow UTF8 log mode"]:::changed
 service ==> viewer["DocumentViewer"]:::changed
 viewer ==> reader
```
## Sequence
```mermaid
sequenceDiagram
 participant Tool as parseLogTool
 participant Host as NodeWorkerPool
 participant Worker as scanLog
 Tool->>Host: run kind parse_log
 Host->>Worker: task
 Worker-->>Host: bounded checkpoints
 Worker-->>Host: result or failure
 Host-->>Tool: terminate then resolve
```
## State
```mermaid
stateDiagram-v2
 [*] --> Queued
 Queued --> Active: capacity
 Queued --> Terminating: deadline or abort
 Active --> Terminating: done, error, deadline or abort
 Terminating --> Settled: worker terminated
 Settled --> [*]
```
