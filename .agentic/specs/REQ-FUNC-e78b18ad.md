# Extraction and chunks

WP-23 follows architecture05 sections2–3. The workbench's owned ingest queue
publishes processor results and chunks in one SQLite transaction after verifying
the source identity. The schema1 SQL stays immutable. Desktop and CLI compose
dedicated Node workers; core remains independent of Electron.

PDF extraction uses pdfjs-dist getTextContent on each page inside the dedicated
worker, with local byte input and external resource fetching disabled. Page text
preserves line/paragraph boundaries. Fewer than20 trimmed text characters per
page on average yields needs_ocr and zero chunks; malformed PDFs fail processing.
UTF8 text retains physical lines (terminal newline adds no artificial line).
Markdown uses a CommonMark AST to recognize ATX/Setext headings outside code;
HTML uses a parsed tree, decoded entities, block boundaries and h1–h6 headings,
excluding script/style/template content. Sections carry the ancestor heading
path, unique slug and original Markdown line range. Preamble sections have an
empty heading path. Chunks never cross a PDF page or heading section.

PDF/heading sections pack whole paragraphs where possible, splitting oversized
paragraphs safely at text boundaries. The heading path prefixes each section
chunk. Text windows span60 physical lines and advance50 (overlap10); oversized
windows may split into smaller chunks with exact line ranges. CSV uses60 data
lines/advance50 and repeats the original header in every chunk. Empty text
produces no chunks. Chunk text targets1400 characters and remains below512 tokens including special
tokens, measured with the existing package's pinned BGE tokenizer snapshot.
The zero-dependency tokenizer library is bundled locally; no model execution or
selection occurs. Full heading paths and repeated CSV headers count against both
budgets; an overflowing prefix fails processing explicitly. Heading paths stay
complete in text and locator. Paragraph/whitespace boundaries are preferred;
arbitrary identifiers and Unicode are checked after choosing each split.
WP24 owns model selection; a tokenizer change updates this budget contract along
with rechunking before a different model consumes the persisted text.

Cache .vera/cache/extract/<sha256>.json is versioned, kind/hash-bound and schema
validated. Reads/writes are bounded and refuse redirected ancestors/files.
Malformed/incompatible cache entries regenerate. Atomic exclusive temporary
writes publish only under a current ownership guard and live abort signal.
Cache failure fails processing; no false indexed status. Source bytes are read
from an ordinary confined file with size/identity/hash verification. Close
terminates the worker and drains processing. Ingest verifies identity again
before atomically publishing ordered chunks with locator_json/chars and status.
Source change/delete/reindex uses the established derived-row invalidation.

Demo Markdown sources describe the fictional VERA-DEMO-01 board. The generator
renders a datasheet, reference manual excerpt and application note to stable
PDF names in fixtures/workbenches/demo-board/docs. No vendor material is used.
