# Workbenches and documents

The workbench format, skills, the workbench database, document indexing, search and citations.
Agent runtime, other tools and permissions: [Agent.md](Agent.md). Screen layout:
[Interface.md](Interface.md). Plugins: [Plugins.md](Plugins.md).

## Workbench

A workbench is a local folder, its root. VERA keeps its own data in `<root>/.vera/` and does not move
or convert other files. Opening requires `.vera/workbench.yaml`; create refuses a folder that has one
and offers to open it. A symbolic link or junction at `.vera/`, `.vera/skills/` or the files below
refuses create and open. A network share opens with the warning `NETWORK_SHARE_UNSUPPORTED`.
Settings, credentials, user skills and installed plugins stay in the app's user data folder. Code:
`core/src/workbench/service.ts`.

### The `.vera/` folder

| Entry | Content |
|---|---|
| `workbench.yaml` | Configuration (below); edited through Edit workbench |
| `WORKBENCH.md` | Instructions in every system prompt (`<workbench>` tags); above 16 KiB (UTF-8) the editor warns and the prompt carries the first 16 KiB. Create writes an English template unless the file exists |
| `.veraignore` | Optional, gitignore syntax, patterns relative to the root |
| `.gitignore` | Written on create if missing: ignores everything except `.gitignore`, `workbench.yaml`, `WORKBENCH.md`, `.veraignore` and `skills/` |
| `skills/<name>/` | Workbench skills |
| `plugins/` | Plugin packages kept with the project ([Plugins.md](Plugins.md)) |
| `lock` | `{pid, app, since, token}` of the owning process |
| `vera.db` (+ `-wal`, `-shm`) | SQLite: sessions and the document index |
| `cache/extract/<sha256>.json` | Extracted text by content hash (at most 128 MiB each); unused entries pruned after indexing |
| `artifacts/<session-id>/` | Session artifacts |
| `attachments/<session-id>/` | Images attached in the composer |
| `downloads/<id>/` | `web_download` files with a `.vera-download.json` manifest |
| `runs/<run-id>.log`, `.json` | Program run logs; the oldest are removed beyond 200 runs |

Ordinary file tools do not see `.vera/` (Ignore rules); the agent cannot change `workbench.yaml` or
`.vera/plugins` in any permission mode.

### `workbench.yaml`

YAML with unique keys, saved atomically through the write queue without comments or formatting.
Only `format`, `id` and `name` are required; blocks default as shown. Schema:
`shared/src/workbench.ts`.

| Key | Rule and default |
|---|---|
| `format` | integer `1`; any other value is invalid |
| `id` | `wb_` + ULID, written on create, never changes |
| `name`, `description` | name 1-80 characters after trimming; description optional |
| `embeddings` | `model` (default `Xenova/bge-small-en-v1.5`, or `Xenova/multilingual-e5-small`), `chunkSize` 200-1400 (default 1400), `overlap` 0-600 and below `chunkSize` (default 200); unknown keys are an error |
| `docs` | `include` (default `["docs/**"]`), `exclude` (`[]`), `gitignore` (`true`), `maxFileMB` (optional, lowers the size limits only), `maxFiles` (default 10000) |
| `retrieval` | `results` 1-20 (default 8) and `mode` `hybrid`/`keyword`/`semantic` (default `hybrid`): the `search_docs` defaults |
| `skills.disabled`, `tools.disabled` | names hidden from this workbench |
| `plugins.enabled` | plugin ids enabled for this workbench |
| `chat.detail` | `verbose`, `normal` (default) or `minimal`; presentation only |
| `interface.right_panel_tabs` | ordered tab ids from `context`, `docs`, `changes`, `artifacts`, `plan`, `bookmarks`, `runs`, `terminal`; default all but `bookmarks` |
| `agent` | `permission_mode` (default `ask`), `model` (`null` or `"<providerId>/<modelId>"`), `allowed_commands` (saved command prefixes) |
| `additional_folders` | at most 64 unique absolute folder paths |
| `privacy.mask` | `display`, `runs`, `agent`, `exports`, each `default`, `on` or `off` |

A YAML error reports line and column; a schema error reports the key path. Unknown keys at the top
level and inside the loose blocks are kept on save and reported as `UNKNOWN_KEY` warnings; unknown
skill, tool or plugin names give `UNKNOWN_NAME` warnings.

### Lock and read-only workbenches

