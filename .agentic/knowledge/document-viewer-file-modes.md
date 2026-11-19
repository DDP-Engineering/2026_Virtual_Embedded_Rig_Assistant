# File viewing modes: text, Hex and images

## Routing

Select for ordinary-file toolbar modes (Rendered/Text/Hex) and remembered extension preferences
(file-mode.ts, `vera.viewer.modes`), index-independent PNG/JPEG/GIF/WebP/BMP/SVG preview with fit and
zoom (image-source.ts, image-viewer.tsx), `docs.readBytes`, byte-backed text with encodings, word
wrap, find and go-to-line, large-text windows and the Hex viewer.
Start under05_Software at renderer/components/documents (file-mode.ts; hex-{source,rows,viewer} for
byte viewing; text-encoding.ts, read-text-file.ts, use-text-rows.ts,
large-text-{source,index,find,window,rows,viewer} for byte-backed text), core/workbench/read-bytes.ts
and main/display-bytes.ts. Focused tests are file-mode.test.ts, hex-source.test.ts, hex-viewer.test.ts,
large-text.test.ts, read-text-file.test.ts, read-bytes.test.ts, display-bytes.test.ts and
tests/e2e/{viewer-modes,hex-viewer,large-text,text-encodings,image-preview}.spec.ts.
[Document viewer](document-viewer.md) owns tabs, verified citations, PDF/office bodies and Display
identities; the [Docs panel](document-viewer-docs-panel.md) owns the Files tree whose rows open these
modes; [workbench](workbench.md) owns statEntry and the readBytes lifetime.

## Purpose and boundaries

The renderer shows an ordinary workbench file as Rendered, Text or Hex from bounded physical byte
reads; no complete large file is fetched to choose a mode. Core read-bytes.ts owns confined positional
I/O, main DisplayDocuments owns live Display masking of the returned bytes, and the renderer owns
decoding, windows, search and selection.

## Public interface

- Plain path/textPath targets use file-mode.ts: docs.stat supplies a real extension key computed by main before path identity projection; recognized extensions use their lower-case public vocabulary and unknown suffixes use the existing host-keyed identity namespace, independent of filename/workbench/Display state. Unknown extensions default Hex; recognized text uses a fixed4096-byte prefix to detect binary control bytes with BOM-aware decoding. Core statEntry ([workbench](workbench.md)) supplies a compact rendered capability from the current indexed record, using a direct path lookup rather than loading all documents or source bytes. Available indexed PDF/Markdown/HTML/Office sources and recognized images offer Rendered/Text/Hex. Images default Rendered independently of indexing. Other files offer Text/Hex: unavailable Markdown/HTML defaults Text, unavailable binary containers default Hex. A saved unavailable Rendered preference remains unchanged. Raw text remains explicitly available for unknown formats, with existing encoding/replacement controls. No complete large text is fetched to choose a mode.
- The strict version1 localStorage record `vera.viewer.modes` stores `{version:1,extensions:{[realExtension]:mode}}`. Deliberate choices alone write it (see Invariants). Malformed/unavailable records resolve defaults; quota denial keeps the explicit current-tab choice. Another extension is independent. Rendered failures retain the toolbar and Retry so Text/Hex remains reachable.
- An explicit click on the effective mode also remembers that choice while retaining the current body/place/attempt. Switching to another mode clears incompatible place/content, increments the provider-wide attempt and uses the existing owner/attempt settlement guards. HexSource is created and disposed by the owning mount effect so development effect replay creates a fresh source and old operations remain cancelled.
- `docs.readBytes({workbenchId,path,offset,length})` reads any ordinary owning-workbench file,
  ignored or binary included, at original physical offsets (safe integers, length1..1048576).
  It returns `{workbenchId,path,displayPath,offset,size,data}` with base64 data through EOF;
  `docs.stat` retains file/folder Properties and the original physical size. Core read-bytes.ts
  uses bounded positional I/O, ordinary/canonical root and path rechecks, and descriptor inode/dev/
  size/mtime/ctime checks before/after reading; missing sources return NOT_FOUND, changed sources
  CONFLICT, invalid windows INVALID and disallowed paths DENIED. Bypass/additional folders never
  extend viewer scope. A fixed64 KiB host-only context per side bounds input to1MiB+128KiB.
  DisplayDocuments rechecks owner/generation and current Display/secrets after asynchronous work.
  On replaces all overlapping literal/JSON-escaped secret bytes in UTF8, UTF16LE/BE, Windows1252,
  ISO88591/2 with0x2A, preserving length/offset/physical size; overlong representations mask the
  entire returned window. UTF16 masked pairs decode as U+2A2A. Off returns exact original bytes.
  Exact contract: specs/REQ-FUNC-69645e84.md. Ordinary text consumes it through the reader and bounded large-text source.
