# Documents and search

VERA indexes the documentation of a workbench on your computer, so the agent can search it and cite the exact page, section or line it used. Indexing uses a local model and sends nothing over the network. When the agent reads a passage to answer you, that passage goes to your model provider like the rest of the conversation; with a local server such as LM Studio or Ollama it stays on your computer.

## What is indexed

The folders checked under **Edit workbench** → **Documents & RAG** are indexed, together with the include and exclude patterns under **Advanced: include and exclude patterns**. These file types are indexed:

- PDF
- Markdown, HTML and text (`.txt`, `.csv`, `.tsv`)
- Word, PowerPoint and Excel files in the modern formats (`.docx`, `.pptx`, `.xlsx`) and their OpenDocument counterparts (`.odt`, `.odp`, `.ods`)

Legacy `.doc`, `.ppt`, `.xls` and RTF files are not indexed; save them in a modern format. Files matched by `.vera/.veraignore`, and anything in `.vera`, `.git` or `node_modules`, are never indexed. Source code and logs are not indexed either; the agent reads them directly with its file tools.

With **Use .gitignore** checked (the default for new workbenches), files and folders that the workbench's `.gitignore` files exclude are not indexed either: the one in the workbench folder and those in its subfolders, each for its own folder, as in Git. A line starting with `!` in `.vera/.veraignore` brings back a file or folder that `.gitignore` excludes, with everything inside it; `.vera`, `.git` and `node_modules` stay ignored. The agent's file tools still read files that only `.gitignore` excludes.

Indexing runs in the background and follows changes: new, changed and deleted files are picked up automatically.

## Index status

The **Files** tab of the right panel shows the progress (**Index: … done, … pending, … failed**) and marks each document:

| Status | Meaning |
|---|---|
| **Indexed** | Searchable |
| **Pending** | Waiting to be indexed |
| **Failed** | Could not be read or processed; the reason is shown, for example **Size limit exceeded** |
| **Unsupported** | Not a supported type |
| **Needs OCR** | A scanned PDF without a text layer; VERA does not run OCR |

PDF and Office files up to 100 MiB and text files up to 20 MiB are indexed. **Reindex** indexes the workbench again. If indexing stopped after repeated failures, select **Restart indexing**.

Under **Edit workbench** → **Indexing**, **Document search** sets the agent's defaults: **Results per search (1–20)** and **Search mode**: **Hybrid (keywords and meaning)**, **Keywords only** or **Meaning only**.

## The Files tab

The **Files** tab shows the whole workbench folder as a tree. Files ignored by VERA are shown in italics. The box **Search files and documents** filters the tree by file name and lists matching passages from indexed documents under **In documents**.

The menu of a file offers **Open**, **Attach as context**, **Open in** (the default app or another app), **Show in Explorer** (Finder or folder on other systems), **Copy** (absolute path, relative path or file name) and **Properties**, which includes the index status.

## Citations

In an answer, each citation chip names the source and the place: page, page range, slide, heading or line range. Select a chip to open the document at that place. A chip marked **Citation could not be verified** points to something VERA could not confirm, for example a page that does not exist or a file that changed since; treat that statement with care.

## The document viewer

Documents open as tabs next to the **Chat** tab, so the conversation stays where it was. You can switch between them freely.

- PDF files scroll continuously and show the page number. Zoom with Ctrl+mouse wheel or Ctrl+= , Ctrl+- and Ctrl+0.
- Ctrl+F finds text in a PDF or text document; in text files Ctrl+G goes to a line.
- Ctrl+Tab and Ctrl+Shift+Tab switch tabs, Ctrl+W closes the current tab, and Escape returns to **Chat**.
- A tab's menu offers **Close**, **Close others**, **Close to the right**, **Move left** and **Move right**. Tabs can also be dragged.

## Downloads

With **Web access** enabled, the agent can download a public file into `.vera/downloads/` of the workbench. In **Ask** and **Auto-edit** it asks first and shows the source address and the maximum size. A downloaded PDF gets an **Open PDF** card in the conversation and appears under **Downloaded files** in the **Files** tab. Downloads are not indexed automatically; to make one searchable, copy it into an indexed folder. See [Settings](settings.md) for web access and [Permissions](permissions.md) for approvals.