Opening takes `.vera/lock`. A lock of another live process opens the workbench read-only: the
database is read from a private temporary copy, nothing is written, nothing is indexed; sessions,
files and exports stay readable, but messages, settings and skills cannot change. A lock of a dead
process, or one that does not parse, is taken over under a short local IPC guard (busy guard:
read-only with `LOCK_GUARD_BUSY`). Saves and session changes recheck the lock's pid and token. Close
stops indexing, checkpoints the WAL and deletes the lock only if it is still this process's.

### Additional folders

`additional_folders` lets the ordinary file tools and shell working directories use folders outside
the root, by absolute path and with the same approvals and ignore rules. They are never indexed;
indexes, artifacts and logs stay in the main workbench.

### Ignore rules

Code: `core/src/workbench/ignore.ts`, `core/src/knowledge/selection.ts`.

1. Always ignored, at any depth and case-insensitively: path segments `.vera`, `.git` and
   `node_modules`. No negation brings them back.
2. `.vera/.veraignore` decides next; its `!` rules win over `.gitignore`.
3. With `docs.gitignore` on, the root and nested `.gitignore` files apply as in Git (each relative to
   its own folder, the deepest matching rule wins). They affect indexing, the document preview and
   the Files tab marks only; the agent's file tools still read files only `.gitignore` excludes.

An ignored folder hides everything inside it. Symbolic links are never followed by the index or the
Files tab. A `.veraignore` that is a link or unreadable hides everything from the index.

## Skills format

Skills use the Agent Skills format: `skills/<name>/SKILL.md` below each skill root, with YAML front matter. Code:
`core/src/skills/catalog.ts`.

```markdown
---
name: datasheet-reader
description: Extract limits, pinouts and register maps from datasheets. Use when asked about a part.
---
1. Find the datasheet with `search_docs` ...
```

- Roots: workbench `.vera/skills/`, user `<userData>/skills/`, `skills/` of each enabled plugin, and
  the built-in `create-plugin`.
- `name`: `a-z`, `0-9`, `-`, 1-64 characters, equal to the folder name. `description`: non-blank, at
  most 1024 characters. No duplicate keys or YAML aliases. Files: UTF-8 text, at most 256 KiB each;
  at most 1024 skill folders per root.
- Precedence: workbench, user, enabled plugin with the lowest id, built-in. An existing workbench
  folder wins even when its skill is invalid.
- The prompt lists enabled valid skills as `name: description` in `<skills>`; the agent loads one
  with `load_skill {name, file?}`. Disabled skills are neither listed nor loadable; invalid ones show
  their error in the UI only. Workbench and user skills are editable in the UI; others are read-only.

## Data model

`.vera/vera.db` holds everything per workbench; the full schema is in `core/src/storage/schema.ts`.

| Area | Tables: what is stored |
|---|---|
| Identity | `meta`: schema version, workbench id, app version, index counters and state |
| Sessions | `sessions` (title, model, mode, status, archived); `session_delegations` (child sessions) |
| Transcript | `messages` (verbatim model messages); `events` (persisted session events) |
| Tools | `tool_calls`; `approvals` (request hash, decision); `changes` (diffs, before/after hashes) |
| Output | `artifacts` (metadata; files in `.vera/artifacts/`); `todos` (the plan) |
| Documents | `documents` (path, kind, hash, size, pages, status, reason); `document_extractions` (full text) |
| Index | `chunks` (text, locator); FTS5 `chunks_fts` (words) and `chunks_tri` (trigrams), kept by triggers; `embeddings` (384-float vector and model id per chunk) |

Foreign keys cascade on delete, except `session_delegations` (a parent session with delegations
cannot be deleted; a deleted child leaves the row with no child). Format rule: `meta.schema_version` is `1` and is the only accepted
value. An empty database gets the complete schema in one transaction; an existing one is never
rewritten. Any other version or an incomplete schema is refused and the file stays untouched; a
different workbench id is a conflict. There are no migrations and no backups. SQLite runs in WAL mode
with foreign keys on.

## Document indexing

### Supported kinds

| Kind | Extensions | Extraction | Locator |
|---|---|---|---|
| PDF | `.pdf` | pdf.js text per page, line and paragraph breaks from text positions | page |
| Markdown | `.md`, `.markdown` | CommonMark heading tree into sections | heading slug, lines |
| HTML | `.html`, `.htm` | visible block text, nothing fetched; `h1`-`h6` into sections | heading slug |
| Text | `.txt`, `.csv`, `.tsv` | UTF-8 lines | lines |
| Document | `.docx`, `.odt` | converted to HTML, then sectioned as HTML; images not read | heading slug |
| Presentation | `.pptx`, `.odp` | slide text in order; speaker notes not read | page (= slide) |
| Spreadsheet | `.xlsx`, `.ods` | one section per sheet, rows as tab-separated cells | heading (sheet) |