- Ordinary file text up to 5 MiB uses read-text-file.ts: docs.stat, sequential <=1MiB docs.readBytes,
  consistent owner/host identity/physical offsets/size/exact lengths and matching final stat mtime.
  An empty file still reads once. Larger ordinary text uses a transient LargeTextFile descriptor,
  four cached64 KiB byte windows and one decoded/measured window. A separate byte-position scrollbar
  reaches arbitrary offsets; inner scrolling and edge wheel/keys move through adjacent fragments.
  UTF8/UTF16 boundary handling retains complete characters; long lines use bounded fragments marked ….
  LargeTextIndex retains one progressive cursor and <=1026 sparse checkpoints, with physical stride
  derived from file size. Approximate row labels (≈) settle exactly after yielding chunk scans.
  Go to line shows an estimated window first, then scans/settles exactly, clamping beyond EOF.
  Find scans256 KiB at a time with query-sized raw overlap, scalar matching-line counters and first/last/selected hits; Enter/Shift+Enter wrap, with current/total counts;
  Cancel, a superseding request or unmount aborts publication. Search/index loops yield per chunk.
  Find keeps its physical match column visible inside long-line fragments, including after wrap changes.
  All byte replies validate owner/path/offset/physical size/base64/exact lengths and opening metadata
  before publication; mismatches use CONFLICT. Display refresh remounts the attempt, aborts old work
  and clears caches/indexes. No source bytes or line index are persisted; kept large-file scroll is
  its physical byte offset. Indexed ordinary text tree entries use textPath directly, avoiding a
  complete extraction reply. Verified text above5MiB returns empty lines plus compact byteSource after
  existing issued-reference/SHA checks; original ref/snippet/start/end remain, and the large viewer
  settles the cited initial line and aria-current range. Core captures size, actual stat date and
  dev/ino/size/mtimeMs/ctimeMs revision from the verified streaming snapshot; Display seals revision
  to owner/path, and readBytes refuses a changed revision before returning masked bytes. Bounded
  original CR/CRLF/LF lineEnds preserve source identities when Display masking hides newline bytes.
  Verified UTF8/control-log admission stays host-owned. Retry repeats parent provenance/loading,
  Escape focuses the body.
  Exact compact contract: specs/REQ-FUNC-ed0b45c5.md.
- TextViewer offers a Word wrap checkbox for numbered source text. `use-text-rows.ts` measures
  mounted row heights and keeps estimates for unseen rows, with 40 overscan rows per side. Pending
  Find/Go to line targets settle after measurement; wrap/width/font changes invalidate measurements
  while preserving the source anchor before the browser clamps a shrinking spacer. The kept first
  line wins over citation start, and scroll reports retain source line numbers. FindBar stays
  on demand with Enter/Shift+Enter stepping and Escape returning focus to the body.
