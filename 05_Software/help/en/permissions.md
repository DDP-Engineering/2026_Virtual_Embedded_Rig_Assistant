# Permissions

The permission mode decides what the agent may do without asking you: change files, download files and run plugin programs on your bench. Reading the workbench, searching documents and saving artifacts never need an approval.

## Choose a mode

Choose the mode with **Permission mode** next to the message box. It applies to that session and can be changed at any time, also during a turn. New sessions start with the workbench default from **Edit workbench** → **Agent and chat** → **Permissions**; a new workbench starts with **Ask**.

| Mode | File changes | Programs |
|---|---|---|
| **Read-only** | Not allowed; the agent has no write tools | Only commands rated **Safe** |
| **Ask** | Every change waits for your approval | **Device read** and **Device write** ask; **Irreversible** asks with a typed word |
| **Auto-edit** | Changes in the workbench are applied without asking; downloads still ask; files inside `.vera/` cannot be changed | **Device read** runs; **Device write** asks; **Irreversible** asks with a typed word |
| **Bypass — full access** | Reads and changes files anywhere your account has access, without asking | Everything except **Blocked** runs without asking |

Switching to a stricter mode cancels approvals the agent was given under the previous mode.

## Bypass

Each change to Bypass first asks you to confirm that the agent can read and change files and run programs in any folder your operating system account can access, including outside the workbench. Choose **Enable Bypass** to apply the change. **Cancel** or Escape keeps the previous mode. Every new change to Bypass asks again, including after restarting VERA; the selected mode remains marked in red. The same confirmation lists irreversible rules of enabled, issue-free plugins that are not trials.

VERA's application data folder, including settings, stored credentials, installed plugins and review records, is refused by agent filesystem tools in every mode, for reading as well as writing, including through path aliases. VERA continues to manage its own settings and plugins normally. Only enabled tools are available; OS permissions, tool limits and trial-plugin approvals still apply. The agent cannot change `.vera/workbench.yaml` or `.vera/plugins`.

Ordinary file tools can reach outside the workbench in Bypass. Program working directories, captured-log and register analysis and plugin drafts currently remain workbench-confined. The document index, artifacts, run logs and `.vera/` stay in the workbench.

## Approve or deny

When the agent needs your decision, an approval card appears in the conversation and the session shows **Awaiting approval**.

- For a file change, the card shows the file and a **Unified diff** of the change.
- For a download, it shows the source address and the maximum size.
- For a program, it shows the risk level, the **Plugin**, the **Command line**, the **Working directory**, the **Executable**, the **Rule notes** and the workbench files the command uses with their SHA-256.

Select **Approve** or **Deny**. **Approve and switch to auto-edit** approves and changes the session to **Auto-edit**. With the card focused, A approves and D denies.

For an irreversible command the card says that the change is permanent and names a word, usually the command, for example `burn-efuse`. Type that word, then approve. A word that does not match keeps the card waiting.

## Risk levels of programs

Each plugin rates its commands. VERA matches the exact command line against these rules before it runs anything.

| Level | Meaning |
|---|---|
| **Safe** | Reads nothing from a device and changes nothing, for example printing a version |
| **Device read** | Reads from a connected device, for example a chip ID or memory |
| **Device write** | Writes to a device, for example flashing or erasing |
| **Irreversible** | Changes a device permanently, for example burning eFuses or locking it |
| **Blocked** | Never runs, in any mode |

A command that matches no rule counts as **Device write**. When several rules match, the highest level applies. You can see the rules of a plugin before you install it, in its **Operations** section; see [Plugins](plugins.md).

## Review changes

The **Changes** tab of the right panel lists the files changed in the session, in order, with the number of added and removed lines. Select an entry to see its diff; **Reveal in folder** shows the file in your file manager. See also [Chat and sessions](chat-and-sessions.md).
