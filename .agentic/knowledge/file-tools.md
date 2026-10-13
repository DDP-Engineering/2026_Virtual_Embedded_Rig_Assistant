# Confined file tools, prepared changes and worker hosts

## Routing

Select for PathGuard, binary detection, read/list/glob/grep/write/edit, prepared changes, shared write admission/recovery, line refs, ToolRegistry, tools.disabled, last-read fingerprints and WorkerPool deadline/abort/replacement. Start at core/src/tools/registry.ts and workbench/path-guard.ts under05_Software. Focused tests: tools/{read,discovery,grep,registry,binary}.test.ts,workbench/path-guard.test.ts,workers/node-host.test.ts,shared/refs.test.ts. [Agent runtime](agent-runtime.md) owns orchestration/schema projection; [Workbench](workbench.md) owns lifecycle/ignore rules; [sessions](sessions.md) owns active-turn Stop, per-session contexts and exact permission modes/approvals.

## Purpose and boundaries

Core supplies context-bound tool definitions, canonical confinement, ignored discovery, streaming text reads and prepared atomic file changes. NodeWorkerPool hosts isolated grep tasks through the WorkerPool port; desktop/CLI adapters choose independently compiled entrypoints. Shared owns pure line reference parsing/formatting. Callers own session contexts and host disposal. WorkbenchService owns the shared WriteQueue; sessions supply identities, ownership/permission checks and change-event persistence. Changes reuse the SQLite schema1 table.

## Public interface

- Registry includes read-class load_skill {name,file?} through a separately
  authorized optional SkillCatalog context; [Skills](skills.md) owns validation,
  root selection and bounded body/extra loading. Existing result limits apply.

- Registry includes read-class search_docs/read_doc, bound through a workbench DocumentKnowledge context. [Document search](document-search.md) owns validated schemas, guarded full extraction and bounded precise refs.

- ToolContext carries absolute root, optional WorkerPool, per-session lastReads Map and optional ChangeHost (SQLite, shared queue, session/turn/call identity, ownership check and transactional recorded-event callback). Product ToolDefinition execute(ctx,args,signal) returns JSON; ToolRegistry.bind supplies established runtime ToolDef execute(args,signal), propagating error outcomes through runtime's error-result handling.
- Registry.available/specs/bind/execute apply disabled names, validate zod args, use toolSpecs JSON projection and cap valid JSON at32000 characters with truncated. Failures have isError and actionable text; malformed serialized outputs are contained.
- PathGuard.create(root)/resolve(relative) return absolute/canonical relative/key. Root is realpath; Windows keys and ignore-metadata identity fold case. Deepest existing ancestors support new paths. Guard applies common ignore policy to lexical and canonical targets and refuses redirected ignore metadata.
- read accepts offset>=1 and limit<=2000, numbers selected lines, returns totalLines/truncated/ref and records full-file SHA256/mtime only after stable successful read. Source retention is bounded256KiB, preview30000 characters; complete metadata scans in64KiB chunks so large files support offsets past256KiB. PDFs direct to read_doc; binaries fail.
- list defaults root/depth1 with depths1..3 and name/type/bytes entries; glob uses tinyglobby, relative base, newest-mtime order and500-path cap. Discovery omits links and ignored entries.
- grep options follow architecture03§4; discovery/read/JS regex are worker-only, binary/>5MiB skipped. Content partials carry bounded previews (16000 match characters and2000 per emitted context line), marking clipped content truncated while searching subsequent files. Files/count omit unused previews; their truncation reflects search ceilings or timeout. Result ceilings end matching immediately. Timeout returns received partials/truncated/reason timeout; abort returns a tool error.
- NodeWorkerPool defaults capacity2/deadline10000ms; admission deadline includes queue time, one worker/task, dispose aborts pending/active tasks. Termination precedes terminal resolution and capacity replacement. Tests inject shorter host deadlines.

- Registry includes sequential session-class todo with bounded shared list schema and an optional TodoHost; [Plan](plan.md) owns atomic SQLite replacement/events.
- Registry includes sequential session-class artifact_save over its optional ArtifactHost, with no write approval; [Artifacts](artifacts.md) owns its managed storage and limits.
- Registry includes sequential write/edit; prepare validates the schema and returns a one-use PreparedChange with frozen metadata/private output bytes. write returns path/bytes/created and creates parents; overwrite requires a fresh read or returns "Read the file before overwriting it." edit requires a fresh file/version and one literal nonempty oldString match unless replaceAll, returning replacements/added/removed. Binary source is refused.
- Preparation captures before/after SHA256 and one structured unified patch/counts. edit converts LF arguments for CRLF sources and preserves BOM. Protected metadata uses canonical workbench.yaml/WORKBENCH.md/.veraignore/skills paths with Windows case folding.
- Application enters the shared queue after permission waits. It rechecks confinement/identity/expected hash/authority/abort on admission and before rename; conflicts require a new read, preserving prepared output. Pending SQL precedes exclusive same-folder temp/fsync/rename. Existing POSIX permission bits are copied to the temporary file before fsync; new files start0600. Applied status and the caller's event record share a transaction; publication follows commit, and successful changes refresh the session fingerprint. Stop preserves completed renames.
- recoverChanges resolves pending rows by guarded current hash: after marks applied and records the recovered event, before removes the row, otherwise conflict. It never changes file bytes. Session hosts await waitReady before exposing recovered state.

