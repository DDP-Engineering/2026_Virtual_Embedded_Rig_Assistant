# Chat and sessions

## Open a cited frame in Wireshark

Select **Open frame … in Wireshark** in the agent’s reply, then select **Open in Wireshark**. Install Wireshark Desktop and TShark locally. VERA checks the cited saved PCAP or PCAPNG and opens a verified copy at the packet number in that file, including for a derived capture.

Leave **Display filter** empty to use the filter from the citation, if there is one. You can enter another offline display filter. If that filter hides the cited frame, VERA adds the frame to the filter and tells you. If the capture changed or is unavailable, inspect it again to get a new citation.

A session is one conversation with the agent inside a workbench. VERA saves every session in the workbench, so you can close the app and continue later. Several sessions can run at the same time. By default, at most four turns run at once across all open workbenches, or the **Concurrent turns** set in [Advanced settings](advanced-settings.md); a message sent at the limit stays unsent in the message box until a turn ends.

## Start and manage sessions

- **New session** starts a conversation in the open workbench. If an unused empty session exists, VERA opens that one instead of creating another.
- The first message becomes the title. Use **Rename** at any time, including during a turn.
- Select the **Search sessions** magnifier next to **New session** to find sessions by title and message text. Press **Esc** in the search field or select the magnifier again to restore the full list. Use the page controls below long lists to see more sessions.
- Each session row shows the time of its last activity and has a menu with **Export Markdown**, **Export JSON**, **Rename**, **Move up**, **Move down**, **Archive** and **Delete**.
- A session shows its state: **Idle**, **Running**, **Awaiting approval** or **Error**. A running session has a turning mark beside its time, and a session awaiting approval a shield.

## Sessions in other workbenches

Turns keep running when you open another workbench. A workbench row in the sidebar shows a mark with the number of its running and waiting sessions, also when the row is collapsed; a shield means a session awaits your approval. Select the mark (or focus it and press Enter) to list those sessions. Choose a session to open it in its workbench, where you can review its approval, or **Stop** to end only that turn. While turns run, **Workbenches** shows how many run and the **Concurrent turns** limit. At the limit, a new message stays in the message box: wait for a turn to finish or stop one in the sidebar, then send it again.

## Activity

Open **Activity** in the title bar to see running sessions, pending approvals and questions, and unread replies across workbenches. Use Tab to move through the view, Enter to open an entry, and Escape to close it. VERA asks before discarding unsaved edits. A waiting question opens at its card while it is still pending.

Unread replies are available with desktop alerts disabled. VERA keeps up to 100 successful replies from the current app run. Opening an unread reply marks it as read. **Mark all as read** clears unread replies and leaves running sessions and pending requests visible.

## Write a message

Type in the message box (**Ask VERA about your project…**). Enter sends, Shift+Enter adds a line, and @ completes paths of workbench files. To give the agent a file, choose **Attach as context** on it in the **Files** tab; it appears as a chip above the message box.

Next to the message box you choose the **Model**, the **Reasoning level** and the **Permission mode** of this session. New sessions take the model and permission mode from the workbench settings.

Paste or drop an image into the message box, or choose **Attach image** to pick a file. In Files, drag an image into the message box or choose **Attach image** from its menu. Remove an image with the button on its thumbnail. VERA keeps imported originals in the workbench. Images attached from Files stay at their existing paths.

Select a thumbnail in a sent message to open the image in the file viewer. If the image is missing, the message shows its saved workbench path.

By default, a message can include up to eight PNG, JPEG, GIF or WebP images, with a limit of 20 MiB per file. Change either limit under **Settings** → **Advanced** → **Images**. The provider can still refuse a request that exceeds its own limits. VERA scales the copy sent to an image-capable model to a maximum of 2048 pixels on its longest side and keeps the original file. A text-only model receives the paths. Compaction keeps older image paths as text notes. Session exports include those paths.

See [Providers and models](providers.md) for how VERA determines image support for your chosen model.

