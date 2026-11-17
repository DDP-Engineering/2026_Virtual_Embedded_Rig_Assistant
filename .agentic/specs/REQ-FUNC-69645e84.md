# Bounded document byte protocol

Source: VIEW01 issue286 and epic285; the coordinator authorizes a simple documented byte-masking contract.

## IPC

`docs.readBytes({workbenchId,path,offset,length})` requires a nonempty Display path identity,
a nonnegative safe integer offset, length 1..1048576, safe offset+length and no extra fields.
Response: `{workbenchId,path,displayPath,offset,size,data}`. `data` is base64 encoding of
exactly min(length,max(0,size-offset)) bytes; `size` is the unmodified physical file size.
The returned `path` is the stable opaque Display identity; displayPath is presentation only.
An offset at/past EOF returns empty data. Empty files are valid. All offsets count physical bytes,
never Unicode characters. Existing `docs.stat` properties remain unchanged, including folder
support for Properties; its ordinary-file `properties.size` is the original physical size.

## Confinement and consistency

WorkbenchService serializes the read with lifecycle operations and uses its owning folder,
independent of permission mode and additional-folder grants. Existing locateEntry syntax and
ordinary-ancestor checks admit ignored files but refuse folders, symlinks/junctions, traversal,
absolute paths and Windows aliases. The initial resolved root must equal the stored canonical
owning folder (case-insensitive on Windows), including when an ancestor has been redirected.
Capture the canonical root and file stat; open read-only
with O_NOFOLLOW where available and O_NONBLOCK to avoid a raced FIFO blocking. Before and after
bounded positional reads, recheck ordinary ancestors, canonical root/path, file kind, device,
inode, size, mtime and ctime against descriptor and initial state. No file writes or readFile.
INVALID covers invalid windows/unsafe sizes; DENIED covers initially disallowed paths;
NOT_FOUND covers missing sources; CONFLICT covers identity/metadata/canonical changes or an
unexpected short read. Permission failures map to DENIED, other I/O failures to INTERNAL.
The descriptor always closes. Metadata checks are best-effort filesystem identity checks,
not a filesystem snapshot or protection against a privileged actor restoring all metadata.

## Bounded byte masking

The host reader fetches the requested physical window with at most65536 bytes of context on
either side, regardless of the current policy; allocation/read volume is at most1179648 bytes
(1MiB+128KiB), independent of file size. EOF windows allocate/read no bytes. Context is host-only.
After all asynchronous work, DisplayDocuments rechecks workbench generation/ownership and resolves
the latest Display policy and registered secrets synchronously. Off returns exact original bytes.
On searches the original context for literal and JSON-escaped spellings of every nonempty stored
secret, encoded as UTF8, UTF16LE/BE and exactly representable Windows1252/ISO88591/ISO88592.
Every byte of every overlapping match becomes ASCII `*` (0x2A), then only the requested window
is published. All patterns search original bytes; one replacement cannot hide another match.
No BOM or encoding guess controls masking: binary and unknown-encoding inputs get the same
conservative matching. UTF16 masked pairs therefore decode as U+2A2A; consumers must not interpret
these bytes as original text. Byte length, physical offset and size are invariant.
If a literal/escaped spelling could exceed65536 encoded bytes, mask the entire returned window
rather than allocate unbounded context or publish a partial secret. This conservative fallback
may mask unrelated bytes. Context covers every supported shorter match even for a one-byte window.
Patterns are generated one at a time; encoded buffers and result allocations are bounded by the
context/window limits. Stored credential memory itself is outside this reader's allocation budget.

## Verification

Focused shared/preload/router tests prove strict transport; real filesystem tests prove bounded
200MiB reads, ignored/binary/EOF behavior, links/outside aliases and descriptor race refusal.
Host masking tests cover all supported encodings, every split, overlap/escaping, overlong fallback,
live settings/credential races, opaque identities and close/switch invalidation. Existing native
packaging proof is reusable because there are no packaging/native dependency changes.
