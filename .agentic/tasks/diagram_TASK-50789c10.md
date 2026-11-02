# TASK-50789c10 diagrams

Illustrates `## Design` in `TASK-50789c10.md`. The Design text is authoritative.

Node classes: added = ProcessHost port, NodeProcessHost, ProgramRunner, run-output, launcher,
process-tree, desktop process-host, CLI process-host, echo-program fixture; changed = desktop main
index, CLI run, biome boundary; unchanged = PathGuard.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    main["desktop main/index.ts"]:::changed ==> dhost["main/process-host.ts"]:::added
    cli["cli/src/run.ts"]:::changed ==> chost["cli/src/process-host.ts"]:::added
    dhost ==> nph["NodeProcessHost (spawn injected)"]:::added
    chost ==> nph
    main ==> runner["ProgramRunner"]:::added
    cli ==> runner
    runner ==> port["ProcessHost port (ports.ts)"]:::added
    nph -. implements .-> port
    runner ==> out["run-output: decode, ANSI, tail"]:::added
    runner ==> tree["process-tree: taskkill / group signals"]:::added
    runner ==> guard["PathGuard"]
    runner ==> logs[(".vera/runs/ulid.log")]
    tree ==> port
    launch["launcher.ts quoting"]:::added
    biome["biome.json core boundary"]:::changed
    fixture["tests/fixtures/echo-program"]:::added
```

## Sequence

```mermaid
sequenceDiagram
    participant C as Caller (PLG-04 tool)
    participant R as ProgramRunner
    participant G as PathGuard
    participant H as ProcessHost
    participant P as Program tree
    C->>R: start(request)
    R->>R: background limit, serial guard, reserve
    R->>G: resolve(cwd)
    R->>R: open log, prune to 200, build env
    R->>H: spawn(executable, args, {cwd, env, group})
    H->>P: child_process.spawn, shell false, stdin ignored
    P-->>H: stdout/stderr bytes
    H-->>R: output(stream, chunk)
    R->>R: decode, strip ANSI, log, tail
    alt timeout, Stop, abort or lifecycle stop
        R->>H: taskkill /T /F /PID (win32) or signal(-pid, SIGTERM), sleep 3 s, SIGKILL
        H->>P: kill tree
    end
    P-->>H: exit
    H-->>R: exit {code, signal, error?}
    R-->>C: RunResult {exitCode, output tail, log, truncated, timedOut, stopped}
```

## State

```mermaid
stateDiagram-v2
    [*] --> reserved: start (limit and port checks pass)
    reserved --> refused: guard DENIED or stopped before spawn
    reserved --> running: spawned
    running --> stopping: timeout, Stop, abort or lifecycle stop
    running --> finished: program exits
    stopping --> finished: tree killed, exit observed
    refused --> [*]
    finished --> [*]
```