Ask the agent to inspect a workbench image by giving its relative path. With an image-capable model, the agent can use `view_image` to read PNG, JPEG, GIF or WebP files within the configured file size limit. The copy sent to the model is at most 2048 pixels on its longest side. The tool requires an allowed workbench path without links, including in Bypass. The result in session history records the path. **Edit workbench** → **Tools** shows the switch when the workbench’s default model accepts images.

The agent can reopen a composer image from this session using its saved path after you send it. It can inspect up to eight images in one step and keeps the eight most recent tool images in the current turn.

## Dictate a message

Choose a model in [Settings > Dictation](settings.md). In push-to-talk mode, hold the microphone button or its configured shortcut. With the button focused, hold Space or Enter. Release to transcribe. In start/stop mode, press the button or shortcut once to record and again to transcribe. Escape or Cancel dictation discards the recording or transcription and lets a running agent turn continue. Leaving the chat or losing window focus cancels dictation.

The result appears at the original caret or after the selected text. If you edited the draft while dictating, the result goes at the end. Existing text and attachments stay in the draft. Review the text and send it with Enter or Send.

## Steer or stop a running turn

While the agent works, you can keep typing and send more messages, for example "also check the errata". They show **Pending delivery** until the agent takes them in at its next step. You can keep editing the draft while VERA sends a message or waits for your approval. Send becomes available when the request is accepted or the approval is resolved. Drafts stay with their session when you switch views.

**Stop** ends the running turn. Escape opens **Stop the running turn?** with **Stop** focused. Press Enter to stop. Work that was already completed, such as applied file changes, stays.

## Answer a question

When VERA asks a question, select a choice or enter your own answer, then select **Submit answer**. Enter also submits a typed answer. You can type a text answer in the main message box and send it there. Answers accept up to 2,000 characters and no images. If your draft exceeds the limit or contains images, it stays in the message box for editing. The card marks any recommended choice. You can also select **Cancel question** to continue the turn with a cancellation, or stop the turn to end it. Open a waiting question from the activity menu in its workbench heading.

In the workbench’s **Agent and chat** settings, **Use recommended answers after a timeout** is off by default. Enable it to set a whole number from 1 to 1440 minutes. The card shows the deadline when a valid recommendation can be applied, and the transcript marks automatic answers. The timer keeps running with the window in the background or the view reloading. Any operation that needs approval still asks for it separately.

## Follow delegated sessions

When VERA delegates a task, the child appears indented under its parent in the session list, with the outcome of its latest delegated turn. Use the arrow before the parent to show or hide its children; VERA remembers this for the workbench. While the children are hidden, the parent row shows when one of them is waiting for you, failed or is running. Select a child to open its Chat tab and follow its transcript; opening a child from activity or a notification shows it in the list. To return to the parent, select its row above the children. **Move up** and **Move down** move a child among its siblings and a parent together with its children. A child whose parent is archived or not in the results is listed on its own.

To stop a running child, open it and use **Stop** in its composer. The parent can keep working. If approval is requested, use the approval card in that session. When you reopen either session after restarting VERA, the link and the outcome of the delegated turn are still available.

The parent agent can send follow-up instructions in the same child conversation and choose its model and reasoning for later turns. The transcript labels these messages **Parent agent instruction**. If the child is already working, an eligible follow-up waits for its next model request. Use the child’s approval card when a user decision is required.

The parent agent can check whether a follow-up is still queued and which child turn received it. If you stop the child before delivery, the queued instruction can carry over to the next turn. Stopping the child also requests an end to its background programs, including runs from earlier turns.

A new child starts in the parent’s current permission mode. A Bypass parent’s child starts in Auto-edit unless you enable **Allow Full Access for delegated tasks** in **Settings > Data & privacy** and confirm. The setting starts off and applies to future launches across your workbenches; turning it off keeps the modes of sessions already created. After launch, choose each session’s mode separately in its composer. To reduce a child’s access, change its mode in its own chat.

In a shared checkout, let one implementation child finish and verify its handover before starting the next.

A delegated session in Bypass follows the same rules as a direct Bypass session: shell commands, plugin programs and file changes run without asking, including remote publishing such as `git push`. Blocked programs, plugin installation reviews and trial plugins keep their own approvals. In Auto-edit, shell commands run automatically only when they match a user-saved workbench command prefix; other commands ask for your approval in the child’s chat.

