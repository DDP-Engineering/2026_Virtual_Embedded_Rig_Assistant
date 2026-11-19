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

Tool activity uses a short action description, the affected file, page or command, and its status. Expand it to read the result or exact command and working folder. **Technical details** contains the tool name, duration, original arguments and raw result; large stored excerpts can still be loaded in full. A nonzero program exit code is shown as an error, and background runs are labelled separately. Detail levels and approval requests keep their existing behavior. Plan-update operations show the actual task steps and their statuses when expanded; optional technical details stay separate.

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

**Toggle right panel** shows tabs for the open session: **Instructions and skills** (workbench instructions and available skills), **Files**, **Changes**, **Artifacts** (text results the agent saved, with **Export** and **Reveal in folder**), **Plan** (the agent's task list) and **Runs** (program runs of plugins).

## Plan feedback and review

In **Plan**, choose **Add comment** for a whole step, or select text in one step before choosing it to quote that fragment. Keyboard users can select with Shift and the arrow keys in **Step text**, then choose **Use selected text**; **Entire step** clears the fragment. Empty steps accept whole-step comments only. Enter multiline feedback, for example “Check voltage before flashing”, and choose **Save draft**. Saving does not send a message or start the agent. Cancel or Escape discards unsaved edits and returns focus to Plan.

Draft and submitted counts open the comments for that exact step. **Edit feedback** changes text only; **Delete feedback** removes a draft. Every plan replacement makes earlier anchors stale, even if some text is unchanged. **Needs re-anchor** keeps those drafts readable: choose **Re-anchor**, select a numbered current step, explicitly choose its whole text or a fragment, then **Save re-anchor**. Saved drafts survive closing or switching sessions.

**Review plan** sends the whole current plan and all current, valid drafts as one request in the same chat. The agent can revise the structured plan or ask for clarification, but cannot execute steps, change project files, run programs or commands, or grant permissions during this review. Sending ordinary chat is disabled until it finishes; **Stop** ends only the review, not independent background programs. Read-only permission mode still permits plan revision; archived sessions and read-only workbenches permit viewing only.

**Previous reviews** retains submitted comments, quoted context and outcomes, even after the plan is cleared. If submission fails, drafts stay available. **Retry review** confirms an unknown acknowledgement using the original request, without creating a second review. After a failed, stopped or context-limited accepted review, **Restore feedback** stages missing retry drafts without overwriting edited drafts or changing history. Chat **Retry** does the same. Re-anchor stale drafts and choose **Review plan** again explicitly; restoration never sends a request automatically. Existing conversation context limits still apply.

Privacy or model changes refresh displayed content. An open editor keeps unsaved feedback but hides its old captured quote; explicitly select a current target again before saving a new comment or re-anchor.

## Bookmarks

Hover over one of your messages or use Tab to reach its bookmark icon. Select **Bookmark** to mark it; the filled icon uses **Remove bookmark** to clear it. The rail preview shows the first line of your message and the start of the agent reply, with the same bookmark action. Changes appear immediately; a failed save restores the previous state and shows an error. Archived sessions and read-only workbenches allow viewing only.

Bookmarked rail markers are filled in the primary color and slightly longer. A grouped marker is marked when any message in it has a bookmark. Use **Next bookmark** (**Ctrl+Alt+N**) or **Previous bookmark** (**Ctrl+Alt+P**) to jump between marked messages; navigation stops at the first or last bookmark. Change these keys in **Settings → Keyboard shortcuts**.

## Shell commands

Use non-interactive flags: agent stdin is closed. Foreground commands return an exit code, the last 12,000 output characters and a full log in `.vera/runs`. Background commands return a handle; the agent polls `program_output`, using `until` for a readiness line, and ends them with `program_stop`. They survive a completed tool turn and stop with the session, app or the Bypass mode that started them. The local Runs view follows the Program runs secret-masking policy; local run logs keep the original output. The child inherits user environment variables without VERA provider keys or stored credential values. Commands are limited to 4,096 characters.

Command approvals and saved command prefixes are described in [Permissions](permissions.md); folders outside the workbench in [Workbenches](workbenches.md).

## Commands in Runs

Open **Runs** in the right panel to see the actual command, working folder, live output, exit code and duration. **Stop** ends the whole process tree; the agent sees it stopped on its next output read. For finished runs, **Open log** opens the retained log in the text viewer, including output beyond the live tail; a log over 8 MiB shows its last 8 MiB. The current session is selected by default; choose **All sessions** for other runs. Plugin runs keep their declared program labels. Program runs masking defaults off. When on, it masks stored secrets in arguments, commands, folders, errors, output and program statuses. The workbench choice overrides the app default. Changes refresh open logs, including full logs in the viewer; local logs retain original text.

## User terminal

Open **Terminal** in the right panel or press **Ctrl+Shift+T**. The interactive shell starts in the workbench folder, using Settings → Commands. Create and close tabs with **New terminal** and **Close terminal**; resize the panel to reflow output. Interactive programs accept your typing. Agent session stops leave user terminals running; closing or replacing the workbench, or quitting VERA, closes them. Native terminal support is bundled.

Chat replies and code blocks have separate Copy actions. Run is available for completed, explicitly labelled PowerShell or Bash blocks with 1–16,384 characters and no terminal control characters. It dispatches only to an unused clean shell whose initial empty prompt is verified before execution. Only eligible destinations are offered; if none qualify, Run creates a clean terminal immediately. If a destination receives input or runs a command after selection, VERA refuses injection and offers **Run in a new clean terminal** instead. Your pending input and interactive programs stay untouched. Clean terminals skip shell profiles; normal terminals opened with **New terminal** still use your configured shell startup. When selecting a destination, **New clean terminal (no shell profile)** creates a separate compatible shell. Cancel or Escape returns keyboard focus to Run.

Every terminal starts private. To let the agent read one, see [Permissions](permissions.md).

## Secret masking for the agent and exports

Agent and model masking applies to tool results sent to the provider, streamed answers, session search and session presentation. Artifacts and exports independently controls saved artifact content and descriptions, artifact exports and JSON/Markdown session exports. Both default on; an explicit workbench choice overrides the live app default. Turning Agent and model off permits stored secrets found in files or tool output to reach the provider. Program runs and Display choices do not change these rules. Provider errors, connection tests and diagnostic logs always mask stored credentials. Terminal reads still require consent for that specific terminal. Masking cannot recover text already saved as [REDACTED]; use a new read or recreate the artifact from its original source.
