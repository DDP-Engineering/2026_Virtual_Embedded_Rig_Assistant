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
| **Interface** | **Right panel tabs** visibility |
| **Documents & RAG** | Which folders and files are indexed |
| **Agent and chat** | Default model, default permission mode, **Detail level** |
| **Instructions** | The text of `.vera/WORKBENCH.md`, which the agent reads in every session |
| **Tools** | General VERA tools: files, search, documents, planning, skills/help, terminal and generic execution |
| **Skills** | Workbench and user skills: enable, create and edit them |
| **Indexing** | Embedding settings and the defaults of the agent's document search |
| **Plugins** | Enabled plugins, their specialized tool allowances and programs, and shared electrical / automation tools |

Keep the instructions short and factual: the board, the MCU, the toolchain, conventions. Only the first 16 KB are given to the agent; VERA warns when the text is longer.

## Skills

Skills are reusable agent instructions, not commands. Open **Edit workbench > Skills** or **Skills** in the session’s **Instructions and skills** tab. **Enabled** makes instructions available to the agent in this workbench without running them. Activation saves immediately; closing the panel or cancelling other workbench edits does not undo it.

Select **Create skill**, enter a name using lowercase letters (a–z), digits and hyphens (1–64 characters), then choose **This workbench** or **All my workbenches**. The latter stores the skill in your current VERA user profile; it is not shared automatically with other users or installations. **Create and edit** opens a template: complete its description and procedure, then **Save**. **Cancel** abandons unfinished edits, not the already created skill.

Workbench and user skills offer **Edit instructions**. Official and plugin skills offer read-only **View instructions**. **Refresh list** reads the list again; **Retry** appears only after a failed operation and retries that operation. In a read-only workbench you can refresh and view instructions but cannot change skills. **Close** or Escape closes the dialog; Escape first abandons an open creation or instruction form.

## Right panel tabs

Open **Edit workbench > Interface > Right panel tabs**. Select which tabs to show: Instructions and skills, Files, Changes, Artifacts, Plan, Runs and Terminal. All are selected by default. **Restore defaults** selects all tabs in the draft; **Save** applies it and **Cancel** discards it.

Saving updates every session of this workbench immediately, including after reopening or restarting VERA. Other workbenches keep their own selection. Hiding the active tab selects the first remaining tab in the normal order. Hiding every tab closes the right panel and removes its usual open button. **Right panel tabs** remains available on the main page, and **Edit workbench** stays accessible from the overview and sidebar menu.

Arrow keys, Home and End visit only visible tabs. The terminal shortcut never reveals a hidden tab; it offers a link to these workbench settings instead. Hiding tabs only changes presentation: stored instructions, files, changes, artifacts, plans and history remain intact, agent tools still work, and running terminals and programs continue. Close is always available while the panel is displayed and is not a configurable tab.

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

## Additional folders

In **Edit workbench > General > Additional folders**, choose **Add folder** and select an absolute folder, for example a sibling repository. **Save** grants access; **Cancel** discards the selection. The overview lists the saved folders. Remove a folder and Save to revoke access immediately, including pending operations. Read-only workbenches cannot change these grants.

The ordinary read, list, glob, grep, write and edit tools and shell working directories can use these folders with the same Ask or Auto-edit approvals as the workbench. Give outside paths as absolute paths; relative paths still start at the main workbench. Outside sources use absolute identities without local document citations. Ignore rules still apply, and VERA application data is refused even through links. Adding folders does not index them: indexes, logs, artifacts and generated data stay in the main workbench. Commands retain OS account permissions and are not sandboxed.

## Data & privacy

Set Default, On or Off for each masking area, then Save or Cancel at the top right. Default shows and follows the app value; choices stay independent between workbenches. See [Data & privacy](settings.md) for the model-provider warning and saved-history limits.