- text-encoding.ts uses TextDecoder: UTF8/UTF16LE/BE BOM detection, otherwise UTF8, with explicit
  UTF8/Windows1252/ISO8859-1/ISO8859-2/UTF16LE/BE selection. ISO8859-1 follows Chromium's Windows1252
  alias. Invalid strict decoding or NUL requests Show as text; explicit replacement decoding uses
  U+FFFD for invalid sequences. Changing encoding retries strict decoding without another host read.
  Small verified references, runs, downloads, artifacts and rendered PDF/Markdown/Office retain
  existing host content/provenance; larger text references use the verified revision-bound windows above.
- Hex opens automatically for unknown extensions or binary control bytes in a recognized text prefix, or from the toolbar and Files row menu. The explicit menu uses `textPath` with `hex:true`, retaining the original file tab key and identity; normal Open resolves the remembered extension preference. A later toolbar choice clears the menu override in the saved target. Its transient HexFile adopts the host-owned byte path from stat, including a newly opaque identity after credential registration. Format-1 tab storage admits the explicit Hex target and physical `{offset}` place. Citations retain their verified paths and ranges.
  HexSource owns four64KiB cached windows and serializes reads; each renderer window/scan/copy is at most64KiB. HexRows mounts at most100 rows, each16 bytes with physical uppercase hexadecimal offset, spaced uppercase bytes and ASCII0x20..0x7E (dot otherwise), including partial EOF rows. A byte slider spans arbitrary safe-integer file sizes without giant DOM/spacers; local scrolling/wheel and keyboard cross bounded windows.
  Go to offset accepts decimal or0x-prefixed hex in0..size-1 (zero for empty files). Find uses case-sensitive UTF8 or even hexadecimal pairs with optional whitespace, <=4096 bytes, streaming KMP across64KiB borders, next/wrap and scalar hit state. Query/mode replacement, Cancel, Escape, owner/attempt change and unmount abort publication. Input/paint yields once per scan window.
  Selection stores anchor/focus physical bytes; pointer drag/Shift-click and Shift+arrows extend it. Ctrl+C copies spaced uppercase hex; Ctrl+Shift+C copies UTF8 replacement-decoded text. Copy checks metadata before/after a fresh masked read and rejects ranges above64KiB. Clipboard uses a temporary offscreen textarea with execCommand, keeping sandbox permissions unchanged. All Find/copy bytes follow live Display; cached sources disappear on settings/config refresh. Malformed input shows localized feedback; read failures show the structured error and Retry (the parent reloads metadata). Escape closes fields/cancels before returning focus to the byte region. Hex context actions name Find and Go to offset.
- ImageFile is transient host-owned metadata with MIME, never persisted or placed in shared ViewerContent. Plain-image Rendered uses the same confined stat boundary as Hex and never calls docs.open. ImageViewer owns a fresh HexSource and AbortController per effect; readImageBlob assembles64KiB Display-policy byte parts, yields between parts and rechecks final size/mtime before creating a MIME Blob. Encoded data and the decoded browser image require memory proportional to image size; there is no arbitrary size cutoff. The effect creates/revokes its Blob URL; replacement, Display attempt refresh and unmount abort stale publication. Decode failure uses safe localized text and Retry; typed read failures retain ErrorMessage and Retry, and the parent Text/Hex toolbar remains available. Fit shrinks to the available width/height without enlarging small images; Intrinsic CSS max-width/max-height recomputes fit, and25–400 percent scales the original decoded resource. No canvas/screenshot resampling or image-mask bypass exists.

A transcript thumbnail selects the ordinary file tab in Rendered mode using the detected raster format for that open. The existing file mode switch and remembered preferences remain available.

## Invariants

- Verified refs/citations never enter the plain-file loader or get mode controls; artifacts, downloads and run logs keep their loaders.
- Only deliberate toolbar choices or the Files Hex action write `vera.viewer.modes`; automatic defaults, load errors, unsupported preferences and metadata refresh do not.
- SVG enters only img, with no live markup, scripts, handlers, navigation or external-resource loads. Only img-src adds Blob to local resources; other CSP restrictions remain.

