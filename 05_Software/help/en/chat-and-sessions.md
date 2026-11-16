# Chat and sessions

A session is one conversation with the agent inside a workbench. VERA saves every session in the workbench, so you can close the app and continue later. Several sessions can run at the same time.

## Start and manage sessions

- **New session** starts a conversation in the open workbench. If an unused empty session exists, VERA opens that one instead of creating another.
- The first message becomes the title. **Rename** sets your own title.
- **Search sessions** finds sessions by title and message text.
- Each session row shows the time of its last activity and has a menu with **Export Markdown**, **Export JSON**, **Rename**, **Move up**, **Move down**, **Archive** and **Delete**.
- A session shows its state: **Idle**, **Running**, **Awaiting approval** or **Error**.

## Write a message

Type in the message box (**Ask VERA about your project…**). Enter sends, Shift+Enter adds a line, and @ completes paths of workbench files. To give the agent a file, choose **Attach as context** on it in the **Files** tab; it appears as a chip above the message box.

Next to the message box you choose the **Model**, the **Reasoning level** and the **Permission mode** of this session. New sessions take the model and permission mode from the workbench settings.

## Steer or stop a running turn

While the agent works, you can keep typing and send more messages, for example "also check the errata". They show **Pending delivery** until the agent takes them in at its next step. While an approval card waits for your decision, sending is paused.

**Stop** ends the running turn. Escape also asks **Stop the running turn?**. Work that was already completed, such as applied file changes, stays.

## Detail levels

**Detail level** is set per workbench in **Edit workbench** → **Agent and chat**:

| Level | What the conversation shows |
|---|---|
| **Verbose** | Every tool call with its arguments and output, the model's reasoning, and token statistics under each of your messages |
| **Normal** | Routine tool calls grouped into an expandable **Operations** line |
| **Minimal** | Only the conversation; routine tool calls are hidden and a working indicator shows while the agent works |

Approvals waiting for you, errors and download cards are shown at every level; approvals the permission mode granted are hidden at **Minimal** and grouped at **Normal**. The level changes only the display; the saved session and its exports are always complete.

## Reasoning

For models that support it, **Reasoning level** offers **Default** and the levels the model declares, for example **Minimal**, **Low**, **Medium**, **High** or **Maximum**. Higher levels think longer before answering. For models without reasoning levels the control is hidden. You can change it during a turn; the new level applies to the next request. The reasoning text itself is shown only at **Verbose**.

## Long sessions and context

The context indicator shows **Context used** as a percentage of the model's context window; select it for usage and limits. When a session grows too long for the model, VERA summarizes older history (**Summarizing history…**). The full transcript stays saved and visible.

**Find in conversation** searches the current session. The marker lane at the left edge of the conversation has one marker per message of yours; point at a marker to preview the message and select it to jump there.

## Archive, delete and export

- **Archive** moves a finished session into **Archived sessions**; **Restore** brings it back. Nothing is lost.
- **Delete** removes the session and its artifacts after a confirmation. Files the agent downloaded stay in the workbench.
- **Export Markdown** writes a readable transcript with tool summaries, citations and applied changes; **Export JSON** writes the complete event record. Both open a save dialog and also work in read-only workbenches.

Saved message bookmarks stay in JSON exports; Markdown marks bookmarked user messages. Bookmarks are private to the session and are not sent to the agent.

## The right panel

**Toggle right panel** shows tabs for the open session: **Context** (workbench instructions and available skills), **Files**, **Changes**, **Artifacts** (text results the agent saved, with **Export** and **Reveal in folder**), **Plan** (the agent's task list) and **Runs** (program runs of plugins).

## Bookmarks

Hover over one of your messages or use Tab to reach its bookmark icon. Select **Bookmark** to mark it; the filled icon uses **Remove bookmark** to clear it. The rail preview shows the first line of your message and the start of the agent reply, with the same bookmark action. Changes appear immediately; a failed save restores the previous state and shows an error. Archived sessions and read-only workbenches allow viewing only.

Bookmarked rail markers are filled in the primary color and slightly longer. A grouped marker is marked when any message in it has a bookmark. Use **Next bookmark** (**Ctrl+Alt+N**) or **Previous bookmark** (**Ctrl+Alt+P**) to jump between marked messages; navigation stops at the first or last bookmark. Change these keys in **Settings → Keyboard shortcuts**.

## Shell commands

Use non-interactive flags: agent stdin is closed. Foreground commands return an exit code, the last 12,000 output characters and a full log in `.vera/runs`. Background commands return a handle; the agent polls `program_output`, using `until` for a readiness line, and ends them with `program_stop`. They survive a completed tool turn and stop with the session, app or the Bypass mode that started them. Output follows the Program runs secret-masking policy; local run logs keep the original output. The child inherits user environment variables without VERA provider keys or stored credential values. Commands are limited to 4,096 characters.
