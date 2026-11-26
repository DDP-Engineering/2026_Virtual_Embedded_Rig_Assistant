# Confined file tools, prepared changes and worker hosts

## Routing

Select for PathGuard, binary detection, read/view_image/list/glob/grep/parse_log/decode_register/write/edit, prepared changes, shared write admission/recovery, line refs, ToolRegistry, tools.disabled, last-read fingerprints and WorkerPool deadline/abort/replacement. Start at core/src/tools/registry.ts and workbench/path-guard.ts under05_Software. Focused tests: tools/{read,discovery,grep,registry,binary}.test.ts,workbench/path-guard.test.ts,workers/node-host.test.ts,shared/refs.test.ts. [Agent runtime](agent-runtime.md) owns orchestration/schema projection; [Workbench](workbench.md) owns lifecycle/ignore rules; [sessions](sessions.md) owns active-turn Stop, per-session contexts and exact permission modes/approvals.

## Purpose and boundaries

Core supplies context-bound tool definitions, canonical confinement, ignored discovery, streaming text reads and prepared atomic file changes. NodeWorkerPool hosts isolated grep and parse_log tasks through the WorkerPool port; desktop/CLI adapters choose independently compiled entrypoints. Shared owns pure line reference parsing/formatting. Callers own session contexts and host disposal. WorkbenchService owns the shared WriteQueue; sessions supply identities, ownership/permission checks and change-event persistence. Changes reuse the SQLite schema1 table.

## Public interface

- Internal readWindow snapshots include physical size, exact stat date and a dev/ino/size/mtimeMs/ctimeMs
  revision for compact verified document sources. read tool output keeps its existing bounded text,
  line counts, SHA fingerprint and refs; it does not expose the host revision. workbench/read-bytes.ts
  returns the same revision privately for the Display host to verify before disclosing citation windows.
  [Document viewer](document-viewer.md) owns the sealed transport and original newline metadata.

- Host-only `ToolContext.additionalFolders()` supplies current `additional_folders` to ordinary read/list/glob/grep/write/edit and run_command cwd. Other toolPathGuard consumers remain confined outside Bypass. Relative tool paths keep primary workbench meaning; additional-folder paths are absolute, canonical and share fingerprint identity across aliases. Outside sources never acquire workbench line/document refs; edits retain absolute change records. Lexical and canonical paths must stay within the same granted root, primary-root ignores remain authoritative under nested grants, and protected application-data exclusions precede I/O in every mode. Guards capture live grant state and recheck after asynchronous reads/discovery, before publication/apply/spawn; grep workers receive captured lexical/canonical root bindings and the captured guard scope, reject root retargeting at initialization, and the host discards results after authority changes. Removing a folder refuses pending file/command requests. Native General Save/Cancel/restart/masking and actual Ask read/command acceptance are in tests/e2e/additional-folders.spec.ts; tools/additional-folders.test.ts and workbench/path-guard.test.ts cover worker revocation, aliases, missing descendants and nested roots.

- decode_register is a shared-scope read tool running in the main process with no device access or workers. A<=1MiB UTF8 JSON definition uses schemaVersion1,512registers maximum,8/16/32/64bit widths,64 nonoverlapping fields per register and bounded descriptions/enums/source line refs. Linear depth/key/array preflight before yaml uniqueKeys plus JSON grammar validation refuse duplicate keys and non-JSON content. Exact captured unsigned string arithmetic uses BigInt; results preserve every field in lsb order, nullable enum labels, register-width padded lowercase hex, decimal strings and unmapped masks/setbits without inferred faults. Every field carries the whole-definition ref, null for an outside source; outside source paths are canonical absolute paths. Exact byte SHA and a whole-definition line ref accompany the selected register sourceRefs (else device refs). Results above32000characters fail explicitly rather than losing fields. Device mismatch and source identity/stat/expected SHA changes are CONFLICT; invalid definitions/arguments/register/overflow are INVALID; paths remain guarded in Bypass. Stable reasons live in shared/core decode-register schemas/loader/decoder and focused tests.

