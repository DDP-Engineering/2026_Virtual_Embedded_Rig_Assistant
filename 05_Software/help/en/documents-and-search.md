# Documents and search

VERA indexes the documentation of a workbench on your computer, so the agent can search it and cite the exact page, section or line it used. Indexing uses BGE Small EN v1.5, a local embedding model for English, and sends nothing over the network. When the agent reads a passage to answer you, that passage goes to your model provider like the rest of the conversation; with a local server such as LM Studio or Ollama it stays on your computer.

Display masking is off by default. When enabled for a workbench, stored secrets in file names and viewer text appear as [REDACTED]. Files and search results remain listed and open the same file, even when two masked names look alike. Display masking does not change indexing or what the agent may send to a model. PDF page images keep their original bytes; only extracted text is masked.

## What is indexed

The folders checked under **Edit workbench** → **Documents & RAG** are indexed, together with the include and exclude patterns under **Advanced: include and exclude patterns**. These file types are indexed:

- PDF
- Markdown, HTML and text (`.txt`, `.csv`, `.tsv`)
- Word, PowerPoint and Excel files in the modern formats (`.docx`, `.pptx`, `.xlsx`) and their OpenDocument counterparts (`.odt`, `.odp`, `.ods`)

Legacy `.doc`, `.ppt`, `.xls` and RTF files are not indexed; save them in a modern format. Files matched by `.vera/.veraignore`, and anything in `.vera`, `.git` or `node_modules`, are never indexed. Source code and logs are not indexed either; the agent reads them directly with its file tools.

With **Use .gitignore** checked (the default for new workbenches), files and folders that the workbench's `.gitignore` files exclude are not indexed either: the one in the workbench folder and those in its subfolders, each for its own folder, as in Git. A line starting with `!` in `.vera/.veraignore` brings back a file or folder that `.gitignore` excludes, with everything inside it; `.vera`, `.git` and `node_modules` stay ignored. The agent's file tools still read files that only `.gitignore` excludes.

Indexing runs in the background and follows changes: new, changed and deleted files are picked up automatically.

## Index status

The **Files** tab places the **Reindex** and **Collapse all** icon buttons beside search. Hover over an icon for its label. While indexing, a compact line shows completed and remaining files; it disappears after successful completion. The Reindex tooltip keeps the document and failure counts. Expand a failure count to see file names and reasons, and choose **Reindex** to retry the whole selection. Failures remain available when you reopen the tab. Each document also has its own status:

| Status | Meaning |
|---|---|
| **Indexed** | Searchable |
| **Pending** | Waiting to be indexed |
| **Failed** | Could not be read or processed; the reason is shown, for example **Size limit exceeded** |
| **Unsupported** | Not a supported type, or larger than the size limit (**Size limit exceeded**) |
| **Needs OCR** | A scanned PDF without a text layer; VERA does not run OCR |

PDF and Office files up to 100 MiB and text files up to 20 MiB are indexed. **Maximum file size (MB)** under **Edit workbench** → **Documents & RAG** lowers these limits for the workbench (1 MB = 1,048,576 bytes); it never raises them. Leave it empty to keep them. **Reindex** indexes the workbench again. If indexing stopped after repeated failures, select **Restart indexing**.

**Maximum indexed files** under **Edit workbench** → **Documents & RAG** (10,000 by default) guards against an unexpectedly large selection. When more documents are selected, indexing does not start: the **Files** tab shows the count, the ten folders with the most selected documents (subfolders included), **Index anyway** and **Edit exclusions**. Nothing is indexed, changed or removed meanwhile, and indexing never takes only part of the selection. **Index anyway** indexes all of them and remembers the count; a later selection up to 20 % larger keeps indexing, a larger one stops again. **Edit exclusions** opens **Documents & RAG** to narrow the selection.

The document count in **New workbench** and **Documents & RAG** is counted with the same rules as indexing (ignore files, file size and file count limits), so it matches what gets indexed. When the selection is above **Maximum indexed files**, the warning appears there before you save. Counting stops after 5 seconds on a very large folder; the count then reads "at least".

Under **Edit workbench** → **Indexing**, **Document search** sets the agent's defaults: **Results per search (1–20)** and **Search mode**: **Hybrid (keywords and meaning)**, **Keywords only** or **Meaning only**.

## The Files tab

The **Files** tab shows the whole workbench folder as a tree. Files ignored by VERA are shown in italics. The box **Search files and documents** filters the tree by file name and lists matching passages from indexed documents under **In documents**.

The menu of a file offers **Open**, **Attach as context**, **Open in** (the default app or another app), **Show in Explorer** (Finder or folder on other systems), **Copy** (absolute path, relative path or file name) and **Properties**, which includes the index status.

## Citations

In an answer, each citation chip names the source and the place: page, page range, slide, heading or line range. Select a chip to open the document at that place. A chip marked **Citation could not be verified** points to something VERA could not confirm, for example a page that does not exist or a file that changed since; treat that statement with care.

## The document viewer

