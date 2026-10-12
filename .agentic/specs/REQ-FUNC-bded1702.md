# Permission modes and approval protocol

Architecture03 sections1/6/8,06 sections3/7,02 section2 and ADR0007 define modes and approvals. Schema1 stores approval lifecycle; ChangeRequest and its prepared closure own exact bytes.

Request: preserve complete frozen ChangeRequest (workbench/session/turn/call IDs, tool, canonical path, validated args, existed, beforeSha256, afterSha256, diff, bytes, protected). SHA256 covers UTF8 deterministic JSON recursively sorted object keys and unchanged arrays. Renderer receives digest, diff and byte count through requested event; Requests containing known credentials in metadata or patch are refused before approval/change persistence with a protected-credential-data tool error. Approved requests retain their exact bytes; event transport still uses the shared scrubber.

Transitions: prepare -> row pending/requested event -> wait or automatic decision -> approved/denied/aborted row+event with user/mode -> approved consumes_at before one application attempt. Pending map is installed before publication to support synchronous observers. Approved mode still rechecks immediately on each WP16 queued authority check. Waiting owns no queue position. Every decision must match stored digest/session/current turn and live pending gate; signal-aborted requests conflict. Wrong/duplicate/recovered/ended IDs change nothing. switchToAutoEdit is valid only for approved and atomically sets mode with session.updated. Denial returns exact existing runtime error and continues. Stop aborts signal and pending rows; read-only aborts waiting writes but leaves model loop available to conclude. Subsequent provider catalogs filter writes according to current mode; execution guard rechecks mode independently.

Cancellation persistence failure releases the in-memory waiter/listener through a controlled rejection. AbortSignal callbacks contain the error, allowing the runtime and close to drain; explicit mode abort surfaces the persistence failure. Unauthorized or failed durable writes leave undecided rows for writable startup recovery.

Recovery: mark each undecided approval aborted/by mode; emit decided, repair unanswered tool pairs, close both active statuses to idle through interrupted/turn.done/session.updated. Old decisions conflict. Repeat is idempotent.

Shared IPC: session.approval.decide {sessionId, approvalId apv_ULID, requestSha256 lowercase64hex, decision approved|denied, switchToAutoEdit? boolean}; empty response. Schema disallows denied+switch true. session.mode.set changes current session even during turn; read-only aborts pending writes. Workbench readOnly continues to deny mutations.

UI: approvals render beside their originating tool in transcript, all decisions stay visible. Keyboard A/D applies only with card focus and no modifiers/repeat/composition, disables while mutation pending/readOnly/decided. Error remains visible. Coloured patch lines also have +/- text. Mode picker shows confirmed value and stays available during active turn; model/text controls retain established locking. Sidebar uses established status badge. New sessions omit explicit mode and inherit current workbench default.

CLI: --approve all approves pending requests as user, none denies. Without a flag, stdin+stderr TTY opens an abortable prompt on stderr and reads a/d; nonTTY safely denies. JSONL stdout remains only events. No catalog override; read-only remains enforced. CLI flags act only on pending requests, ordinary auto-edit uses mode. Unknown/invalid flag is usage2. Denied replay can end with exit0.

No new dependency/migration/runtime/queue. No shell, network, WP18 panel or visual retouches. No open product decisions.
