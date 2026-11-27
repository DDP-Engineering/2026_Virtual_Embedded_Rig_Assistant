# User terminals

## Routing

Select for right-panel Terminal, xterm/FitAddon, node-pty, interactive user input, terminal_read,
per-terminal consent, PTY lifecycle and packaged native helpers. Start at
`05_Software/src/apps/desktop/src/main/terminals.ts`; chat code-block dispatch adds
`terminal-command-prompt.ts`; focused tests are its sibling test, `terminal-command-*.test.ts`,
core `tools/terminal-read.test.ts`, shared `terminal-ipc.test.ts`, renderer `terminal-tab.test.ts`
and `tests/e2e/terminal.spec.ts`. Agent shell commands belong to [plugin program tools](plugins-program-tools.md);
general artifact construction belongs to [native packaging](native-packaging.md).

## Purpose and boundaries

Desktop TerminalService owns ephemeral user shells independently of agent sessions and ProgramRunner.
Core receives only TerminalReader; native loading, input, resize, consent and close remain in desktop
main. Renderer owns the xterm view and controls through strict user IPC. Shells use OS-account rights.

## Public interface

- `terminal.list/create/output/input/resize/close/consent` require the current workbench ID; targets
  use UUID terminal IDs. Create fixes cwd to the workbench and selects Settings → Commands' shell.
- Up to the resolved Terminals per workbench (application Advanced, 1-16, default 8, read at create) live/finished
  terminal tabs remain until close, workbench replacement or app shutdown; a lowered value closes none
  (REQ-FUNC-7509bd1e). Replacement means another workbench (another ID or folder, so a clone counts) takes the foreground or the foreground closes; a failed
  open or create and a reopen of the current workbench keep the terminals (main/index.ts replaceForeground). The renderer disables New at the same count; `terminal.list` and the agent read schema allow 16.
  Bash uses `-il`, sh `-i`, PowerShell `-NoLogo`; agent command flags and closed stdin are separate.
- Host capture retains at most the Terminal buffer the terminal had when it opened (64-1024 Ki characters,
  default 256 Ki, REQ-FUNC-240f4e02). It drops a cut leading line when a line break remains, and
  retains the tail of a line that fills the window. User snapshots follow the live Program runs choice, default off. With masking on,
  current known credentials are masked and split secret prefixes are held. The renderer appends
  snapshot deltas. Polls send the last output and masking revisions so unchanged captures skip projection
  and transfer, while the response still carries live terminal status. Masking revisions rebuild the visible
  scrollback so it reflects the current policy and newly known credentials.
  Plain projection keeps incomplete VT sequences pending so partial CSI/OSC/DCS cannot bypass
  known-secret prefix holding between callbacks.
- Agent recent output follows the live Agent and model choice independently of user runs masking.
  Publication rechecks the leases, refreshes bounded recent output and masks the complete captured
  window before taking the tail when on, preserving split-secret and partial VT prefix holding.
  Off uses the bounded clean OutputDecoder projection; raw authority stays in main. Finished user snapshots also
  resolve the live choice on every poll.
- `terminal_read {terminalId?}` lists only shared terminals when omitted; an ID returns at most the resolved
  Terminal output for the agent (2000-64000, default 12000) recent plain characters, capped by the session's
  resolved Tool result size passed to `publish(output, limit)` (REQ-FUNC-ef931b1f). The view's xterm scrollback is
  the resolved Terminal scrollback when it opens (1000-50000 lines, default 3000, REQ-UX-996ae06e). Consent starts false and applies to one terminal in its workbench.
- Grant epochs and current ownership are checked again by the runtime's synchronous publication hook.
  Revocation/close/switch refuses unpublished captures; already shared results remain in transcript history.
  Tool results retain the newest text and report `truncated:true` when the buffer, agent window or JSON limit cuts output.
- Chat code-block Run (`terminal.execute`) writes one line only into a pristine shell VERA started with a
  private random prompt marker, after the marker arrived and ownership was rechecked; input or close leaves it
  unverified for good, and a timeout (5 s) until the marker arrives (`chatActions.promptNotReady`). Bash gets `eval -- $'...'`. PowerShell's startup
  script branches on `$ExecutionContext.SessionState.LanguageMode`: Full Language prints the marker with
  `[Console]::Write`, reads with `[Console]::ReadLine` and the line is a base64 UTF-8 script block; any other
  mode prints a distinct `;constrained` marker with `Write-Host`, reads with `Read-Host`, and the line is
  `Invoke-Expression (-join [char[]](<UTF-16 code units>))`, which Constrained Language allows (REQ-PLAT-36fa33bf).
  A 16384-character block (about 98k characters of codes) runs through ConPTY. Restricted or No Language shows no
  marker and stays unverified.