Not indexed: source code, logs, JSON/YAML/XML and other data files, legacy `.doc`/`.xls`/`.ppt`,
RTF, Office owner files `~$*`. The agent reads those with its file tools. Text kinds must be valid
UTF-8. OCR is not supported: a PDF with fewer than 20 non-blank characters per page on average is
`needs_ocr`, gets no chunks and still opens in the viewer.

### Pipeline

Only a writable workbench indexes. Selection, hashing, extraction, chunking and embedding run in the
**VERA Indexer** utility process; main does every SQLite write. After a crash the process restarts;
three crashes within 60 s stop it until "Restart indexing", and a document that crashed it twice
stays failed until it changes. PDF and Office parsers run in disposable worker threads (2 GiB heap,
120 s deadline; PDF 30 s per MiB up to 15 minutes). The CLI runs the same pipeline in-process
(`vera index`, `vera search`).

The selection is `docs.include` minus `docs.exclude` minus the ignore rules, document kinds only. A
pattern that does not end in `*` selects everything below it; an include entry starting with `!`
excludes. Per file: too large gives `unsupported` / `SIZE_LIMIT`; an unchanged file (same size and
time, current-model vectors) is skipped; otherwise it is hashed, extracted (or read from the cache),
chunked, embedded in batches of 64 and stored in one transaction, unless the source changed
meanwhile. Statuses: `pending`, `indexed`, `failed`, `unsupported`, `needs_ocr`, each with a reason.

### Limits

| Limit | Value |
|---|---|
| File size | PDF and Office 100 MiB, Markdown/HTML/text 20 MiB; `docs.maxFileMB` lowers them |
| File count | above `docs.maxFiles` (10 000) nothing is indexed, changed or removed; the Files tab shows the count, the ten largest folders, "Index anyway" and "Edit exclusions". "Index anyway" stores the count; a later selection up to 20 % larger keeps indexing |
| Volume warning | above 2 000 files or 2 GiB the selection preview warns; indexing continues |
| PDF text | at most 50 000 pages and 32 Mi characters; later pages are left out |
| Office archive | more than 10 000 entries or 500 MiB uncompressed fails with `SIZE_LIMIT`; a sheet's text is capped at 32 Mi characters |
| Selection preview | counted with the indexer's own selection and limits; stops after 5 s and then reads "at least" |

### Chunking

Code: `core/src/knowledge/chunk.ts`.

- PDF pages and slides are chunked per page; chunks never cross pages.
- Markdown, HTML, document and spreadsheet sections are chunked per section; the heading path
  (`A > B`) prefixes every chunk.
- Text files are split as a whole; `.csv` chunks repeat the header row.
- Each chunk has at most `chunkSize` characters (prefix included) and fewer than 512 tokens of the
  workbench model's tokenizer. Splits prefer a blank line, then a space. Consecutive chunks overlap
  by `overlap` characters, at most half the previous chunk.

### Embeddings

| Model | Use | Vector | Prefixes |
|---|---|---|---|
| `Xenova/bge-small-en-v1.5` (default) | English, ONNX q8, about 34 MB | 384, CLS pooling, normalized | query `Represent this sentence for searching relevant passages: `, passage none |
| `Xenova/multilingual-e5-small` | about 100 languages, also cross-language queries, ONNX q8, about 118 MB | 384, mean pooling, normalized | `query: `, `passage: ` |

The default was chosen by measurement: `npm run eval:retrieval` requires hybrid recall@5 of at least
0.85 overall, 0.95 for English and 0.75 for Romanian questions over English documents
([product-eval.mjs](../05_Software/evaluators/eval-retrieval-harness/product-eval.mjs)).

Both ship in every package under `<resources>/models/<model-id>/` (`05_Software/src/models/` in
development), each with a `model-manifest.json` giving every file's size and SHA-256, checked before
loading. Inference is local and offline: `@huggingface/transformers` on ONNX Runtime, CPU, one
thread, remote models off and network `fetch` blocked; one worker per model in use, stopped after
60 s idle. Inputs of 512 tokens or more are rejected. Vectors carry a model id
`<modelId>@<revision>:<hash>`; a document lacking vectors for the current id is embedded again.

### Reindex triggers

