# Workbenches

A workbench is a project folder that VERA works in: sources, datasheets, schematics, logs and notes. VERA keeps its own data for the folder in a `.vera/` subfolder and does not move or convert your other files. Each workbench has its own sessions, document index, instructions and enabled plugins.

## Create a workbench

1. Select **New Workbench** in the sidebar.
2. Under **General**, select **Choose folder** and pick the folder. **Workbench name** is filled in from the folder name; change it if you like.
3. Under **Documents & RAG**, check the documentation folders VERA found, or select **Add folder…**. The preview line shows how many documents will be indexed. **Advanced: include and exclude patterns** lets you edit the patterns directly.
4. Optionally adjust the other sections (see the table below).
5. Select **Create a workbench** at the top right.

If the folder already is a workbench, VERA offers **Open this workbench** instead. An existing `.vera/WORKBENCH.md` is kept unchanged.

Use a folder on a local disk. Network shares are not supported.

## Open, recent and pinned workbenches

- **Open Workbench** opens a folder that already contains `.vera/workbench.yaml`.
- The sidebar lists your recent workbenches. Pinned workbenches stay at the top.
- Each row has a **Workbench actions** menu: **Pin** or **Unpin**, **Move up**, **Move down**, **Edit workbench**, **Open in Explorer**, **Close workbench** and **Remove from list**.
- **Remove from list** only removes the entry; no file is deleted.
- If a folder was moved or deleted, its entry shows **Folder missing**. Remove it from the list, or open the folder at its new place.
- **Show sessions** and **Hide sessions** expand or collapse the sessions of a workbench in the sidebar.

Select a workbench name to see its **Workbench overview**: the conversation model, the permission mode, the indexed and excluded sources and the sessions.

## Edit a workbench

Select **Edit workbench** on the overview or in the row menu. Change the sections, then select **Save** at the top right; **Cancel** discards your changes. If you leave with unsaved changes, VERA asks first.

| Section | What it sets |
|---|---|
| **General** | Name and description |
| **Documents & RAG** | Which folders and files are indexed |
| **Agent and chat** | Default model, default permission mode, **Detail level** |
| **Instructions** | The text of `.vera/WORKBENCH.md`, which the agent reads in every session |
| **Tools** | Which built-in tools the agent may use |
| **Skills** | Workbench and user skills: enable, create and edit them |
| **Indexing** | Embedding settings and the defaults of the agent's document search |
| **Plugins** | Which installed plugins this workbench enables |

Keep the instructions short and factual: the board, the MCU, the toolchain, conventions. Only the first 16 KB are given to the agent; VERA warns when the text is longer.

## Read-only workbenches

A workbench opens read-only when another VERA process already has it open, for example a second VERA installation. You can read sessions, browse and open files, and export sessions, but you cannot send messages or save settings. Close the other instance and open the workbench again to work in it.

## The .vera folder

| Item | Content |
|---|---|
| `workbench.yaml` | The workbench configuration; edit it through **Edit workbench** |
| `WORKBENCH.md` | The instructions for the agent |
| `.veraignore` | Optional rules for files that the agent and the index must not see |
| `skills/` | Skills of this workbench |
| `plugins/` | Plugin packages shared with the project |
| `vera.db` | Sessions, approvals, changes and the document index |
| `artifacts/`, `downloads/`, `runs/` | Session artifacts, downloaded files, program run logs |

`.vera/` contains a `.gitignore` that keeps only the configuration, instructions, `.veraignore` and skills under version control. The agent cannot change `workbench.yaml` or `.vera/plugins`, in any permission mode.

`.veraignore` uses the same pattern syntax as `.gitignore`. The folders `.vera`, `.git` and `node_modules` are always ignored.
