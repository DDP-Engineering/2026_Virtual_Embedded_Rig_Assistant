# Headless CLI host contracts

## Behavior and interface

`npm run vera -- run --workbench <dir> --prompt <text> [--session <id>] [--provider replay --script <file> | --provider openai --model <id> | --provider custom --base-url <url> --model <id>] [--format jsonl|pretty] [--data <dir>] [--key-file <file>]`.
Provider defaults to openai; it requires an explicit model. Format defaults to jsonl. Prompt is required and non-whitespace. All flags are strict, single occurrence; positional leftovers and incompatible provider flags are usage errors. `help`, `--help`, `-h` print usage and0. Shared schemas validate model reference, session ID and custom endpoint/budgets. Custom defaults use shared config defaults32768/4096; CLI adds no budget/deadline switches.
Replay is an explicit headless provider through the existing core/replay export. The selected file is validated and isolated in owned temporary script storage, so unrelated sibling scripts are not loaded. `prompt` metadata remains optional because command prompt is explicit. Host-owned script path resolves from process cwd. Desktop release test switches remain unchanged.
JSONL writes `{sessionId,seq?,event}` records (shared SessionEvent) to stdout; live-only events omit seq. Operational errors before a session use `{event:{type:"error",code,messageKey,retryable:false,params?}}` on stderr. Pretty writes one escaped line with sessionId/type and JSON event details. Embedded newlines are escaped. Console log lines on stderr are structured `{level,message,data?}`. Session content follows the live agent choice through typed projection; stderr and usage errors always scrub. stdout contains event records only.
Session resume obtains the current persisted sequence before subscription, prints only the new invocation events and uses the explicit invocation model; the verbatim historical transcript stays in SQLite. A new session subscribes from0 so creation metadata is visible. End returns0; error/aborted/limit returns1; usage returns2.
Credentials: register ambient key before parsing; key-file plain UTF8 text is trimmed and overrides ambient for authentication; both values remain registered for redaction. Credential mutation serializes and honors optional AbortSignal. Credential storage remains process-local. Session content follows agent while saved artifacts follow exports; explicit off permits literal stored-secret content. Settings and operational diagnostics retain unconditional protection. SIGINT/SIGTERM abort/drain the active session, dispose workers, close workbench/lock/settings and remove only owned temporary data/scripts. Supplied data remains intact. Startup and cleanup errors report scrubbed structured errors with exit1.

The repository npm configuration suppresses run-script banners so the public npm command preserves JSONL and never reflects raw arguments. Explicit replay records decode JSON escapes, then their canonical JSON serialization is staged before session-owned projection after interpolation.

Replay and real gateways share SessionService live agent masking after interpolation. Session output preserves protocol identities; raw tool-call arguments remain execution authority while stored messages/events are projected. Split-secret prefix holding applies when on; errors and connection tests always scrub. Artifacts follow the independent live exports choice. Previously saved redaction cannot be recovered by changing the choice.

## Acceptance and evidence

Real processes exercise both formats, demo read/list/citation, session resume, strict usage, reflected fictional keys in streams/failures/logging, temporary cleanup and signals. Long first-turn scripts include several bounded read results that exceed whole-request budget and need transient reduction. Loopback endpoint records received requests; irreducible prompt returns CONTEXT_LIMIT with zero dispatch. Pathological grep takes the production10000ms deadline and a later grep in the same invocation/pool succeeds. No injected deadline or fallback main-thread matching is accepted for CLI proof.

## Assumptions

The command is one M1 read-tool turn; future index/search/write/interactive commands are outside scope. Current schemas and core default policies define host behavior. Demo board.txt supplies the source referenced by the existing read-then-answer fixture.
