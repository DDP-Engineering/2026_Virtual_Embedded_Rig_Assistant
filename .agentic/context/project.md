# Project profile

## Purpose and users

VERA is the Virtual Embedded Rig Assistant desktop product for embedded engineering work. Product scope and users are defined by [planning](../../00_Planning/plan/README.md).

## Product responsibilities

The software root contains four ESM workspaces and strict TypeScript tooling with import-boundary regression tests. Desktop main owns the hardened Electron shell, confined local asset protocol, window geometry and validated IPC dispatch. Shared supplies zod channel/error/event schemas; sandboxed preload exposes window.vera invoke/subscribe. React provides Welcome/App Settings and responsive panels through the API and TanStack Query, with persisted theme/text scale, en/ro/de i18next presentation and browser mock mode. Core owns versioned settings through host ports; main provides portable paths, atomic filesystem and redacting logs. CLI provides its source skeleton.

## Supported operation

The target platforms are Windows x64 and Linux x64 (01-system section 9).

## Established constraints

The architecture laws in [01-system](../../00_Planning/architecture/01-system.md) govern process boundaries, local assets, credentials and test isolation. Versions are pinned exactly. Core remains independent of Electron; renderer access to main uses shared contracts.

## Implementation orientation

[05_Software/README.md](../../05_Software/README.md) routes setup and source layout. [AGENTS.md](../../AGENTS.md) governs master implementation, local commits and AEGIS scope.

[Desktop shell](../knowledge/desktop-shell.md) routes window/security/state changes. [Software tooling](../knowledge/software-tooling.md) routes workspaces, compilation and verification.

[IPC boundary](../knowledge/ipc-boundary.md) routes channels, errors, events, subscriptions and API/mock metadata.

[Application data](../knowledge/app-data.md) routes settings, migrations, portable locations, atomic saves and redacting logs.

[Renderer foundation](../knowledge/renderer-foundation.md) routes UI layout, appearance, language and accessibility.

## Authoritative references

- [System architecture](../../00_Planning/architecture/01-system.md)
- [Foundation packages](../../00_Planning/plan/M0-foundation.md)
- [Quality](../../00_Planning/architecture/08-quality.md)