- parse_log follows shared tool scope, with outside absolute inputs in Bypass only: strict path/profile-or-pattern arguments, ESP-IDF/Zephyr/ISO profiles, ANSI removal, normalized levels and complete scanned counts independent of event filters. Source SHA256 hashes exact UTF8 LF/CRLF/BOM bytes; workbench events/samples carry verified line refs; outside sources carry canonical absolute paths and null local refs. Limits are50MiB per file,16KiB per line,256 characters per message/optional capture/sample,5 samples,200 events and32000 serialized characters. Preview omitted/truncated fields describe bounded eligible events. Optional expectedSha256 is verified before regex evaluation; BOM-only logs have zero lines and a null source ref while hashing all3bytes. Stable errors distinguish INVALID/NOT_FOUND/DENIED/CONFLICT, including source_changed for changed identity/stats or expected SHA mismatch.
- WorkerPool tasks have kind grep|parse_log and unknown partial callbacks. The independently bundled grep-worker dispatches parse_log to its worker-only scanner. Initialization and every1000 complete lines publish checkpoints; timeout retains the last checkpoint with null SHA and incomplete/timeout scan. CLI and desktop pass the application Worker deadline (default 10 s, REQ-FUNC-5eacaf9f) as a getter the pool reads as each task starts, so a running task keeps its deadline; absolute admission/execution deadlines, termination-before-resolution, abort and capacity replacement. No main-thread fallback exists.

The registry also exposes web_download as a prepared write operation with its own narrow binary store; it does not widen write/edit text formats or their .vera restrictions. ChangeRequest distinguishes a download approval (unknown final SHA, explicit source/budget) from text-file hashes/diffs. See [PDF downloads](pdf-downloads.md).

- apply_candidate {run} is a write-class tool (FileChangeRequest tool `apply_candidate`) that writes a kicad-layout
  candidate over its source board. It is offered only when the session host sets `applyCandidate` (the desktop
  does while the official kicad-layout plugin is loaded, `officialLayoutPlugin`), never in read-only mode. Prepare
  reads `<run>/state.json` (kind kicad-layout-state, format 1) through the shared tool guard and refuses unless
  edits >= 1, objectives pass, the candidate is a `.kicad_pcb` KiCad board (text, <= 64 MiB) inside the run folder
  with its recorded hash, the target is a writable, unprotected `.kicad_pcb` allowed by the current tool scope with the recorded
  base hash, and KiCad's lock file `~<name>.kicad_pcb.lck` is absent. The approval carries both hashes and a
  unified diff cut to 2000 lines (`maxEditLength` 20000). Apply is `commitChange` with an extra check run with
  every target recheck: the candidate still has the approved hash and no lock file appeared. See spec
  REQ-DATA-891d5b5d §10.
- electrical_model_change prepares the canonical bytes of the workbench's electrical model and applies them with
  `commitChange`; [Electrical project model](electrical-model.md) owns its validation and operations.
