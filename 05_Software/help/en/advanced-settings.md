# Advanced settings

Advanced settings tune limits that most people never need to change. They are hidden until you turn on **Show advanced settings** in **Settings** → **Advanced**. Turning the switch off only hides them: values you already set keep applying.

## Where they are

- **Settings** → **Advanced**: values for the whole application.
- **Edit workbench** → **Advanced**: values for one workbench, saved with the workbench. They are kept in `.vera/workbench.yaml`.
- The session menu (**…** next to a session) → **Advanced settings**: values for one conversation. **Save** keeps them with the session, and they survive a restart; **Cancel** closes without changes.

## Which value applies

A session value wins over a workbench value, which wins over the application value, which wins over the built-in default. An empty field inherits; it shows the inherited value and where it comes from, for example "50 (default)". **Reset** clears the value at that level. A workbench or session value may be higher or lower than the application value.

A value outside a setting's range is refused when you enter it. A value edited by hand in a file and out of range is ignored, and the next level applies.

## When a change applies

The icon next to each setting names when a change takes effect: right away, for the next terminal, worker, run or opened session, after reindexing, after reopening the workbench, or after restarting VERA.

## Settings

Each setting appears only at the levels listed. A switch offers **Inherit**, **On** and **Off**; **Inherit** shows the inherited state, for example "On (default)". **Rows per page** offers **Inherit**, 10, 20 and 50.

| Setting | Levels | Range | Default | Applies |
|---|---|---|---|---|
| Tool calls per turn | application, workbench, session | 10–500 | 50 | Right away |
| Model no-output timeout (s) | application, session | 30–3600 | 300 | Right away |
| Hosted header wait (s) | application | 10–300 | 30 | Right away |
| Background compaction | application, workbench | On / Off | On | Right away |
| Compaction trigger (%) | application, workbench | 50–95 | 80 | Right away |
| Recent history kept verbatim (tokens) | application, workbench | 0–100000 | 20000 | Right away |
| Summary tool-result size (characters) | application | 500–8000 | 2000 | Right away |
| Summary passes per request | application | 1–10 | 5 | Right away |
| Calibration margin (%) | application | 100–150 | 110 | Right away |
| Use provider token counts | application | On / Off | On | Right away |
| Delegated sessions at once | application | 1–8 | 3 | Right away |
| Concurrent turns | application | 1–16 | 3 | Right away |
| Automatic compaction | session | On / Off | On | Right away |
| Tool result size (characters) | application | 8000–128000 | 32000 | Right away |
| Read window (lines) | application | 500–10000 | 2000 | Right away |
| Read output size (characters) | application | 10000–120000 | 30000 | Right away |
| Grep results | application | 50–2000 | 500 | Right away |
| Grep file size (MiB) | application | 1–50 | 5 | Right away |
| Glob results | application | 100–5000 | 500 | Right away |
| Worker deadline (s) | application | 5–120 | 10 | For the next terminal, worker, run or opened session |
| Web search results | application | 1–8 | 5 | Right away |
| Web read size (characters) | application | 1000–16000 | 12000 | Right away |
| Web request timeout (s) | application | 5–120 | 30 | Right away |
| Download size (MiB) | application | 10–1000 | 100 | Right away |
| Download time limit (s) | application | 30–1800 | 120 | Right away |
| Background programs per session | application | 1–16 | 4 | For the next terminal, worker, run or opened session |
| Run logs kept | application | 20–2000 | 200 | Right away |
| Run log size (MiB) | application | 8–1024 | 64 | Right away |
| Program timeout ceiling (s) | application, workbench | 60–3600 | 600 | Right away |
| Shell command timeout ceiling (s) | application, workbench | 60–3600 | 600 | Right away |
| Maximum text file size (MiB) | workbench | 1–64 | 20 | After reindexing |
| Volume warning: files | application, workbench | 500–100000 | 2000 | Right away |
| Volume warning: size (MiB) | application, workbench | 512–51200 | 2048 | Right away |
| Docs panel results | application, workbench | 10–100 | 20 | Right away |
| Document extraction time limit (s) | application | 30–1800 | 120 | For the next terminal, worker, run or opened session |
| Indexing pause (ms) | application | 250–10000 | 1000 | Right away |
| Embedding worker idle time (s) | application | 10–600 | 60 | For the next terminal, worker, run or opened session |
| Terminals per workbench | application | 1–16 | 8 | For the next terminal, worker, run or opened session |
| Terminal buffer (Ki characters) | application | 64–1024 | 256 | For the next terminal, worker, run or opened session |
| Terminal scrollback (lines) | application | 1000–50000 | 3000 | For the next terminal, worker, run or opened session |
| Terminal output for the agent (characters) | application | 2000–64000 | 12000 | Right away |
| Update check interval (h) | application | 1–168 | 6 | Right away |
| Plugin catalog check interval (h) | application | 1–168 | 24 | Right away |
| Log retention (days) | application | 1–90 | 7 | Right away |
| Transcript rows first shown | application | 20–200 | 40 | For the next terminal, worker, run or opened session |
| Transcript rows per load | application | 50–500 | 100 | For the next terminal, worker, run or opened session |
| Rows per page | application | 10, 20, 50 | 10 | Right away |