## Detail levels

**Detail level** is set per workbench in **Edit workbench** → **Agent and chat**:

| Level | What the conversation shows |
|---|---|
| **Verbose** | Every tool call with its arguments and output, the model's reasoning, and, under each of your messages, the date and time you sent it and its token statistics |
| **Normal** | Routine tool calls grouped into an expandable **Operations** line |
| **Minimal** | Only the conversation; routine tool calls are hidden and a working indicator shows while the agent works |

Approvals waiting for you, errors and download cards are shown at every level; routine automatic approvals are hidden at **Minimal** and grouped at **Normal**. Device writes and irreversible plugin operations remain visible. The level changes only the display; the saved session and its exports are always complete.

Tool activity uses a short action description, the affected file, page or command, and its status. Expand it to read the result or exact command and working folder. **Technical details** contains the tool name, duration, original arguments and raw result; large stored excerpts can still be loaded in full. A nonzero program exit code is shown as an error, and background runs are labelled separately. Detail levels and approval requests keep their existing behavior. Plan-update operations show the actual task steps and their statuses when expanded; optional technical details stay separate.

## Reasoning

For models that support it, **Reasoning level** offers **Default** and the levels the model declares, for example **Minimal**, **Low**, **Medium**, **High** or **Maximum**. Higher levels think longer before answering. For models without reasoning levels the control is hidden. You can change it during a turn; the new level applies to the next request. The reasoning text itself is shown only at **Verbose**.

## Long sessions and context

The context indicator shows **Context used** as a percentage of the model's context window; select it for usage and limits. When a session grows too long for the model, VERA summarizes older history (**Summarizing history…**). Meanwhile the indicator spins and keeps the last percentage, which updates when the next request is ready. The full transcript stays saved and visible.

If the latest turn fails with a temporary provider error, select **Retry** to resend its message. On a context-limit error, use **Compact now** when available. When a turn reaches the output or tool-call limit, **Continue** starts another turn.

If the provider rejects the request because of its size, select **Change images and retry**, uncheck the attachments to remove, and select **Resend message**. The original attachments stay visible in the conversation.

**Find in conversation** searches the current session. Use Enter for the next match and Shift+Enter for the previous one. Sending a message or selecting **Jump to latest message** returns you to the end. The marker lane at the left edge of the conversation has one marker per message of yours; point at a marker to preview the message and select it to jump there.

## Archive, delete and export

- **Archive** moves a finished session into **Archived sessions**; **Restore** brings it back. Nothing is lost.
- **Delete** removes the session and its artifacts after a confirmation. Files the agent downloaded stay in the workbench.
- **Export Markdown** writes a readable transcript with tool summaries, citations and applied changes; **Export JSON** writes the complete event record. Both open a save dialog and also work in read-only workbenches.

Saved message bookmarks stay in JSON exports; Markdown marks bookmarked user messages. Bookmarks are private to the session and are not sent to the agent.

## The right panel

