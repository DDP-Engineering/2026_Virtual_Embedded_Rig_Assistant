# Planning

**VERA — Virtual Embedded Rig Assistant.** A desktop application in the style of Claude Code, Codex
and opencode, organised around a *virtual workbench*: a local folder that holds an electronics
project's documents and skills. The user chats with a model; the agent searches the documents,
reads and edits workbench files with the user's approval, searches the web on request and saves
session artifacts.

**Status:** milestones M0–M5, the plugin system and the ELEC, LAB and IOT plugin epics are
implemented. The architecture documents describe the implementation; where they disagree with the
code in `05_Software`, the code wins. Delivered plans and implemented ADRs were removed; their text is
in Git history.

| File | Read it for |
|---|---|
| [00-overview.md](00-overview.md) | Romanian summary for people: concept, what VERA does today, decisions, milestones, what comes next |
| [architecture/01-system.md](architecture/01-system.md) | laws, stack, processes (main, renderer, VERA Indexer, workers), IPC channels, module map, source layout, data locations, security baseline, network egress |
| [architecture/02-workbench.md](architecture/02-workbench.md) | workbench folder format, `.vera/` configuration and runtime, skills format, ignore and path rules, SQLite data model |
| [architecture/03-agent-and-tools.md](architecture/03-agent-and-tools.md) | agent runtime, context budget, steering and compaction, system prompt, tools (including web), path guard, permission modes including bypass, approvals, write queue, events, citations |
| [architecture/04-llm-providers.md](architecture/04-llm-providers.md) | OpenAI API, custom endpoints and LM Studio discovery, ChatGPT subscription, model selection, credentials, reasoning, timeouts |
| [architecture/05-knowledge-rag.md](architecture/05-knowledge-rag.md) | document selection and ingest in the VERA Indexer, extraction (PDF, Office, HTML, Markdown, text), chunking, keyword and vector index, hybrid search, references, viewer |
| [architecture/06-ui.md](architecture/06-ui.md) | layout and window chrome, screens, session components, appearance, viewer, languages, accessibility and shortcuts |
| [ui/README.md](ui/README.md) | historical layout A mockups and how the implemented UI differs |
| [plugins/ui-redesign.md](plugins/ui-redesign.md) | Plugins discovery/activation redesign (PLG-23…PLG-25, implemented 2026-11-11); [interactive HTML](ui/plugins-redesign.html) |
| [architecture/07-packaging-updates.md](architecture/07-packaging-updates.md) | package contents, targets, versions and channels, portable mode, updates, data format versions (migrations deferred until the first public release), signing |
| [architecture/08-quality.md](architecture/08-quality.md) | commands, test layers, fixtures and replay, release-package smoke and egress check |
| [decisions/README.md](decisions/README.md) | every architecture decision in one table: what was decided and why |
| [plan/README.md](plan/README.md) | open and delivered plans, work deferred by the user and proofs still open (hardware, native Ubuntu, release) |
| [plugins/README.md](plugins/README.md) | plugins for embedded tools (decisions accepted 2026-11-01): format, risk rules, provisioning, catalog, ESP32 pack, work packages PLG-01…18; supersedes the wrapper and serial seams and laws L3 (shell part) and L5 |
| [capabilities/README.md](capabilities/README.md) | analysis capabilities CAP-01…04 (rewritten 2026-11-01): parse_log and decode_register tools, firmware-comparator and test-planner skills in the analysis-skills plugin; Gitea epic #75 |
| [optional-companions.md](optional-companions.md) | optional desktop pets proposal (not implemented) |
