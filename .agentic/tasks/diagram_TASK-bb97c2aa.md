# TASK-bb97c2aa diagrams

Illustrates `## Design` in `TASK-bb97c2aa.md`. The Design text is authoritative.

## Structure

Map: test-planner body/template and rubric host added; analysis-skills metadata changed;
SkillCatalog, SessionService and catalog builder reused unchanged.

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    classDef removed stroke-dasharray:4 3
    plugin["analysis-skills metadata"]:::changed ==> skill["test-planner SKILL.md and template"]:::added
    skill ==> catalog["SkillCatalog"]
    plugin --> builder["catalog builder"]
    host["test-planner rubric host"]:::added ==> session["SessionService"]
    session --> catalog
```

## Sequence

```mermaid
sequenceDiagram
    participant Host as isolated rubric host
    participant Session as SessionService
    participant Model as configured real model
    participant Tools as existing tools
    Host->>Session: fictional workbench and explicit session model
    Session->>Model: prompt and plugin skill index
    Model->>Tools: load skill/template, search and inspect sources
    Tools-->>Model: exact source references
    Model->>Tools: preparation todo and artifact_save
    Tools-->>Session: persisted artifact and events
    Session-->>Host: original output for manual rubric
```

## State

Not drawn: this adds no runtime lifecycle or state transitions; readiness is existing Markdown output.
