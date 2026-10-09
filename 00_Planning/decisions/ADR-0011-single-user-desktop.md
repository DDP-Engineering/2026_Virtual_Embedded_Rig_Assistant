# ADR-0011: Single-user desktop app without accounts or roles

Date: 2026-10-09
Status: Accepted

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