- A file watcher on the include folders, `.gitignore` files, `.vera/workbench.yaml` and
  `.vera/.veraignore`; any change starts a full reconciliation after 1 s. Deselected documents are
  removed with their chunks and vectors.
- Saving `docs` settings re-selects.
- Changing the model asks for confirmation with the indexed document count, deletes all vectors and
  re-embeds from the stored extraction in the background; keyword search works meanwhile.
- **Reindex** deletes every document row and indexes again, reusing the extraction cache. A changed
  chunk size or overlap applies to documents processed after the change; Reindex applies it to all.
- A failed document is tried once more after the workbench is reopened.

## Search and citations

Code: `core/src/knowledge/search.ts`, `keyword.ts`, `shared/src/refs.ts`, `core/src/agent/citations.ts`.

| Mode | Ranking |
|---|---|
| keyword | query terms OR-ed over the word index (bm25, top 50); terms of 3+ characters with a digit or `_` also search the trigram index, so fragments of part numbers and register names match; both lists fused by reciprocal rank |
| semantic | cosine against every current-model vector of the selected chunks (brute force in the embedding worker), top 50 |
| hybrid | reciprocal rank fusion of keyword and semantic, `1/(60 + rank)`, top 50 |

**`search_docs {query, k?, mode?, pathGlob?}`**: query up to 1 000 characters, `k` 1-20, defaults
from `retrieval`, `pathGlob` relative to the root. Returns `{results, message?}`; each result is
`{ref, path, locator, snippet, score}` for a file that still exists, the snippet 300 characters from
80 before the first query term. Messages explain an empty index (use `grep`) or a glob matching
nothing. While vectors are rebuilt or the indexer is stopped, semantic and hybrid return keyword
results with a message. A search overlapping an index change fails with "Retry". The Files tab
search is keyword mode, 20 results.

**`read_doc {path, ...}`** reads the stored extraction of an `indexed` document after checking the
source hash. One locator family per call: `page`/`pageEnd` (PDF, presentation), `heading` slug
(`""` is the text before the first heading; default the first section) or `lineStart`/`lineEnd`
(text). Mixing families is an error naming the right one. It returns `{path, text, truncated, ref}`
within 12 000 characters of text (28 000 of JSON); a long section, page or line comes in numbered
`part`s, and `ref` names exactly what was returned.

### References

| Target | Format | Example |
|---|---|---|
| PDF page, slide | `<path>#p=<n>` | `docs/ds.pdf#p=45` |
| Page or slide range | `<path>#p=<n>-<m>` | `docs/rm.pdf#p=1203-1204` |
| Section or sheet | `<path>#h=<slug>` | `docs/bringup.md#h=power-sequence` |
| Text before the first heading (not Markdown) | `<path>#h=` | `docs/spec.docx#h=` |
| Lines (text, Markdown preamble, `read`/`grep` results) | `<path>#L<a>-L<b>` | `logs/boot.log#L118-L131` |
| Session artifact | `artifact:<name>` | `artifact:summary.md` |
| Help page | `help:<page>`, `help:plugin/<id>` | `help:settings` |

Slugs are lower case letters, digits, `_` and `-`; spaces become `-`; an empty title becomes
`section`; repeats get `-1`, `-2`. The model cites as `[[<ref>]]`.

A citation is verified when the ref came in a `ref` field of a successful tool result in the session
(a line range may lie inside an issued window) and the target still holds: the artifact exists; the
lines fit the file's current line count; a help ref came from the help tool; or the document is
`indexed` with an unchanged hash, the locator fits its kind, and the page is in range or the slug
exists. Unverified citations show as warning chips; opening a citation checks it again.

## Viewer

The viewer is read-only and opens a file in one of three modes, remembered per file extension:

| Mode | Files |
|---|---|
| Rendered | indexed PDF, Markdown, HTML and supported Office files; images (PNG, JPEG, GIF, WebP, BMP, SVG as an inert image) without indexing |
| Text | text files, and Markdown/HTML that are not indexed; encoding from a BOM or UTF-8, with a choice of Windows-1252, ISO-8859-1, ISO-8859-2 or UTF-16 LE/BE; files above 5 MiB are read in 64 KiB windows |
| Hex | binary and unknown files by default; available for every file |

Reads go through main in byte windows of at most 1 MiB, confined to the workbench. Document types can
also open in the system's default application. A citation opens the viewer at the cited place: the
PDF page with the snippet highlighted, the section at its heading, the slide, or the marked lines
(also in text files that are not indexed).