**Toggle right panel** shows tabs for the open session: **Instructions and skills** (workbench instructions and available skills), **Files**, **Changes**, **Artifacts** (text results the agent saved, with **Export** and **Reveal in folder**), **Plan** (the agent's task list) and **Runs** (program runs of plugins).

Select an edit in **Changes** to open its recorded diff in a tab beside Chat.

Ask the agent to find and reuse a saved text artifact in the same session, including after you reopen
it. To select a specific artifact, give its exact `artifact:...` reference.

## Open tabs

Use **Reopen last closed tab** beside Chat to recover a document or diff from the current session. Right-click a tab and choose **Pin tab** to keep it next to Chat and protect it from bulk closing. Choose **Search open tabs** to match a title or path, then click a result or use the arrow keys and Enter.

From an open tab’s menu, choose **Show beside Chat** to read it on the right while the conversation stays on the left. Select another open tab to switch the right pane. Drag the divider or focus it and use the arrow keys to resize. **Exit split view** restores a single pane and keeps the tabs open. In a narrow window, use the tab strip to switch between them.

## Plan feedback and review

Choose **Open plan** in Chat to see the current plan and its steps. A plan decision uses the question card in Chat. If you are away from the session, the notification or the entry in **Activity** opens that session and its **Plan** tab.

In **Plan**, choose **Add comment** for a whole step, or select text in one step before choosing it to quote that fragment. Keyboard users can select with Shift and the arrow keys in **Step text**, then choose **Use selected text**; **Entire step** clears the fragment. Empty steps accept whole-step comments only. Enter multiline feedback, for example “Check voltage before flashing”, and choose **Save draft**. Saving does not send a message or start the agent. Cancel or Escape discards unsaved edits and returns focus to Plan.

Draft and submitted counts open the comments for that exact step. **Edit feedback** changes text only; **Delete feedback** removes a draft. Every plan replacement makes earlier anchors stale, even if some text is unchanged. **Needs re-anchor** keeps those drafts readable: choose **Re-anchor**, select a numbered current step, explicitly choose its whole text or a fragment, then **Save re-anchor**. Saved drafts survive closing or switching sessions.

**Review plan** sends the whole current plan and all current, valid drafts as one request in the same chat. The agent can revise the structured plan or ask for clarification, but cannot execute steps, change project files, run programs or commands, or grant permissions during this review. Sending ordinary chat is disabled until it finishes; **Stop** ends only the review, not independent background programs. Read-only permission mode still permits plan revision; archived sessions and read-only workbenches permit viewing only.

**Previous reviews** retains submitted comments, quoted context and outcomes, even after the plan is cleared. If submission fails, drafts stay available. **Retry review** confirms an unknown acknowledgement using the original request, without creating a second review. After a failed, stopped or context-limited accepted review, **Restore feedback** stages missing retry drafts without overwriting edited drafts or changing history. Chat **Retry** does the same. Re-anchor stale drafts and choose **Review plan** again explicitly; restoration never sends a request automatically. Existing conversation context limits still apply.

Privacy or model changes refresh displayed content. An open editor keeps unsaved feedback but hides its old captured quote; explicitly select a current target again before saving a new comment or re-anchor.

## Bookmarks

Hover over one of your messages or use Tab to reach its bookmark icon. Select **Bookmark** to mark it; the filled icon uses **Remove bookmark** to clear it. The rail preview shows the first line of your message and the start of the agent reply, with the same bookmark action. Changes appear immediately; a failed save restores the previous state and shows an error. Archived sessions and read-only workbenches allow viewing only.

Bookmarked rail markers are filled in the primary color and slightly longer. A grouped marker is marked when any message in it has a bookmark. Use **Next bookmark** (**Ctrl+Alt+N**) or **Previous bookmark** (**Ctrl+Alt+P**) to jump between marked messages; navigation stops at the first or last bookmark. Change these keys in **Settings → Keyboard shortcuts**.

The **Bookmarks** tab of the right panel lists this conversation's bookmarks in order, each with the start of your message and of the reply. Turn it on in **Edit workbench > Interface > Right panel tabs**. Type in **Filter bookmarks** to match message or reply text; the count then shows matches out of the total. Select a row or press Enter to jump to that message in Chat; the arrow keys move between rows. Select rows (or **Select all** for the filtered rows) and choose **Remove selected**, or remove one row with its trash icon. **Clear all** removes every bookmark of the conversation after you confirm, whatever the filter shows. Removing a bookmark never deletes a message; if removal fails, nothing changes and an error appears. Archived sessions and read-only workbenches allow filtering and jumping only.

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

Agent and model masking applies to tool results sent to the provider, streamed answers, session search and session presentation. Masking checks the file path as text. Image pixels are outside its scope. Artifacts and exports independently controls saved artifact content and descriptions, artifact exports and JSON/Markdown session exports. Both default on; an explicit workbench choice overrides the live app default. Turning Agent and model off permits stored secrets found in files or tool output to reach the provider. Program runs and Display choices do not change these rules. Provider errors, connection tests and diagnostic logs always mask stored credentials. Terminal reads still require consent for that specific terminal. Masking cannot recover text already saved as [REDACTED]; use a new read or recreate the artifact from its original source.
