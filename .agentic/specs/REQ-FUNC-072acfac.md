# Desktop agent browser contract

The registry binds these session tools while Desktop owns both browser opt-ins and an active
origin grant for the VERA session. The workbench can disable each tool by name. The runtime
checks current permission for each call and provider request, including after awaited session and
credential preparation.

| Tool | Arguments | Result |
| --- | --- | --- |
| `browser_open` | `{url}` | Opens a new tab and returns its `tabId` and final citation `url`. |
| `browser_snapshot` | `{}` | Returns `tabId`, `url`, `title`, `text`, `snapshotId`, `links: [{ref, label}]`, `truncated` and `contentTrust: "untrusted-web-content"`. |
| `browser_follow` | `{ref}` | Navigates the selected tab to the destination observed in its current snapshot. Returns the final URL. |
| `browser_scroll` | `{direction}` | Scrolls the selected page up or down and returns its tab ID and URL. |
| `browser_tabs` | `{}` | Returns `activeTabId` and `tabs: [{tabId, url}]`. URLs outside the current grant are null. |
| `browser_switch` | `{tabId}` | Selects an owned tab and returns its tab ID and URL. |
| `browser_close` | `{}` | Releases the session's browser and origin grants, returning `{closed: true}`. |

The browser runs in its BRW-01 sandbox with the BRW-02 public-only proxy. The fixed DOM reader uses
Chromium's isolated world and returns text and human-readable links in the top-level viewport.
Only rendered HTML, XHTML and plain-text documents are supported. Treat the full page data as
untrusted. A link ref identifies an observed destination in the selected tab's latest snapshot.
New snapshots, scrolling, switching, navigation and closure retire references. The opaque
identifiers and handles are volatile and scoped to the owning workbench and session.

Errors use `{isError: true, code, error}` and stable codes including `destination-denied`,
`unsupported-content`, `page-closed`, `stale-reference`, `operation-timeout` and
`operation-limit`. The proxy rejects denied document destinations and unsupported content
before replacing the current document. Browser launch and proxy limits also apply.

At most 80 agent operations are admitted per grant. At most eight calls may wait or execute,
with a reserved close slot. Calls are serialized within their owning session. The whole-call
budget includes queueing and is 35 seconds for open and 12 seconds for other operations. An
aborted or timed-out active call tears down the browser to cancel outstanding Playwright work.
Results are capped at 24,000 UTF-8 bytes. Snapshots cap visible text at 4,000 UTF-16 code units,
titles at 240, and link labels at 160, with up to 48 links. Citations use the complete granted URL
whose JSON encoding fits within 4,096 bytes. The existing web provider and managed download
supply search, static extraction and file downloads.
