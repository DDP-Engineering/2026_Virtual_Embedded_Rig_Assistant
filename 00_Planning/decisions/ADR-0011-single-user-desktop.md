# ADR-0011: Single-user desktop app without accounts or roles

Date: 2026-10-09
Status: Accepted; implemented (see Implementation status for `bypass` and local listeners)

## Context
A networked lab appliance needs users, roles, API tokens and sessions. VERA runs on one engineer's
computer under their OS account, opens no listening service (L6) and has no network management.

## Decision
VERA has no user accounts, roles, app login or access tokens. The OS account is the security
boundary. Two protections remain because they defend against the agent, not against other people:
human approval of edits (ADR-0007), and encrypted storage of provider credentials (04 §5).

## Alternatives considered
- Local accounts or a PIN lock: no threat they would stop that the OS account does not already stop.

## Consequences
- No identity, session or permission code in 1.0.
- A shared lab PC needs one OS account per engineer for separated credentials and settings.

## Implementation status (2026-11-01)
- No accounts, roles, app login or access tokens exist; ChatGPT sign-in is provider auth only.
- Credentials are encrypted with Electron `safeStorage` (`src/apps/desktop/src/main/credentials.ts`).
  When OS encryption is unavailable (Linux `basic_text`), a key is stored unprotected only with the
  user's explicit consent, or else kept in memory for the session (`credentials.ts:62-63,198`).
- Edit approval holds in `ask` and `auto-edit`. The user-selected `bypass` mode grants every approval
  by mode (see ADR-0007).
- L6 has exceptions: local, temporary listeners. pi-ai's ChatGPT callback listens on `127.0.0.1:1455`
  during sign-in. Each `web_download` opens a CONNECT tunnel on an ephemeral `127.0.0.1` port
  (`src/apps/desktop/src/main/download-transfer.ts:57`). The workbench guard listens on a named pipe or
  abstract socket, not TCP (`src/libraries/core/src/workbench/guard.ts:15`).
