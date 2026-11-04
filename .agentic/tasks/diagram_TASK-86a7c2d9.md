# TASK-86a7c2d9 diagrams

Illustrates Design in TASK-86a7c2d9.md; Design is authoritative.

## Structure

Map: analysis-skills added; official catalog changed; rubric harness added; CredentialFile and chatgpt-catalog changed by the two immediate-consumer repairs; PluginStore, SkillCatalog, SessionService and artifact store reused unchanged.

```mermaid
flowchart LR
  classDef added fill:#e1f5ee,stroke:#0f6e56
  classDef changed fill:#faeeda,stroke:#854f0b
  classDef removed stroke-dasharray:4 3
  package["analysis-skills"]:::added ==> catalog["official catalog"]:::changed
  package ==> store["PluginStore"]
  store --> skills["SkillCatalog"]
  harness["rubric harness"]:::added ==> session["SessionService"]
  harness ==> credentials["CredentialFile public-scope registration"]:::changed
  harness ==> gateway["chatgpt-catalog optional tool parameters"]:::changed
  skills --> session
  session --> artifacts["artifact store"]
```

## Sequence

```mermaid
sequenceDiagram
  participant Harness
  participant PluginStore
  participant SessionService
  participant Gateway
  Harness->>PluginStore: install fictional skill package
  Harness->>SessionService: isolated workbench and prompt
  SessionService->>Gateway: real model with plugin skill metadata
  Gateway-->>SessionService: tool calls
  SessionService-->>Gateway: inspected fixture evidence
  Gateway-->>SessionService: report and artifact_save
  SessionService-->>Harness: durable events and artifact
```

## State

Not drawn: no product lifecycle or state transition changes.
