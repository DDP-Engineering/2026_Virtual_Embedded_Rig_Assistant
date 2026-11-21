# Curated provider routing and credentials

A curated connection carries the preset and binding IDs and a canonical HTTPS base URL.
The registry owns that base and the independent catalog URL or manual strategy. Main
matches the selected binding and exact base before saving or reading a saved key.
Changing a binding requires a fresh connection. Its reference remains custom:<slug>/<model>,
and the connection's generated slug persists across edits. The model suffix preserves
the complete ID, including slashes.

The credential slot uses the slug and a digest over the preset ID, binding ID, protocol,
authentication and the registered routes. The credential file owns values and projects only
bounded metadata to Settings. For an authenticated call the gateway resolves an exact route
and a connection-scoped key, then applies that key only to that request. The Chat Completions
adapter accepts POST at the exact bound inference path. Catalog lookup sends GET to its
independently registered URL and accepts a saved ID only for the requested preset and binding.
Catalog lookup may instead take an explicitly entered draft key. Fetch refuses redirects.

Discovery returns discovered model IDs, a manual-entry reason, or a structured failure.
Catalog data is bounded and validated. A provider-controlled ID containing a known secret
fails validation. Inference diagnostics and default stream output are scrubbed using the
saved key and the host's retained secret set.

With agent masking enabled, a terminal tool call containing a credential known only to
the current request is rejected before raw tool arguments reach session processing.
Matching uses provider-controlled strings and exact non-string JSON scalar values.
Ordinary tool calls retain their existing execution semantics.