## Invariants

- Model-selected paths cannot leave root, select absolute/drive/UNC/device/reserved/NUL paths or ignored aliases. Windows native case aliases share a canonical fingerprint key.
- Worker sources are host-selected. Host timers and AbortSignal terminate stalled regex; matching has no main-thread fallback. Each terminal path cleans up listeners/timers and releases capacity after termination.
- Worker crashes, premature exits and startup failures return actionable retry errors and release capacity. Compiled desktop/CLI failure fixtures restore the real entry and verify subsequent matching through the same capacity-one pool; constructor rejection is covered independently.
- Source files are data; file tools expose confined writes through the host permission boundary and no shell/network capability. Desktop sandbox/CSP and vera://app origin remain enforced; instrumented probe is compiled out of release.
- Fingerprints belong to each session Map; read stats and canonical/inode checks reject mutation before retaining a fingerprint. A terminal newline terminates the last line; empty files have0 lines and no locator.

## Change map

| Change | Start | Focused verification |
|---|---|---|
| Confinement/ignore/binary | PathGuard,isBinary | path-guard/binary tests, native Windows aliases |
| Read/fingerprint/line semantics | readTool,readWindow,refs | read/shared refs tests |
| Ignored sorted discovery | discoverFiles,listTool,globTool | discovery tests |
| Regex/options/worker protocol | grepTool,grep-worker.ts | grep/node-host tests |
| Host deadlines/abort/capacity | NodeWorkerPool,app adapters | node-host/worker-hosts/native file-tools acceptance |
| Prepared writes/diff/recovery | tools/changes.ts,write.ts,edit.ts | tools/write-edit.test.ts,sessions/write-edit.test.ts,native write-edit acceptance |
| Shared app/session queue | workbench/write-queue.ts,service.ts | workbench/service.test.ts,desktop sessions startup recovery |
| Schema/filter/errors/output cap | ToolRegistry,capToolResult | registry tests and runtime regression |

## Key behaviors

- REQ-SEC-c370e45b — Confine tool paths.
- REQ-FUNC-f558632e — Detect binary samples.
- REQ-FUNC-091ba439 — Read numbered bounded text.
- REQ-DATA-6e0a50db — Remember session read fingerprints.
- REQ-FUNC-86bf3083 — List bounded ignored directories.
- REQ-FUNC-6be2c915 — Glob sorted confined files.
- REQ-FUNC-758d1aee — Search file content in workers.
- REQ-REL-8f53fff6 — Terminate timed out grep tasks.
- REQ-REL-df1e6461 — Abort and replace grep workers.
- REQ-PLAT-2b27ef1d — Keep desktop responsive during grep.
- REQ-FUNC-0300323e — Validate filter and cap tool registry.
- REQ-FUNC-73151724 — Format and parse line references.

REQ-FUNC-9aa789af create; REQ-DATA-8c71b990 freshness; REQ-FUNC-d5b5be90 exact replacement/counts; REQ-DATA-cf979c63 CRLF/BOM; REQ-REL-d2437b70 shared immutable admission; REQ-DATA-f44069c2 atomic recording; REQ-DATA-60e025f4 event/fingerprint; REQ-REL-50217071 recovery; REQ-SEC-294dcab2 write/protected classification.

## Architecture

```mermaid
flowchart LR
 Runtime[AgentRuntime] --> Registry[ToolRegistry.bind]
 Registry --> Context[ToolContext session fingerprint Map]
 Registry --> Guard[PathGuard + common ignore]
 Registry --> Read[readWindow streaming metadata]
 Registry --> Prepared[PreparedChange private bytes + frozen request]
 Prepared --> Permission[SessionService ApprovalGate / host policy]
 Permission --> Queue[WorkbenchService WriteQueue]
 AppSaves[config/pinned saves] --> Queue
 Queue --> Pending[changes pending]
 Pending --> Rename[temp fsync rename]
 Rename --> Applied[applied + SessionHub record transaction]
 Applied --> Event[publication + fingerprint]
 Recovery[recoverChanges guarded hashes] --> Applied
 Registry --> Pool[WorkerPool port]
 Pool --> Host[NodeWorkerPool desktop / CLI]
 Host --> Worker[grep-worker task]
 Worker --> Guard
 Worker --> Files[bounded reads + regex]
 Worker --> Partial[partial matches]
 Partial --> Host
```

The host controls lifetime; the worker owns all grep discovery/read/matching. The registry adapts these tools to the runtime without importing an app.

## Files

Under05_Software: core/src/tools/{changes,write,edit,context,registry,read,read-window,files,binary,discovery,list,glob,grep,grep-worker}.ts and corresponding tests; core/src/workbench/path-guard.ts/test; core/src/workers/{node-host,worker.test-support}.ts and node-host.test.ts; core/src/{ports,index}.ts. shared/src/refs.ts/test/index.ts. apps/{cli/src,desktop/src/main}/{worker-pool,grep-worker}.ts; desktop/main/file-tool-probe.ts/index.ts and electron.vite.config.ts. tests/tooling/{worker-hosts,build-mode}.test.ts and e2e/file-tools.spec.ts. WriteQueue is core/src/workbench/write-queue.ts; write/edit tests and fixtures/llm-scripts/read-then-edit.jsonl/e2e/write-edit.spec.ts prove changes. diff9.0.0 is pinned in root/core package manifests and lockfile.
