# TASK-71300a15 diagrams

Illustrates `## Design` in `TASK-71300a15.md`. The Design text is authoritative.

Node map: added = stm32-cubeprog package, stm32-options projection, fixtures, test; changed = plugins.ts enum,
classifyCommand dispatch, catalog/packs; unchanged = Provisioner, ApprovalGate, ProgramRunner.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    pkg["plugins/stm32-cubeprog<br/>plugin.yaml + skills"]:::added
    catalog["catalog.yaml / packs.yaml"]:::changed
    schema["shared plugins.ts<br/>optionSyntax enum"]:::changed
    rules["shared program-rules<br/>classifyCommand"]:::changed
    proj["shared stm32-options<br/>stm32RuleArguments"]:::added
    prov["Provisioner (find + hint)"]
    gate["ApprovalGate"]
    test["integration stm32-cubeprog.test"]:::added
    catalog --> pkg
    pkg --> schema
    rules --> proj
    gate --> rules
    prov --> pkg
    test --> gate
```

## Sequence

Not drawn: the existing run_program path (classify, gate, runner).

## State

Not drawn: no new lifecycle.
