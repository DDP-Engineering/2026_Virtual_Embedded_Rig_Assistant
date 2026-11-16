# TASK-0698a3c3 diagrams

Illustrates Design in TASK-0698a3c3.md. Design is authoritative.

## Structure

Map: program-tools, program-request, runner and PathGuard change implementation; toolPathGuard and SessionService are reused unchanged.

```mermaid
flowchart LR
 classDef added fill:#e1f5ee,stroke:#0f6e56
 classDef changed fill:#faeeda,stroke:#854f0b
 classDef removed stroke-dasharray:4 3
 tools["program-tools"]:::changed ==> policy["toolPathGuard"]
 tools ==> request["program-request"]:::changed
 tools ==> runner["ProgramRunner"]:::changed
 runner ==> guard["PathGuard"]:::changed
 request ==> guard
 service["SessionService"] --> tools
```

## Sequence

```mermaid
sequenceDiagram
 participant T as program-tools
 participant G as toolPathGuard
 participant R as ProgramRunner
 participant P as ProcessHost
 T->>G: Current host mode and exclusions
 T->>T: Prepare canonical paths and hashes
 T->>R: Start approved request with guard and signal
 R->>R: Open log and write record
 R->>T: Verify integrity and file hashes
 R->>G: Recheck cwd and current authority
 R->>P: Spawn with approved cwd
```

## State

```mermaid
stateDiagram-v2
 [*] --> Prepared
 Prepared --> Running: Approval and final verification
 Prepared --> Refused: Changed files or revoked mode
 Running --> Finished: Normal exit
 Running --> Stopped: Leave Bypass
 Finished --> [*]
 Stopped --> [*]
 Refused --> [*]
```