**Tool calls per turn** is how many tool calls one agent turn may make. When the limit is reached, the turn stops and says so; send another message to continue.

**Model no-output timeout** is how long a hosted model may send nothing before the request ends with a timeout; raise it for slow reasoning models. **Hosted header wait** is how long VERA waits for a hosted provider to start answering. A custom endpoint uses its own **Response timeout** for both.

**Context compaction.** When a conversation fills more than the **Compaction trigger** of the model's input budget, VERA summarizes the earlier history and keeps the most recent part word for word (**Recent history kept verbatim**, at most a fifth of the budget). With **Background compaction** on, the summary runs right after a turn; with it off, the next message summarizes first, when needed. **Summary tool-result size** and **Summary passes per request** limit how much of each tool result a summary carries and how many summaries one request may make. With **Automatic compaction** off, a session sends its full history until it no longer fits; the turn then stops at the context limit.

**Token counting.** VERA counts a request with the ratio the provider reported for earlier requests, plus the **Calibration margin**: 110 counts 1.1 times. Raise the margin when context-limit errors appear. Turn **Use provider token counts** off when a provider reports wrong usage; VERA then counts with its conservative estimate.

**Delegated sessions at once** is how many delegated sessions may run at the same time. A further one is refused until one finishes.

**Concurrent turns** is how many agent turns may run at the same time across all open workbenches, delegated sessions included. A turn waiting for your approval counts until it ends. At the limit, a new message is not sent and stays in the message box with its attachments; once a turn ends, VERA shows that a turn can start and you send it again. A message to a session whose turn is running joins that turn and is always accepted. A delegated session started at the limit is refused at once. Lowering the value stops no running turn; it applies to the next message.

**Documents.** **Maximum text file size** limits text documents; PDF and Office files use **Maximum file size** in **Documents & RAG**, which raises or lowers their limit up to 500 MB. Changing either indexes the affected documents again. **Volume warning** sets when the Documents preview warns about a large selection. **Docs panel results** is how many hits a Docs panel search lists. **Document extraction time limit** is the base time to read a PDF or Office document (large PDFs get more), downloaded PDFs included. **Indexing pause** is how long indexing waits after a change, and **Embedding worker idle time** how long an unused embedding worker is kept.

**Desktop.** **Terminals per workbench** limits the open terminals; lowering it closes none, but a new one is refused while the limit is reached. **Terminal buffer** is how much output each terminal keeps, read when it opens, and **Terminal scrollback** how many lines its view scrolls back. **Terminal output for the agent** is how much of a terminal's latest output one agent read returns; the **Tool result size** still bounds it. **Update check interval** and **Plugin catalog check interval** set how often VERA checks; a saved change starts the new wait without checking at once. **Log retention** is how many daily log files VERA keeps. **Transcript rows first shown** and **Transcript rows per load** set how many of the newest messages a conversation shows at once when it opens, and how many older ones it then adds at a time in the background until all are shown. **Rows per page** is where lists start; a size picked in a list stays for that list.

**Tools, programs and web.** **Tool result size** bounds every tool result the model receives; a size below the **Read output size** also shortens reads. **Read window**, **Grep results**, **Web search results** and **Web read size** are both the amount used when the agent asks for none and the most it can ask for. Grep skips files larger than **Grep file size**. **Worker deadline** bounds each text search or log analysis; one already running keeps its deadline. **Download size** is shown in the download approval and stays bound to it: a later change does not alter an approved download, and a larger file stops with "Download exceeds the size limit." **Download time limit** bounds the transfer; reading the text of a downloaded PDF keeps its own deadline. **Program timeout ceiling** applies to plugin programs whose plugin sets no timeout of its own; **Shell command timeout ceiling** caps every foreground shell command and is shown in its approval. **Background programs per session** limits background runs of one conversation; a further one is refused as busy.

## Compact now

**Compact now** in a session's **Advanced settings** summarizes the earlier history at once, without waiting for the trigger and also while automatic compaction is off. It is available while the session is idle; an archived session or a read-only workbench refuses it. The dialog shows the result, for example "History summarized."

## Command line

`vera run` accepts the session-level settings for one run: `--advanced toolCallsPerTurn=100`, `--advanced noOutputTimeout=900` or `--advanced autoCompaction=off`. A switch takes `on`, `off`, `true` or `false`. These values apply to that run only and are not saved with the session. Repeat the option for several settings. An unknown setting, a setting that is not a session setting, or a value out of range stops with a usage error.