- `commitChange(options)` is the apply body shared by write/edit, apply_candidate and electrical_model_change: inside the write queue it
  rechecks the target (path identity, agent-writable, before hash, the caller's `check`) before mkdir, after it
  and before the rename, records the pending/applied change row and refreshes the fingerprint.


- Registry includes read-class web_search/web_read over injected WebProvider. [Web search](web-search.md) owns the anonymous Exa adapter, bounded source extraction and errors; file-tool confinement remains unchanged.

- Bypass is a host-selected filesystem scope on read/list/glob/grep/write/edit, parse_log/decode_register, plugin draft inputs, candidate sources and HIL/resource/electrical inputs. ToolContext supplies live permissionMode, host-owned managedRoots/pluginBuilder exclusions and a revocable bypassSignal; model args cannot choose scope. PathGuard defaults to the existing confined policy, while filesystem scope accepts canonical absolute/parent paths and ignored locations, rejecting device/stream/special-file syntax. Grep receives scope as host task metadata and remains worker-isolated. External text results expose paths without inventing confined refs; indexed document/citation viewers remain workbench-scoped. OS rights, enabled tools, text/binary/output limits, fingerprints and write integrity still apply.

- Shared builtinToolNames is the canonical ordered built-in execution catalog, with a BuiltinToolName type. ToolRegistry maps its existing definitions through those names; the workbench editor uses the same catalog with localized descriptions and enabled checkboxes. Registry parity tests enforce correspondence. WorkbenchService also uses built-ins for default disabled-name validation. Injected registries/catalogs retain their existing behavior.

- Registry includes read-class load_skill {name,file?} through a separately
  authorized optional SkillCatalog context; [Skills](skills.md) owns validation,
  root selection and bounded body/extra loading. Existing result limits apply.

- Registry includes read-class search_docs/read_doc, bound through a workbench DocumentKnowledge context. [Document search](document-search.md) owns validated schemas, guarded full extraction and bounded precise refs.

- ToolContext carries absolute root, optional WorkerPool, per-session lastReads Map and optional ChangeHost (SQLite, shared queue, session/turn/call identity, ownership check and transactional recorded-event callback). Product ToolDefinition execute(ctx,args,signal) returns JSON; ToolRegistry.bind supplies established runtime ToolDef execute(args,signal), propagating error outcomes through runtime's error-result handling.
- Registry.available/specs/bind/execute apply disabled names, validate zod args, use toolSpecs JSON projection and cap valid JSON at the session's Tool result size (`toolLimit(ctx, "toolResultChars")`, default 32000, REQ-FUNC-f6f79cd2) with truncated. `ToolContext.advanced(key)` is the session's resolved Advanced value, set each turn by the session service; `toolLimit` falls back to the registry default where no session resolves one (ADV-03). grep returns up to the Grep results setting (default 500, schema max 2000; the setting is both default and ceiling) and skips files above the Grep file size (default 5 MiB, sent as `WorkerTask.maxFileBytes` because the worker re-parses strict args); glob returns up to the Glob results setting (default 500, examined 5000). Failures have isError and actionable text; malformed serialized outputs are contained.
- `tools/files.ts` supplies the bounded guarded file read used for session images, grep and document inspection. It checks the ordinary-file identity before reading and revalidates the path before releasing bytes. `FileReadLimitError` lets callers map the limit to their typed response.
- The registry binds `session_launch`, `session_status`, `session_wait` and `session_stop` to the owning parent and respects disabled names. Launch keys hash runtime turn and tool call IDs. Status and wait report initial-turn progress or outcome. Wait follows the durable event sequence, defaults to 10 seconds, caps at 30 seconds and releases its listener on exit. A timeout leaves the child running. Completed replies apply the live Agent setting before the cap, which keeps registered credential strings whole for later masking. Stop cancels the initial turn. See [Sessions](sessions.md).
- A delegated context binds canonical inspection, write/edit and command/program tools under the session's live permission mode and the host's enabled catalog. Prepared mutations use the regular exact approval path. A delegated shell command in Bypass is approved by mode like a direct one; in Auto-edit it needs a saved workbench prefix. Children do not inherit additional-folder grants; Bypass remains revocable and excludes protected roots. Nested delegation, alternate tool definitions and other persistent or external tools are unavailable. Proof: sessions/delegation.test.ts and programs.test.ts.
- PathGuard.create(root)/resolve(relative) return absolute/canonical relative/key. Root is realpath; Windows keys and ignore-metadata identity fold case. Deepest existing ancestors support new paths. Guard applies common ignore policy to lexical and canonical targets and refuses redirected ignore metadata. Its optional host-only excludedRoots reject lexical/canonical application-data descendants in either scope, including absent descendants resolved through existing ancestors and Windows case/junction aliases. toolPathGuard and grep worker metadata carry the host roots; parse_log/decode_register/plugin drafts, candidate inputs, electrical helpers and program/HIL inputs receive the same host mode-aware scope and exclusions. Guard admission captures its original Bypass epoch before awaits; isolated workers terminate on its abort. ApplicationDataAccessError preserves the refusal across program argument binding. PathGuard.assertAuthorized synchronously rechecks current host authority immediately before spawn or another side effect. PathGuard.assertNotExcluded checks lexical/canonical exclusions without granting filesystem scope or outside binding, so absolute application-data arguments cannot take the unbound fallback. Agent document adapters pass exclusions into the still-confined knowledge read/search guards. Candidate apply and program spawn/file checks reapply host exclusions. Internal host storage callers omit agent exclusions.
- read accepts offset>=1 and limit<=10000, capped by the session's Read window lines (default 2000, also the count when none is given, REQ-FUNC-150dcb0b), numbers selected lines, returns totalLines/truncated/ref and records full-file SHA256/mtime only after stable successful read. File and artifact pages return nextOffset from delivered lines and mark a partial first line with lineClipped. Text is bounded by the session's Read output size (default 30000 characters, REQ-FUNC-f041ba07; `readWindow` option `maxChars`, source window max(256 KiB, 4 x size)); citations and the viewer keep the defaults; complete metadata scans in64KiB chunks so large files support offsets past256KiB. PDFs direct to read_doc; binaries fail.
- list defaults root/depth1 with depths1..3 and name/type/bytes entries; glob uses tinyglobby, relative base, newest-mtime order and500-path cap. Discovery omits links and ignored entries.
- Search base paths must exist, and list requires a directory. Glob and grep apply their glob to an explicitly selected file's workbench-relative path or its name for an outside file. Disappearing child entries are skipped; list checks Stop while reading directory batches, glob passes the signal to the crawler, and grep cancellation terminates its worker.
- grep options follow architecture03§4; discovery/read/JS regex are worker-only, binary/>5MiB skipped. Content partials carry bounded previews (16000 match characters and2000 per emitted context line), marking clipped content truncated while searching subsequent files. Files/count omit unused previews; their truncation reflects search ceilings or timeout. Result ceilings end matching immediately. Timeout returns received partials/truncated/reason timeout; abort returns a tool error.
- NodeWorkerPool defaults capacity2/deadline10000ms; the deadline starts when a task gets its worker, so a queued task is never timed out unrun, one worker/task, dispose aborts pending/active tasks. Termination precedes terminal resolution and capacity replacement. Tests inject shorter host deadlines.

- Registry includes sequential session-class todo with bounded shared list schema and an optional TodoHost; [Plan](plan.md) owns atomic SQLite replacement/events.
- Registry includes sequential session-class artifact_save over its optional ArtifactHost, with no write approval; [Artifacts](artifacts.md) owns its managed storage and limits.
- Registry includes sequential write/edit; prepare validates the schema and returns a one-use PreparedChange with frozen metadata/private output bytes. write returns path/bytes/created and creates parents; overwrite requires a fresh read or returns "Read the file before overwriting it." edit requires a fresh file/version and one literal nonempty oldString match unless replaceAll, returning replacements/added/removed. Binary source is refused.
- Preparation captures before/after SHA256 and one structured unified patch/counts. Identical bytes return unchanged without approval, a write, or a change record. The diff calculation has a 100 ms search budget and an edit-distance limit. If either is exhausted, the change remains available for approval with its preview marked unavailable. edit converts LF arguments for CRLF sources and preserves BOM. Ordinary reads validate UTF8 across the complete stream and use a bounded Latin-1 replay of the same file revision when legacy bytes occur. Outside Bypass, read, grep, parse_log and verified line citations opt in to ordinary run logs without links. Mutating tools deny runtime metadata under .vera. Application saves and the dedicated skill catalog use their own bounded admission.
- Application enters the shared queue after permission waits. It rechecks confinement/identity/expected hash/authority/abort on admission and before rename; conflicts require a new read, preserving prepared output. Pending SQL precedes exclusive same-folder temp/fsync/rename. Existing POSIX permission bits are copied to the temporary file before fsync; new files start0600. Applied status and the caller's event record share a transaction; publication follows commit, and successful changes refresh the session fingerprint. Stop preserves completed renames.
- If recording fails after rename, the file tool reports success with `historyPending:true`. recoverChanges resolves pending rows by guarded current hash: after marks applied and records the recovered event, before removes the row, otherwise conflict. It never changes file bytes. Session hosts await waitReady before exposing recovered state.
- Bypass prepared requests mark filesystem scope and record canonical absolute change paths, including internal metadata changes. Recovery reconciles those recorded targets by hash only. Scope signal, current-mode guard and grant checks revoke queued writes/in-flight reads or grep on downgrade.

- `ask_user` is a session-class tool bound only when its desktop host can answer. Its result reports clarification data and source. The regular write and program approvals still use their own gate.

## Agent management boundary

Write/edit preparation and every apply recheck refuse `.vera/workbench.yaml` and host-managed
application-data roots, including the installed plugin store and runtime. This applies in bypass too.
Multiply linked file write targets are refused so a hard-link alias cannot modify installed bytes.
Drafts under ordinary workbench `plugins/<id>/` retain normal write approvals. `ToolContext` carries
`pluginBuilder` and `managedRoots`; desktop and CLI compose them, never model arguments.
`plugin_validate` is read-class and `plugin_install` is program-class, both strict path-only tools;
SessionService offers them only with a builder store. The install requires its prepared gate approval.

Agent write/edit protects `.vera/plugins` package sources as user-managed installed files, including
in Bypass and through canonical aliases, alongside application managed roots and workbench.yaml.
Draft authoring elsewhere retains normal approval policy (tools/write-edit.test.ts).

## Invariants

- Outside explicitly selected Bypass, model-selected paths stay within granted canonical roots. Absolute paths inside the workbench resolve to its relative spelling. Foreign drive, UNC, device, NUL and ignored paths are refused. POSIX names with colons, Windows device spellings or trailing dots remain ordinary files on that host. Windows rejects its reserved aliases and folds case for canonical fingerprints. Program argument preparation separately retains the portable device-name and trailing-dot or space restrictions. Bypass accepts ordinary filesystem paths with OS rights and retains canonical fingerprint identity.
- Worker sources are host-selected. Host timers and AbortSignal terminate stalled regex; matching has no main-thread fallback. Each terminal path cleans up listeners/timers and releases capacity after termination.
- Worker crashes, premature exits and startup failures return actionable retry errors and release capacity. Compiled desktop/CLI failure fixtures restore the real entry and verify subsequent matching through the same capacity-one pool; constructor rejection is covered independently.
- Source files are data; file tools expose confined writes through the host permission boundary and no shell/network capability. Desktop sandbox/CSP and vera://app origin remain enforced; instrumented probe is compiled out of release.
- Fingerprints belong to each session Map; read stats and canonical/inode checks reject mutation before retaining a fingerprint. A terminal newline terminates the last line; empty files have0 lines and no locator.

## Change map

| Change | Start | Focused verification |
|---|---|---|
| Confinement/ignore/binary | PathGuard,isBinary | path-guard/binary tests, native Windows aliases |
| Read/fingerprint/line semantics | readTool,readWindow,refs | read/shared refs tests |
| Agent image inspection | tools/view-image.ts, tools/raster-file.ts, PathGuard | sessions/view-image.test.ts |
| Ignored sorted discovery | discoverFiles,listTool,globTool | discovery tests |
| Regex/options/worker protocol | grepTool,grep-worker.ts | grep/node-host tests |
| Captured register definitions/decoding/citations | shared/tools/decode-register.ts; tools/decode-register.ts,decode-register/{definition,decode}.ts; agent/citations.ts | decode-register.test.ts; citation tests; real CLI parity; native workbench-tools |
| Captured log contracts/scanning/citations | shared/tools/parse-log.ts; tools/parse-log.ts,parse-log-worker.ts,log-failure.ts | parse-log.test.ts; CLI parity; native file-tools |
| Host deadlines/abort/capacity | NodeWorkerPool,app adapters | node-host/worker-hosts/native file-tools acceptance |
| Prepared writes/diff/recovery | tools/changes.ts,write.ts,edit.ts | tools/write-edit.test.ts,sessions/write-edit.test.ts,native write-edit acceptance |
| Applying kicad-layout candidates | tools/apply-candidate.ts, changes.ts commitChange, sessions/service.ts host flag, desktop main/sessions.ts gate | tools/apply-candidate.test.ts, sessions/apply-candidate.test.ts |
| Shared app/session queue | workbench/write-queue.ts,service.ts | workbench/service.test.ts,desktop sessions startup recovery |
| Schema/filter/errors/output cap | ToolRegistry,capToolResult | registry tests and runtime regression |
| Bypass filesystem scope and revocation | context.ts, PathGuard, worker task scope, changes.ts | sessions/bypass.test.ts, tests/e2e/bypass.spec.ts |

## Key behaviors

- The ordinary path guard applies permanent ignore rules. Composer and message image reads opt into the narrow `.vera/attachments/<session>/` namespace and refuse redirected paths into or out of it.

- REQ-DATA-ff592d7b — captured register decoding contract; see specs/decode-register.md.
- REQ-FUNC-41a37137 — captured register decoding contract; see specs/decode-register.md.
- REQ-FUNC-636e8efe — captured register decoding contract; see specs/decode-register.md.
- REQ-FUNC-9d746ce0 — captured register decoding contract; see specs/decode-register.md.
- REQ-FUNC-b33148a5 — captured register decoding contract; see specs/decode-register.md.
- REQ-FUNC-e2659125 — captured register decoding contract; see specs/decode-register.md.
- REQ-REL-eb597740 — captured register decoding contract; see specs/decode-register.md.
- REQ-SEC-57d4df1d — captured register decoding contract; see specs/decode-register.md.
- REQ-SEC-b86a7502 — captured register decoding contract; see specs/decode-register.md.
- REQ-UX-c3aceaf8 — captured register decoding contract; see specs/decode-register.md.

- `view_image {path}` reads an ordinary primary-workbench raster through the shared file guard and IMG-02 transform (PNG, JPEG, GIF, WebP; 20 MiB; longest side 2048 px). Relative paths honor ignore rules and protected application roots, and symbolic links and junctions are refused even in Bypass. The tool can reopen managed attachment paths found in the current session's durable user messages after delivery (REQ-FUNC-19936eec, REQ-SEC-1d25462f, REQ-FUNC-33cb0bb1).
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
- REQ-UX-0f1a32c4 — Share built-in names with the described workbench checkbox catalog.
- REQ-FUNC-37261edc — Use saved checkbox exclusions when exposing runtime tools.
- REQ-FUNC-a7ad5920 — Explicit Bypass filesystem execution, exact grants and revocation.
- REQ-FUNC-73151724 — Format and parse line references.
- REQ-FUNC-73b4e5d0 / REQ-SEC-c986d8f2 / REQ-SEC-854495d1 / REQ-SEC-c445ab5c / REQ-SEC-e27836d3 / REQ-SEC-8483534b / REQ-FUNC-3f443814 — apply_candidate: write flow, read-only, decline, conflicts, KiCad lock file, refusals, official-plugin gate.

REQ-FUNC-9aa789af create; REQ-DATA-8c71b990 freshness; REQ-FUNC-d5b5be90 exact replacement/counts; REQ-DATA-cf979c63 CRLF/BOM; REQ-REL-d2437b70 shared immutable admission; REQ-DATA-f44069c2 atomic recording; REQ-DATA-60e025f4 event/fingerprint; REQ-REL-50217071 recovery; REQ-SEC-294dcab2 sequential write classification and internal metadata denial.

The host controls lifetime; the worker owns all grep discovery/read/matching and captured-log scanning. The registry adapts these tools to the runtime without importing an app.

## Files

- shared/src/tools/decode-register.ts; core/src/tools/decode-register.ts and decode-register/{definition,decode}.ts; tools/decode-register.test.ts; agent/citations.ts/test; CLI parity and native workbench-tools acceptance.

- shared/src/tools.ts — canonical built-in names and type; renderer components/workbench-tools.tsx presents localized selection. tools/registry.test.ts verifies runtime parity; renderer workbench-tools.test.ts and tests/e2e/workbench-tools.spec.ts cover selection/save/permissions.

core/src/tools/apply-candidate.ts and its test; sessions/apply-candidate.test.ts.

Under05_Software: core/src/tools/{parse-log,parse-log-worker,log-failure,changes,write,edit,context,registry,read,read-window,files,binary,discovery,list,glob,grep,grep-worker}.ts and corresponding tests; core/src/workbench/path-guard.ts/test; core/src/workers/{node-host,worker.test-support}.ts and node-host.test.ts; core/src/{ports,index}.ts. shared/src/refs.ts/test/index.ts. src/apps/{cli/src,desktop/src/main}/{worker-pool,grep-worker}.ts; desktop/main/file-tool-probe.ts/index.ts and electron.vite.config.ts. tests/integration/worker-hosts.test.ts and tests/tooling/build-mode.test.ts and tests/e2e/file-tools.spec.ts. WriteQueue is core/src/workbench/write-queue.ts; write/edit tests and tests/fixtures/llm-scripts/read-then-edit.jsonl/tests/e2e/write-edit.spec.ts prove changes. diff9.0.0 is pinned in root/core package manifests and lockfile.