Documents open as tabs next to the **Chat** tab, so the conversation stays where it was. You can switch between them freely.

Text files offer **Encoding** and **Word wrap**. UTF-8 and UTF-16 BOMs are detected; without a BOM, UTF-8 is used. Choose Windows-1252, ISO-8859-1, ISO-8859-2 or UTF-16 LE/BE when needed. Chromium decodes ISO-8859-1 using its Windows-1252 alias. **Show as text** displays invalid bytes as replacement characters. Find and Go to line use the original numbered source lines even when wrapped. These controls do not change the file, indexing or citation verification. With Display masking on, ordinary file text replaces secret bytes with asterisks (UTF-16 pairs appear as ⨪); names and rendered citation text use [REDACTED].

Large files are read in windows. The rightmost scrollbar selects a byte position; the inner scrollbar moves within the current text window. Ctrl+Home/End reaches the file start/end. Line numbers marked ≈ are estimates until progressive indexing settles them. Go to line first jumps approximately, then settles exactly. Find scans windows; Enter finds the next match, Shift+Enter the previous one, and **Cancel** stops the scan. Very long lines appear in bounded fragments marked …; scrolling continues into the next fragment. Find counts matching source lines and wraps at the ends. Large citations keep their verified source range.

- PDF files scroll continuously and show the page number. Zoom with Ctrl+mouse wheel or Ctrl+= , Ctrl+- and Ctrl+0.
- Ctrl+F finds text in a PDF or text document; in text files Ctrl+G goes to a line.
- Ctrl+Tab and Ctrl+Shift+Tab switch tabs, Ctrl+W closes the current tab, and Escape returns to **Chat**.
- A tab's menu offers **Close**, **Close others**, **Close to the right**, **Move left** and **Move right**. Tabs can also be dragged.

## Downloads

With **Web access** enabled, the agent can download a public file into `.vera/downloads/` of the workbench. In **Ask** and **Auto-edit** it asks first and shows the source address and the maximum size. A downloaded PDF gets an **Open PDF** card in the conversation and appears under **Downloaded files** in the **Files** tab. Downloads are not indexed automatically; to make one searchable, copy it into an indexed folder. See [Settings](settings.md) for web access and [Permissions](permissions.md) for approvals.

## Hex view

In a file's **Files** menu, choose **Show as Hex**. Each read-only row shows its physical offset, up to 16 hexadecimal bytes and printable ASCII; other bytes appear as dots. The final row can be shorter. The byte-position slider reaches any part of the file; the inner scrollbar moves through a bounded window.

**Go to offset** (Ctrl+G) accepts decimal bytes or a hexadecimal value prefixed with `0x`, from zero through the final byte. **Find** (Ctrl+F) searches **Hex bytes** such as `41 42 00 FF`, with optional spaces, or case-sensitive **UTF-8 text**. Enter finds the next occurrence and wraps at the end. Queries contain at most 4,096 bytes. **Cancel**, Escape or a new query stops an active scan; Escape closes the fields and returns focus to the bytes.

Click a byte to select it; drag or Shift-click to extend, including across windows. Arrow keys move the selection, Shift+arrows extend it, Page Up/Down move a screen, and Ctrl+Home/End reaches the start/end. **Copy as hex** (Ctrl+C) copies uppercase bytes separated by spaces. **Copy as text** (Ctrl+Shift+C) decodes UTF-8 with replacement characters. Copy is limited to 64 KiB per selection; choose a smaller range when the limit is exceeded. Display masking replaces secret bytes with `2A` (asterisks), and Find and copy use those same masked bytes. Read errors offer **Retry**.

## View modes

Choose **Rendered**, **Text** or **Hex** in the file toolbar. Rendered is available for indexed PDF, Markdown, HTML and supported Office formats. Unindexed or ignored Markdown and HTML open as Text; unavailable rendered binary formats open as Hex. These defaults do not overwrite your saved choice. Binary and unknown files open in Hex automatically. Choose Text explicitly for an unknown format; encoding and replacement controls remain available. Your mode choice is remembered for files with the same extension, including after restarting VERA. Open in the default application remains in the file tab menu. Citations retain their verified view and range; artifacts, downloads and run logs keep their own viewers.

## Image preview

PNG, JPEG, GIF, WebP, BMP and SVG files open as **Rendered** without indexing. **Image zoom** starts at **Fit**, shrinking the image to the available space without enlarging small images; Fit follows panel size changes. Choose 25% through 400% to scale the original decoded image, then choose Fit again. SVG stays an image: scripts, links and external resources are inactive. **Text** and **Hex** stay available and your deliberate mode is remembered per extension.

Image bytes follow the current Display masking choice. Masking can make an encoded image undecodable; an unsupported or corrupt image also shows a safe error with **Retry**. Use Hex to inspect the returned bytes. Preview assembles bounded byte windows into a complete browser image resource, so encoded and decoded images still need memory proportional to their size and remain subject to browser decoder resources. No file-size cutoff is imposed.
