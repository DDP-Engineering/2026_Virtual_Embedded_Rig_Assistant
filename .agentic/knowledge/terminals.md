# User terminals

## Routing

Select for right-panel Terminal, xterm/FitAddon, node-pty, interactive user input, terminal_read,
per-terminal consent, PTY lifecycle and packaged native helpers. Start at
`05_Software/src/apps/desktop/src/main/terminals.ts`; focused tests are its sibling test,
core `tools/terminal-read.test.ts`, shared `terminal-ipc.test.ts`, renderer `terminal-tab.test.ts`
and `tests/e2e/terminal.spec.ts`. Agent shell commands belong to [plugins](plugins.md);
general artifact construction belongs to [native packaging](native-packaging.md).

## Purpose and boundaries

Desktop TerminalService owns ephemeral user shells independently of agent sessions and ProgramRunner.
Core receives only TerminalReader; native loading, input, resize, consent and close remain in desktop
main. Renderer owns the xterm view and controls through strict user IPC. Shells use OS-account rights.

## Public interface

- `terminal.list/create/output/input/resize/close/consent` require the current workbench ID; targets
  use UUID terminal IDs. Create fixes cwd to the workbench and selects Settings → Commands' shell.
- Up to eight live/finished terminal tabs remain until close, workbench replacement or app shutdown.
  Bash uses `-il`, sh `-i`, PowerShell `-NoLogo`; agent command flags and closed stdin are separate.
- Host capture retains at most 262144 raw characters, dropping a cut leading line. User snapshots follow the live Program runs choice, default off. With masking on,
  current known credentials are masked and split secret prefixes are held. The renderer appends
  snapshot deltas and reconstructs a bounded view when truncation or masking changes the prefix.
  Plain projection keeps incomplete VT sequences pending so partial CSI/OSC/DCS cannot bypass
  known-secret prefix holding between callbacks.
- Agent recent output follows the live Agent and model choice independently of user runs masking.
  Publication rechecks the leases, refreshes bounded recent output and masks the complete captured
  window before taking the tail when on, preserving split-secret and partial VT prefix holding.
  Off uses the bounded clean OutputDecoder projection; raw authority stays in main. Finished user snapshots also
  resolve the live choice on every poll.
- `terminal_read {terminalId?}` lists only shared terminals when omitted; an ID returns at most
  12000 recent plain characters. Consent starts false and applies to one terminal in its workbench.
- Grant epochs and current ownership are checked again by the runtime's synchronous publication hook.
  Revocation/close/switch refuses unpublished captures; already shared results remain in transcript history.
  Serialized JSON truncation retains the registry's `truncated:true` marker alongside lease checks.
- Ctrl+Shift+T opens/focuses Terminal and is editable in Keyboard shortcuts. Terminal input captures
  keys for the shell. Interface/help/release notes have en/ro/de/fr entries.

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

## Files

Paths abbreviated above are under `05_Software/src/apps/desktop/src/` or the named core/shared library.
`main/sessions.ts` composes a workbench-bound reader; core `tools/context.ts` and `agent/types.ts`
carry its capability and publication contract. Renderer `mocks/mockApi.ts` mirrors strict user IPC;
`components/workbench-tools.tsx` and four catalogs describe the optional agent tool. Shared/core index
exports expose their contracts. `02_Tools/build/generate-help-shortcuts.mjs` generates localized
shortcut guidance; `help/<language>/{chat-and-sessions,permissions,shortcuts}.md` documents consent.
`02_Tools/environment/setup.py` checks Linux native build prerequisites; `prepare-windows-runtime.mjs`
supports separately pinned runtime caches. Native acceptance selects `VERA_TERM05_APP` and retains
receipts under `VERA_TERM05_EVIDENCE_DIR`; WSL2 does not establish native Ubuntu/clean-install acceptance.
