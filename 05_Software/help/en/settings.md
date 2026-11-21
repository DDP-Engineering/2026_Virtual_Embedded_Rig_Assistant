# Settings

**Settings** at the bottom of the sidebar opens the application settings. They apply to all workbenches; settings of one workbench are under **Edit workbench** (see [Workbenches](workbenches.md)). Changes on a page are kept as a draft until you press **Save** at the top right; **Cancel** drops them. Appearance changes show on screen at once, before you save. If you leave a page with unsaved changes, VERA asks whether to discard them or stay. **Back to workbenches** returns to your work.

| Page | What it sets |
|---|---|
| **Providers** | AI model access; see [Providers and models](providers.md) |
| **Web access** | Web search and reading for the agent |
| **Appearance and language** | Language, theme and text sizes |
| **Commands** | The shell for agent commands and new terminals |
| **Notifications** | Not available yet |
| **Keyboard shortcuts** | Your own key combinations |
| **Updates** | How VERA updates itself |
| **Data & privacy** | Masking defaults for four areas |
| **About** | Version, runtime, license and third-party components |
| **Dictation** | Local Whisper models and spoken language |

## Data & privacy

Choose whether stored secrets are replaced with `[REDACTED]` in **Display**, **Program runs**, **Agent and model**, and **Artifacts and exports**. Display and Program runs are off by default; Agent and model and Artifacts and exports are on. Only stored secrets known to VERA are masked; other sensitive text is not detected automatically. Provider errors, connection tests and diagnostic logs keep their unconditional protection.

Use **Save** or **Cancel** at the top right. A switch changes only the draft until Save. Turning **Agent and model** off asks for confirmation: stored secrets found in files or tool output can reach the model provider. Cancelling or pressing Escape preserves the previous choice. The other areas do not ask.

Under **Edit workbench → Data & privacy**, each area has **Default**, **On** or **Off**. Default shows the current app value and follows later app changes; explicit choices belong to that workbench and travel with its configuration. Choosing Default also asks for confirmation if it turns Agent and model off. New workbenches inherit the app values unless you choose otherwise. Read-only workbenches cannot save changes.

Disabling masking cannot recover content already saved as `[REDACTED]`, including session history and artifacts. Read or recreate it from the original source. Previously saved raw history is not erased by enabling masking.

## Appearance and language

- **Interface language**: **System**, **English**, **Română**, **Deutsch** or **Français**. **System** uses your operating system's language when it is one of these four, and English otherwise. Dates and numbers follow the interface language, and Help is shown in it too.
- **Theme**: **Light**, **Dark** or **System**.
- Three separate text sizes, each from **Extra small** to **Largest**, with a preview:
  - **Interface text size**: menus, labels, buttons and the layout around them.
  - **Conversation text size**: the messages of a session.
  - **Code and output text size**: code blocks, tool output and file contents.
- **Restore default text sizes** sets all three back to their defaults.

## Keyboard shortcuts

The page lists every command with its key combination. You can add, change or remove combinations; **Restore default** and **Restore all defaults** undo your changes. Combinations use Ctrl, optionally with Alt or Shift, and a letter, digit, comma or slash; VERA refuses combinations that are reserved or already assigned. The default list is on [Keyboard shortcuts](shortcuts.md).

## Updates

- **Update mode**: **Off**, **Notify** or **Download automatically**. With **Notify**, VERA tells you about a new version and downloads it only when you select **Download update**.
- **Channel**: **Stable** or **Beta (includes stable)**.
- **Check now** checks at once, also when the mode is **Off**. Otherwise VERA checks at start and every six hours, or at the **Update check interval** in [Advanced settings](advanced-settings.md).

When an update is downloaded, select **Restart to update**. VERA waits until all running turns and pending approvals have finished. Every update is verified before it is installed, and VERA never installs an older version.

The portable version only announces updates: open the download link, then replace the application folder. A Linux `.deb` installation is updated through your package manager.

**Off** also stops the daily plugin catalog check; **Check for updates** on the **Plugins** page still works.

## Web access

Web access lets the agent search the public web, read public pages and download public files. It is enabled by default, with Exa in anonymous mode.

1. Check or clear **Enable web access**.
2. Choose the **Search provider**: Exa, Tavily or Brave.
3. Choose the **Access mode**: **Anonymous — no account required**, or **Use my API key** and enter the key. Brave always needs a key and only searches; it cannot read pages.
4. Select **Save**, then **Test connection**.

Only the search text and the addresses the agent asks for leave your computer; VERA does not upload project files for a search. Anonymous use is subject to the provider's limits. Web results are treated as untrusted content, and the agent cites them with their public links; opening a link asks before your browser opens it.

Turning web access off also stops searches and downloads in progress. Individual workbenches can disable the web tools under **Edit workbench** → **Tools**.

### Interactive Browser

In **Settings → Web access**, select **Install browser runtime** to download and verify Chromium. You can cancel during installation or remove the installed runtime. Enable **Interactive Browser in VERA** and **Allow Interactive Browser in this workbench**. Both switches start off.

In Chat, enter the exact public origin, such as `https://example.com`, under **Public origin** and select **Grant access**. Include the scheme and any non-default port. Each chat owns its grants and browser window. Grant extra origins for redirects or resources individually.

Ask the agent to open and read a page or follow a link. Chat displays activity and the current authorized page. **Show browser** brings the tab forward. **Stop browsing** stops the active turn and cancels its outstanding browser operation. **Revoke access** and **Close browser** both release the temporary browser session and its grants. Closing the window, switching either setting off or removing the runtime also revokes access. Use the managed download tool for supported files.

## About

**About** shows the application version, platform, architecture, whether VERA runs as a portable version, the system locale, the runtime versions, the license and the list of third-party components with their licenses.

## Shell commands

In Settings → Commands, choose Automatic, PowerShell 7, Windows PowerShell, Cmd, Bash or Custom, then Save. Installed variants are detected from executable search paths and standard installation folders; unavailable variants are disabled. Custom accepts an executable name or absolute path. Automatic prefers PowerShell 7, Windows PowerShell, then Cmd on Windows; Linux prefers Bash, then sh. PowerShell uses noninteractive UTF-8 commands without profiles. Bash uses `-lc`; login profiles may adjust the environment. On Windows, Bash means native Bash such as Git Bash; the old WSL launcher is not selected. Cmd commands use `/d /s /c`, accept one line with `&` or `&&` to join commands, and built-in output uses the Windows code page. Use PowerShell or Bash when UTF-8 output is required. The setting applies to future agent commands and newly opened terminals; existing terminals keep their current shell. An explicitly selected unavailable shell reports an error.

## Dictation

Choose **Whisper Small** (recommended) or **Whisper Base** (compact). The page shows the download size and installation status for each model. Choose **Download** and follow the progress. **Cancel** discards the partial download. If VERA reports a failed download or damaged files, choose **Retry**. Free disk space if the download needs more room.

Choose **Use model** after installation. VERA remembers your selection across restarts. **Remove** deletes that model’s files and clears the selection if it was active. If removal fails, close apps using the model files and choose **Retry**. Models are stored in VERA’s application data and shared across workbenches.

Under **Spoken language**, choose **Automatic detection** or select the language you plan to speak.

Choose **Push-to-talk** (the default) to hold the microphone button or its shortcut while you speak. Choose **Press to start or stop** to start and end recording with separate presses. Select **Add shortcut** in the Dictation tab to assign an app-local chord. The editor rejects reserved combinations and shortcuts already in use. You can use the microphone button with the shortcut unassigned.