## Change map

| Change | Start | Focused proof |
|---|---|---|
| Image previews and resource lifetime | documents/image-source.ts; image-viewer.tsx/CSS; file-mode.ts; content-policy.ts and renderer index.html | image-source.test.ts; image-viewer.test.ts; content-policy.test.ts; browser/native e2e/image-preview.spec.ts |
| File modes and extension preferences | documents/file-mode.ts; viewer-context; document-tabs; main/display-documents; core/workbench/service statEntry; shared documents metadata | file-mode.test.ts; document-tabs.test.ts; native/browser e2e/viewer-modes.spec.ts |
| Hex rows/search/copy | renderer/documents hex-{source,rows,viewer}, viewer-context, docs-tree, document-tabs-store | hex-source.test.ts; hex-viewer.test.ts; native e2e/hex-viewer.spec.ts |
| Large text windows/index/search | renderer/documents large-text-{source,index,find,window,rows,viewer} | large-text.test.ts; read-text-file.test.ts; e2e/large-text.spec.ts browser/native |
| Text decoding and measured wrap | renderer/documents text-encoding, read-text-file, text-viewer, use-text-rows | sibling tests; e2e/text-encodings.spec.ts browser/native |
| Bounded physical byte reads | core/workbench/read-bytes.ts and service.ts; shared documents/ipc.ts; main display-documents.ts and display-bytes.ts | read-bytes.test.ts; display-bytes.test.ts; display-documents.test.ts; documents-ipc.test.ts; focused service/bridge tests |

## Key behaviors

- REQ-FUNC-71a6501a: six index-independent image formats through bounded bytes and retained Hex.
- REQ-SEC-21021e27: SVG remains an inert image resource under restrictive CSP.
- REQ-UX-2b81bcdc: resize-aware fit and original decoded image zoom through400%.
- REQ-REL-35fd9a5f: safe failures/Retry.
- REQ-REL-2b14e715: effect-owned cancellation and Blob URL lifetime.
- REQ-FUNC-bc3f25bd, REQ-FUNC-12972046, REQ-DATA-7af13314, REQ-REL-2c2e6e93: applicable file modes, bounded automatic Hex selection and independent persistent extension choices.
- REQ-FUNC-94765114, REQ-FUNC-69596c3b, REQ-FUNC-b66d2d80, REQ-FUNC-53b3527c, REQ-REL-63f0f1cc, REQ-REL-a4d21663: bounded Hex rows, offset navigation, cancellable byte Find, selection copy, invalid input and Retry.
- REQ-FUNC-c5def0c3, REQ-UX-5a886e34, REQ-UX-77baabba, REQ-REL-3bb0b405: selected text decoding, explicit replacement, measured wrapped navigation and consistent bounded assembly.
- REQ-FUNC-69645e84, REQ-FUNC-e4204219, REQ-SEC-f561466e, REQ-REL-0fa2a8e9,
  REQ-SEC-d707ed8d, REQ-FUNC-c21cc184 — bounded physical bytes, confinement, typed races and live encoded masking.

## Files

Under05_Software: shared/{documents,ipc}.ts; core workbench/{service,read-bytes}.ts/test;
desktop/main/{display-documents,display-bytes,content-policy}.ts; renderer/components/documents:
image-source.ts/test, image-viewer.tsx/CSS/test and e2e/image-preview.spec.ts with generated support/image-preview-fixtures.ts;
file-mode.ts/test and e2e/viewer-modes.spec.ts; hex-source.ts, hex-rows.tsx, hex-viewer.tsx/CSS with sibling source/component tests;
text-encoding.ts, read-text-file.ts, use-text-rows.ts with sibling tests; text-viewer.tsx;
large-text-{source,index,find,window,rows,viewer} with large-text.test.ts; renderer index.html;
tests/e2e/{hex-viewer,large-text,text-encodings}.spec.ts.
