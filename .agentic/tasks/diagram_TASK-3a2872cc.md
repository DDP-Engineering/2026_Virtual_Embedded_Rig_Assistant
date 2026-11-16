# TASK-3a2872cc diagrams

Illustrates the task Design. Map: command tool, runner records, Runs, run IPC and viewer provider are changed; text viewer is reused unchanged.

## Structure

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  command["runCommandTool"]:::changed ==> runner["ProgramRunner records"]:::changed
  runner --> ipc["runs.list/log/stop"]:::changed
  ipc ==> runs["RunsTab"]:::changed
  runs ==> provider["DocumentViewerProvider runId target"]:::changed
  provider ==> text["TextViewer"]
```

## Sequence

```mermaid
sequenceDiagram
  participant Agent
  participant Runner as ProgramRunner
  participant Runs as RunsTab
  participant Viewer as DocumentViewerProvider
  Agent->>Runner: run_command background
  Runner-->>Runs: runs.list and bounded runs.log
  Runs->>Runner: runs.stop(workbenchId,id)
  Agent->>Runner: program_output(handle)
  Runner-->>Agent: running=false, stopped=true
  Runs->>Viewer: open(runId)
  Viewer->>Runner: runs.log(full=true), via masked main IPC
  Runner-->>Viewer: complete text
```

## State

Not drawn: existing run lifecycle is unchanged; stopped reads expose the existing final state.
