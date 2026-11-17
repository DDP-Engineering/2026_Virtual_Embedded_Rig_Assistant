# Compact verified large text sources

`docs.open` keeps existing generic reference/session-issued citation provenance and current SHA checks.
For verified text over 5 MiB, core returns `kind: text`, empty `lines`, the original `path/ref/snippet/start/end`,
and `byteSource: {size, modified, revision, lines, utf8Log}`. `lines` inside byteSource is the original total.
The shared schema requires empty payload lines and `start <= end <= byteSource.lines`.
Small text and rendered formats keep their current payloads. Stored formats remain1.

Core captures `modified` directly from the verified stat's `mtime.toISOString()` (numeric milliseconds
can round differently) and `revision = JSON.stringify([dev, ino, size, mtimeMs, ctimeMs])` from the same
checked streaming snapshot. Existing hash checks bind the source/index; a changed subsequent revision
fails closed even if size and mtime are restored. A conservative conflict after a same-content rewrite is valid.

Display encrypts/authenticates revision with its existing identities codec using owner plus
`byte-source:<original path>` as context. Renderer receives only that sealed segment. `docs.readBytes`
accepts optional revision for this mode. A non-sealed token returns DENIED; wrong owner/path authentication returns NOT_FOUND; a mismatched
current source revision returns CONFLICT before any reply. Ordinary byte requests remain their own current mode.
The response echoes sealed revision plus `lineEnds`: strictly increasing relative byte ends in the requested
window, bounded by returned bytes and the1MiB host limit. The host derives universal UTF8 CR/CRLF/LF ends
from original bytes before current Display masking. Only LF terminates CRLF; bare CR terminates alone.
Thus secret-masked newline bytes cannot shift cited line identities. These arrays describe one chunk only.

Renderer compares opening stat size/date to metadata, checks every byte reply/revision/line end,
and rejects mismatches. It decodes verified UTF8 fragments at original breaks, preserving the original
cited range and initial source line; validated utf8Log citations retain their NUL/control exception.
Raw caches and sparse indexes are transient, disposed with the content attempt on privacy/owner change.
Retry returns to the parent loader and repeats provenance validation. No source tokens or indexes persist.
