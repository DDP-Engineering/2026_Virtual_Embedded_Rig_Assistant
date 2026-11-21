# TASK-91f2fb57 diagrams

Illustrates the design in [TASK-91f2fb57](TASK-91f2fb57.md).

## Structure

Added: DictationCapture, pcm-worklet, CaptureJobs, whisper-worker. Changed: createBridge, secureSession. Reused: DictationModels.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    capture["DictationCapture"]:::added ==> pcm["pcm-worklet"]:::added
    capture ==> bridge["createBridge"]:::changed
    bridge ==> jobs["CaptureJobs"]:::added
    policy["secureSession"]:::changed ==> jobs
    jobs ==> models["DictationModels"]
    jobs ==> whisper["whisper-worker"]:::added
```

## Sequence

```mermaid
sequenceDiagram
    participant Capture as "DictationCapture"
    participant Bridge as "createBridge"
    participant Jobs as "CaptureJobs"
    participant Worker as "whisper-worker"
    Capture->>Bridge: Begin during a trusted input
    Bridge->>Jobs: Reserve the job and verify selection
    Jobs-->>Capture: Opening grant
    Capture->>Jobs: Acknowledge microphone acquisition
    Capture->>Capture: Release tracks and flush PCM
    Capture->>Jobs: Submit bounded PCM
    Jobs->>Worker: Load verified local model and transcribe
    Worker-->>Jobs: Transcript and language
    Jobs-->>Capture: Complete for the active owner
```

## State

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Opening: begin
    Opening --> Recording: acquire
    Recording --> Transcribing: stop and submit
    Opening --> Idle: cancel or acquisition fails
    Recording --> Idle: cancel or device loss
    Transcribing --> Idle: settle and terminate worker
```
