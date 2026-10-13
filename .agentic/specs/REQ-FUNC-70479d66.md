# Session export and search

Shared export JSON version 1: strict schemaVersion=1, session summary, ordered events [{seq>=1, createdAt UTC datetime|null, event: SessionEvent}]. Persisted records only; queue/delivery events retain identity and order. No compactor view or credentials included. JSON serves archival replay, not an import feature.

Markdown is deterministic English-format document with session title/ID/dates/status and ordered transcript sections. User/assistant text and tool summaries are literal fenced text; choose a fence longer than any content backtick run. Citations display literal ref and persisted valid/unverified flag. Applied changes include path/counts/stored diff. Current live partial deltas are not persisted; export reflects durable records at export time after picker confirmation. Pending messages keep markers.

Search trims bounded 1000-character query and performs Unicode-lowercase literal substring matching against scrubbed title and persisted message.user/message.queued/message.done text. Each session appears once in existing list order; blank query is invalid at core/IPC and cleared UI shows ordinary list. No match returns empty list; active transcript remains selected even when absent from filtered results.

Main runs export inside SessionsHost serial operation, native save dialog selects session-ID.md/json; cancel writes nothing. Existing artifact export destination guard denies .vera and resolves existing ancestors/symlinks. Atomic filesystem port writes with format-specific content. Read-only workbenches support search/export; export writes only external destination. Authorization remains ipc-router sender checks. Existing session sanitizer protects event fields, arbitrary argument keys/values and metadata; differences in model format fall back per existing contract. Export changes are scrubbed before formatting, never after JSON serialization.

Renderer sidebar search owns query state per workbench and a separate query cache; list remains canonical for active-session restoration. Export actions on selected transcript use main IPC and show localized completion/cancel/error state. Mock implements identical search projection and export response for browser-only presentation.

Runtime verification scenarios are authored but execution deferred by user. Both plan Done criteria remain unexecuted, not PASS.
