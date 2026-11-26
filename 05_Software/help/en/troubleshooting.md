# Troubleshooting

## The agent does not answer

- Open **Settings** → **Providers** and select **Test** on the connection the session uses. The failing step tells you where to look; see [Providers and models](providers.md).
- **Cannot reach …**: the local server is not running, or the address or network is wrong.
- **Authentication failed**: enter the key again, or sign in with ChatGPT again.
- **The context limit was reached**: shorten the input, start a new session, or correct the context window of a custom connection.
- A turn that hangs can always be ended with **Stop**.

## The workbench is read-only

The message **This workbench is open read-only because another process or lock owns it.** means another VERA process has the workbench open. Close it, then open the workbench again. A workbench on a network share is not supported; move it to a local disk.

## The agent does not find something in the documents

1. Open the **Files** tab and look at the document's status.
2. **Needs OCR**: the PDF is a scan without text. Use a PDF with a text layer.
3. **Failed** or **Unsupported**: the reason is shown on the document and in **Properties**. Legacy `.doc`, `.ppt` and `.xls` files are not indexed.
4. The document is not marked at all: it is outside the indexed folders. Add its folder under **Edit workbench** → **Documents & RAG**, and check that neither `.vera/.veraignore` nor, with **Use .gitignore** checked, a `.gitignore` file excludes it.
5. Select **Reindex**. If indexing stopped, select **Restart indexing**.

See [Documents and search](documents-and-search.md).

## A citation could not be verified

The cited file changed or was removed after the answer, or the agent cited something it did not read. Ask the agent to look again.

## The agent does not use a plugin

- Is the plugin enabled for this workbench? Check **Edit workbench** → **Plugins**.
- Does its **Status** show **Ready**? Otherwise select **Check dependencies**, install what is missing, and complete its **Configuration**.
- In **Read-only** mode only safe commands run; commands rated **Blocked** never run. See [Permissions](permissions.md).
- **Not trusted on this machine** or **The plugin's files changed since it was reviewed; install it again.**: review and install the plugin again.
- A program does not behave as expected: open the **Runs** tab and select **Open log**.

See [Plugins](plugins.md).

## The plugin catalog is not shown

When the catalog cannot be reached or its signature does not match, the **Plugins** page shows the plugins bundled with VERA instead. Check the network and the **Catalog URL** under **Catalog settings**, or use **Use default**.

## Updates

- **Update deferred until all turns and approvals finish.**: finish or stop the running sessions.
- **The update feed could not be reached.**: check the network, then **Check now**.
- Portable and Linux `.deb` installations do not install updates themselves; see [Settings](settings.md).

## VERA closes right after starting

If `settings.json` is invalid, VERA shows its path and the affected settings in a startup dialog. Correct the file or move it aside to recreate the defaults, then set up your providers and preferences again.

## Logs

VERA writes one log file per day, `vera-YYYY-MM-DD.log`, in the `logs` folder of its data folder, and keeps the newest seven, or the number set as **Log retention** in [Advanced settings](advanced-settings.md). Keys and other known secrets are removed from the logs. Program output of plugins is not in these logs but in `.vera/runs/` of the workbench.

## Where VERA keeps its data

Application data is in one folder:

| Installation | Folder |
|---|---|
| Windows | `%APPDATA%\VERA\` |
| Linux | `~/.config/VERA/` |
| Portable | `data` beside `vera.exe` |

| Item | Content |
|---|---|
| `settings.json` | Preferences, provider connections without keys, recent workbenches |
| `credentials.json` | Keys and sign-in tokens, encrypted where the system allows |
| `logs/` | Daily log files |
| `plugins/` | Installed plugins and the programs VERA installed for them |
| `window-state.json` | Window size and position |

Everything that belongs to one project, such as sessions, the document index, artifacts, downloads and run logs, is in the workbench's own `.vera/` folder; see [Workbenches](workbenches.md).
