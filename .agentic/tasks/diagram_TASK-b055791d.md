# TASK-b055791d diagrams

Illustrates `## Design` in `TASK-b055791d.md`. The Design text is authoritative.

Node classes: added = plugin mqtt-tools, mqtt_support modules, MqttCredentialService, mqtt-credentials panel,
mqtt-env, ProgramCredentials port; changed = program-tools run_program, ProgramRunner, NodeProcessHost, plugin
manifest schema, Settings page, desktop sessions/index, CLI run; unchanged = CredentialFile, approval gate.

## Structure

```mermaid
flowchart LR
    classDef added fill:#e1f5ee,stroke:#0f6e56
    classDef changed fill:#faeeda,stroke:#854f0b
    panel["Settings: mqtt-credentials.tsx"]:::added -- "IPC mqtt.credentials.*" --> svc["MqttCredentialService"]:::added
    svc --> store[("CredentialFile mqtt:&lt;ref&gt;")]
    env["CLI mqtt-env.ts"]:::added --> port["ProgramCredentials port"]:::added
    store --> port
    manifest["plugin.yaml credentials {option, scope}"]:::changed --> tools["run_program prepare/apply"]:::changed
    port --> tools
    gate["ApprovalGate"] --> tools
    tools -- "RunRequest.input" --> runner["ProgramRunner"]:::changed
    runner -- "stdin line" --> host["NodeProcessHost"]:::changed
    host --> helper["mqtt-tool (paho-mqtt 2.1.0)"]:::added
    helper --> broker[("MQTT broker, TLS")]
    helper --> results[("arduino-iot-results/&lt;run-id&gt;")]
```

## Sequence

```mermaid
sequenceDiagram
    participant A as Agent
    participant T as run_program
    participant G as ApprovalGate
    participant C as ProgramCredentials
    participant R as Runner
    participant H as mqtt-tool
    participant B as Broker
    A->>T: request --profile --credential bench
    T->>C: has(mqtt, bench)
    T->>G: approval (argv, profile hash)
    G-->>T: approved
    T->>T: reload enabled plugins (disabled -> refused)
    T->>C: read(mqtt, bench)
    T->>R: start(args, input line)
    R->>H: spawn, write stdin, close
    H->>B: TLS handshake (CA + hostname)
    H->>B: CONNECT clean, user/password
    B-->>H: CONNACK
    H->>B: SUBSCRIBE reply topic
    H->>B: PUBLISH once (correlation)
    B-->>H: PUBACK
    B-->>H: correlated reply
    H-->>R: result JSON, exit 0
```

## State

```mermaid
stateDiagram-v2
    [*] --> notSent
    notSent --> sent: PUBLISH written
    notSent --> notSent: connect/TLS/auth failure (blocked or error)
    sent --> acknowledged: PUBACK success (QoS 1)
    sent --> refused: PUBACK reason >= 0x80
    sent --> unknown: connection lost before PUBACK
    acknowledged --> reported: correlated reply (request)
    acknowledged --> timedOut: no reply in time
    sent --> [*]: QoS 0 done
    unknown --> [*]: never resent
    reported --> [*]
    timedOut --> [*]
    refused --> [*]
```
