# Session workspace contract

Status: active. Requirements: REQ-UX-4bea0001, REQ-UX-4bea0002, REQ-UX-4bea0003, REQ-REL-4bea0004, REQ-UX-4bea0005, REQ-REL-4bea0006, REQ-UX-4bea0007, REQ-TEST-4bea0008.

Accepted behavior: 00_Planning/plan/M1-read-only-agent.md WP14;06-ui sections1,3,6,7,8;03-agent-and-tools sections8,9;01-system section3.

Navigation stays memory-only at the authorized production URL. Workbench Welcome remains mounted across Settings/session navigation. Active workbench config and optional folder/readOnly metadata are queried on renderer startup; opening a workbench notifies the workspace. Session selection is stored per workbench in renderer localStorage, validated against session.list; missing/stale selections fall back to the first session. This UI record contains IDs only.

Each session view starts from session.get {snapshot,seq}, then one tokenized session subscription from seq. Cancellation guards prevent late snapshots/events from replacing another session. The shared reducer handles durable projection and final message replacement. Renderer-only reasoning and tool updates are transient, cleared on session changes; full durable text is displayed after request reduction. No renderer native imports or persistence.

Session list: New, title selection, rename form (1..60 chars), modal confirmed delete, status text idle/running/awaiting approval/error. Read-only disables mutations. Workbench switch opens existing lifecycle API; errors shown locally. Session mutations refresh list; turn/update events refresh statuses. Ctrl+N creates a session; Ctrl+F focuses transcript search; Escape confirms Stop while a turn runs.

Composer: Enter sends nonblank text unless IME composition or Shift. Shift+Enter newline. During active turns text/Enter/Send stay available alongside Stop; approval waits disable text/sending. Model selection remains disabled during active/approval turns. Queued user messages display a localized pending marker until durable delivery. Workbench read-only and pending operations disable sending. Send rejection preserves draft. @ completion uses the caret-local final @ token, bounded workbench.files query; ArrowUp/Down selects, Enter/Tab inserts plain text, Escape closes, pointer choices work. Async results are generation/caret guarded. Providers.list configured metadata drives providers.models; instrumented replay may supply its catalog, absent in release. Model mutation confirms response and preserves previous choice on failure.

Markdown uses react-markdown/GFM/highlight without raw HTML, image loading or uncontrolled navigation. External links use explicit UI confirmation then app.openExternal where available; the current bridge has no openExternal channel, so links render inert readable text in M1. Citation AST replacement applies to text nodes, not code; validity requires message.done evidence, otherwise warning. Chip activation presents the reference and explains future viewer availability; invalid chips cannot open content. No WP28 viewer.

Context: current .vera/WORKBENCH.md preview through API, empty available skills until WP29. Other tabs are placeholders. Footer shows input/output provider counts, context/window/input budget/reserved output/safety with estimates labelled. CONTEXT_LIMIT guidance reduces prompt or changes custom model window. Error Retry re-sends latest user instruction when idle; full history remains.

Mock fixtures are seeded through the same in-memory bridge and selectable from the browser workspace. Native replay fixtures include slow response and pathological/normal grep, composed through real SessionService and worker host. Stop/reload/restart tests observe UI and backend terminal state. en/ro/de catalogs contain every label.

No new native access, sandbox/protocol/CSP/test-seam/egress/redaction changes. Dependency versions pinned; browser DOM component harness runs in Vitest. Unknown decisions: none.
