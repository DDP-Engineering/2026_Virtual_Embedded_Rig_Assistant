# TASK-6101faa4 diagrams

Illustrates `## Design` in `TASK-6101faa4.md`. The Design text is authoritative.

Node classes: added - kicad-layout plugin manifest, kicad-layout-tool (cli, request, state, candidate, kicad,
operations, drc, report), apply-candidate.ts, catalog/packs entries; changed - changes.ts (commitChange, tool union),
registry.ts, service.ts (host flag), shared tools.ts/events.ts, desktop sessions.ts (gate), renderer labels;
changed in review round 2 - ProgramRunner and program-tools (display variables for `gui: true` programs), shared
plugins.ts (the `gui` field); unchanged - Provisioner, approvals, write queue, the user's KiCad 10 (pcbnew, kicad-cli).

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    manifest["kicad-layout plugin.yaml (kicad-cli find >=10, tool uses kicad-cli, pinned kipy)"]:::added --> prov["Provisioner"]
    catalog["catalog.yaml / packs.yaml"]:::added --> prov
    prov --> runner["ProgramRunner (display variables for gui programs)"]:::changed
    runner --> cli["kicad-layout-tool cli (open, edit, close)"]:::added
    cli --> request["request.py (static checks)"]:::added
    cli --> candidate["candidate.py (project copy, hashes)"]:::added
    cli --> kicad["kicad.py (launch, api.sock, binding, busy retry, save, revert)"]:::added
    kicad --> pcbnew[("user's pcbnew (GUI, IPC API)")]
    cli --> ops["operations.py (resolve, locked, commit, outline, check_nets, unchanged by UUID and count)"]:::added
    ops --> kicad
    cli --> drc["drc.py (kicad-cli DRC, previews, new violations)"]:::added
    drc --> kcli[("user's kicad-cli")]
    cli --> state["state.py (state.json, board.json, created.json)"]:::added
    cli --> report["report.py (result.json, report.md)"]:::added
    state --> runs[("electronics-results/<run-id>")]
    report --> runs
    sessions["desktop sessions.ts (official plugin gate)"]:::changed --> service["SessionService (host flag)"]:::changed
    service --> registry["tools/registry.ts"]:::changed
    registry --> apply["tools/apply-candidate.ts"]:::added
    apply -- "reads state.json, candidate" --> runs
    apply --> changes["tools/changes.ts commitChange"]:::changed
    changes --> queue["write queue + approvals"]
    changes --> source[("source .kicad_pcb")]
    shared["shared tools.ts / events.ts"]:::changed --> service
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant T as kicad-layout-tool
    participant K as pcbnew (IPC API)
    participant C as kicad-cli
    participant V as VERA apply_candidate
    participant U as User
    A->>T: open --board main.kicad_pcb
    T->>K: probe api.sock (refuse if another window answers)
    T->>K: start pcbnew on candidate copy
    T->>K: open documents == candidate? save
    T->>C: DRC before, previews
    T-->>A: run folder, board.json, report
    A->>T: edit --run R (request)
    T->>K: bind, memory hash == state, resolve items
    T->>K: begin_commit, update/create, push_commit
    T->>K: outline, created nets kept, unchanged (else revert)
    T->>K: binding again, save, reload
    T->>T: state.json (objectives none), request, created.json
    T->>C: DRC after, previews
    T-->>A: objectives pass/fail, report (a failure here: exit 3, edit saved)
    A->>U: changes and previews
    U->>A: apply it
    A->>V: apply_candidate {run: R}
    V->>V: hashes, objectives, lock file
    V->>U: approval (ask mode)
    U->>V: approve
    V->>V: commitChange (rechecks, atomic write)
    A->>T: close --run R
    T->>K: memory hash == state, stop the editor
```

## State

```mermaid
stateDiagram-v2
    [*] --> Opened: open (copy, bind, save, DRC before)
    Opened --> Edited: edit ok (objectives pass)
    Opened --> Rejected: edit ok (objectives fail)
    Edited --> Edited: edit ok (pass)
    Edited --> Rejected: edit ok (fail)
    Rejected --> Edited: edit ok (pass)
    Rejected --> Rejected: edit ok (fail)
    Opened --> Opened: edit refused or failed before the save (state unchanged)
    Opened --> Saved: edit saved, checks failed (objectives none)
    Edited --> Saved: edit saved, checks failed
    Rejected --> Saved: edit saved, checks failed
    Saved --> Edited: next edit ok (pass)
    Saved --> Rejected: next edit ok (fail)
    Saved --> Closed: close
    Edited --> Edited: edit refused or failed
    Rejected --> Rejected: edit refused or failed
    Edited --> Applied: apply_candidate approved (hashes match, no lock)
    Edited --> Edited: apply refused, conflict or declined
    Opened --> Closed: close (no unsaved edits)
    Edited --> Closed: close
    Rejected --> Closed: close
    Applied --> Closed: close
    Closed --> Applied: apply_candidate (window not needed)
    Applied --> [*]
```