- Ctrl+Shift+T opens/focuses Terminal and is editable in Keyboard shortcuts. Terminal input captures
  keys for the shell. Interface/help/release notes have en/ro/de/fr entries.
  Interactive paste checks 16,384 UTF-16 code units of text and forwards complete bracketed-paste delimiters.

## Invariants

- The agent port has no create, input, resize, consent or close capability, including in Bypass.
- Strict shared schemas bound IDs, dimensions and input; main-frame authorization remains authoritative.
- Workbench transitions suspend terminal authority throughout asynchronous replacement and invalidate
  in-flight creation. Close removes entries before process cleanup; shutdown suspends new authority.
- Linux cleanup enumerates `/proc` process groups in the PTY's dedicated session, sends TERM, rescans
  after 100 ms and escalates to KILL. Interactive job-control groups are included; foreign sessions
  are excluded, including residual jobs after the shell exits. Windows retains taskkill's
  descendant-tree cleanup for running shells and never signals stale finished-shell PIDs.
- The PTY factory starts Linux cleanup at shell exit and memoizes one promise for that lifetime.
  Later finished-tab close only awaits that promise; it never rescans a retired numeric session ID.
- Existing commandEnvironment filters inherited credentials; CredentialFile supplies masking and known
  secret prefixes. Formatting-split secrets use a safe plain projection. No sandbox is claimed.
- Core imports no Electron or node-pty. Packaged main requires the explicit physical
  `app.asar.unpacked/node_modules/node-pty` root so worker scripts load from the artifact.
- node-pty 1.1.0 uses Windows x64 N-API prebuilds and a host-built Linux x64 N-API binding. Packages
  retain shared/worker JS directories, native helpers and app-local Windows CRT; foreign builds are pruned.
- xterm 6.0.0/FitAddon 0.11.0 generated CSS uses a scoped CSSOM document adapter under unchanged CSP.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| PTY lifetime, ownership, masking, grants | main/terminals.ts, terminal-pty.ts, terminal-processes.ts, index.ts | terminals.test.ts; terminal-pty.test.ts; terminal-processes.test.ts; native terminal.spec.ts |
| Agent capability/publication | core/tools/terminal-read.ts, registry.ts, sessions/service.ts, agent/runtime.ts | terminal-read.test.ts; runtime.test.ts |
| IPC and keyboard contracts | shared/terminals.ts, ipc.ts, keyboard-shortcuts.ts | terminal-ipc.test.ts; bridge/router tests |
| View, consent and lifecycle | renderer/components/terminal-tab.tsx, lib/terminal-document.ts, Shell/App | sibling tests; terminal.spec.ts |
| Native/JS payload closure | package.mjs, package-checks.mjs, electron-builder.yml | terminal-runtime.test.ts; packaging.test.ts; extracted binaries |

## Key behaviors

- `REQ-FUNC-62710c49` — interactive workbench shells and user lifecycle.
- `REQ-SEC-c1ba6fbf` — explicit per-terminal agent-read consent.
- `REQ-SEC-17dac70f` — current ownership and publication revocation.
- `REQ-SEC-65cfbdc5` — filtered inherited environment and masked disclosure.
- `REQ-PLAT-72f8f627` — packaged x64 native runtime and helpers.
- `REQ-UX-269fabc4` — multiple user terminal tabs and configurable keyboard access.
- `REQ-PLAT-36fa33bf` — chat code blocks run once in a Constrained Language PowerShell terminal.

## Files

Paths abbreviated above are under `05_Software/src/apps/desktop/src/` or the named core/shared library.
`main/sessions.ts` composes a workbench-bound reader; core `tools/context.ts` and `agent/types.ts`
carry its capability and publication contract. Renderer `mocks/mockApi.ts` mirrors strict user IPC;
`components/workbench-tools.tsx` and four catalogs describe the optional agent tool. Shared/core index
exports expose their contracts. `02_Tools/build/generate-help-shortcuts.mjs` generates localized
shortcut guidance; `help/<language>/permissions.md` documents consent; `chat-and-sessions.md` links to it.
`02_Tools/environment/setup.py` checks Linux native build prerequisites; `prepare-windows-runtime.mjs`
supports separately pinned runtime caches. Native acceptance selects `VERA_TERM05_APP` and retains
receipts under `VERA_TERM05_EVIDENCE_DIR`; WSL2 does not establish native Ubuntu/clean-install acceptance.
