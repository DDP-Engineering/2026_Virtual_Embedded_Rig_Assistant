/** Official built-in skill; bundled as code so it is available offline and cannot be agent-edited. */
export const createPluginSkill = {
  name: "create-plugin",
  description:
    "Research a CLI and draft a VERA plugin with risk rules, validate it and request a reviewed trial installation.",
  body: `# Create a VERA plugin

1. Ask the user which operations matter and which CLI/version/platform they use.
2. Research the CLI manual with search_docs/read_doc, web_read/web_search, or read the files the user supplied. Cite the manual. Never invent flags, supported versions, device ports or offsets. If only --help is available, use that evidence and ask for missing operation details.
3. Write a draft in plugins/<id>/ with plugin.yaml, skills/<name>/SKILL.md and any scripts using write/edit under normal approvals. Installed plugins are immutable to the agent. Do not edit application settings, session modes or plugin enablement.

plugin.yaml format 1 example (replace every fixture value from the documented CLI):
\x60\x60\x60yaml
format: 1
id: fixture-cli
version: 1.0.0
name: Fixture CLI
description: Describe the documented operations and when to use them.
ecosystem: general
platforms: [windows-x64, linux-x64]
programs:
  fixture:
    install:
      find: { windows: ['%PATH%'], linux: ['$PATH'] }
      hint: Install the vendor CLI and put it on PATH; include its official link.
    version: { args: ['--help'], match: 'fixture (\\d+)' }
rules:
  - { match: 'fixture --help', risk: safe }
docs: []
\x60\x60\x60

Choose install pip, PEP 723 script (scripts/<file>.py), pinned HTTPS download with SHA-256, or find plus a user installation hint. Version match has exactly one capture group; bound a supported version range when documented. The program name must be the real entry point. Use argv arrays, never a shell or an arbitrary executable path.

Rules match the program plus the agent arguments. The highest matching risk wins; unmatched commands are device-write. Classify documented commands as safe (no hardware effects), device-read (may reset/halt), device-write (reflash can restore), irreversible (OTP/eFuse/protection or physical actuation/transmit), or blocked (interactive commands). Never lower a risk to avoid approvals; describe side effects in notes. Avoid broad low-risk wildcards covering unknown subcommands. Never test irreversible operations on real hardware.

4. Call plugin_validate {path: 'plugins/<id>'}. Fix schema errors. Review warnings about dangerous tokens in low-risk rules, missing rules and find without hint against the manual; warnings are not a safety certification.
5. Call plugin_install with the same path. VERA shows all manifest fields for the user's review, then installs only those bytes as trial. It does not activate or provision the plugin. Ask the user to enable it for this workbench and install any programs using the Plugins page. Every trial command requires approval, including in bypass; irreversible commands also require the typed word. Read-only refuses trial commands.
6. After the user enables it, use run_program for --help and documented fixture-safe commands. Fix only the workbench draft, validate and request another trial install. The agent cannot promote, enable, change permission mode or edit installed files. Only the user can press Promote to local; promotion trusts the rules as written.
7. The user can export a zip from Plugins. Follow CONTRIBUTING.md in the plugin catalog: document sources, supported platforms/versions, every command risk, tests without hardware, and hardware evidence/limitations. Catalog submission and publication need the user's separate instruction.
`,
} as const;
