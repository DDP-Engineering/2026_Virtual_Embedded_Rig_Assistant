# Planning

**VERA — Virtual Embedded Rig Assistant.** A desktop application in the style of Claude Code, Codex
and opencode, organised around a *virtual workbench*: a local folder that holds an electronics
project's documents, skills and, later, tools. The user chats with a model; the agent searches the
documents, reads and edits workbench files with the user's approval, and saves session artifacts.

**Status:** planned 2026-10-09; nothing implemented yet.

| File | Read it for |
|---|---|
| [00-overview.md](00-overview.md) | Romanian summary for people: concept, scope, decisions, milestones |
| [architecture/01-system.md](architecture/01-system.md) | laws, stack, processes, IPC, module map, source layout, data locations, network egress |
| [architecture/02-workbench.md](architecture/02-workbench.md) | workbench folder format, skills format, `.vera/` runtime, data model |
| [architecture/03-agent-and-tools.md](architecture/03-agent-and-tools.md) | agent runtime, system prompt, internal tools, permissions and approvals, session events |
| [architecture/04-llm-providers.md](architecture/04-llm-providers.md) | OpenAI API, custom endpoints, ChatGPT subscription, credentials |
| [architecture/05-knowledge-rag.md](architecture/05-knowledge-rag.md) | document ingest, chunking, keyword and vector index, hybrid search, citations |
| [architecture/06-ui.md](architecture/06-ui.md) | screens, layout, themes, text size, languages, accessibility, future voice |
| [architecture/07-packaging-updates.md](architecture/07-packaging-updates.md) | self-contained packages, portable mode, update mechanism, migrations, signing |
| [architecture/08-quality.md](architecture/08-quality.md) | commands, test layers, fixtures, egress audit |
| [decisions/README.md](decisions/README.md) | architecture decision records |
| [plan/README.md](plan/README.md) | milestones M0–M5, work packages WP-01…38, dependencies, risks |
| [plan/benchpilot-reuse.md](plan/benchpilot-reuse.md) | which BenchPilot files each VERA module starts from |
