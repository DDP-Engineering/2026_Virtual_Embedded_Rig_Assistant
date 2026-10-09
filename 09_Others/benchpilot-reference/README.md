# BenchPilot reference code

A snapshot, taken on 2026-10-09, of the parts of **BenchPilot** that VERA reuses. BenchPilot was an
earlier proof of concept on the same stack (TypeScript, pi-ai 1.1.0, React 19, Vite, Tailwind CSS v4,
shadcn/ui, TanStack Query, better-sqlite3, zod): an agent copilot for network-device testbenches
with sessions, tools, skills, an approval gate, a replay provider and evidence citations.

This folder is **reference material only**. It is not built, tested, linted or imported. The work
packages in `00_Planning/plan/` name the files here that each VERA module starts from; the map is
[`00_Planning/plan/benchpilot-reuse.md`](../../00_Planning/plan/benchpilot-reuse.md). Copy a file
into `05_Software/`, then adapt it there; never import from this folder.

The layout mirrors the original repository:

| Folder | Content |
|---|---|
| `apps/server/src/` | agent loop, sessions and event hub, LLM gateway with providers, ChatGPT sign-in, credentials and the replay provider, tool registry, citations, skills and testbench loading, database |
| `apps/server/fixtures/replay/` | example replay scripts (one model step per line) |
| `packages/shared/src/` | event union, session reducer, evidence references, API types |
| `apps/web/src/` | API boundary with the mock implementation, session event subscription, session and settings components, shadcn/ui set |
| `scripts/` | packaging checks, packaged smoke, browser smoke, Windows Sandbox configuration |
| `skills/` | seven `SKILL.md` examples |

Domain words differ from VERA's: testbench → workbench, `TESTBENCH.md` → `WORKBENCH.md`, `ev:`
evidence references → VERA references. Imports such as `@benchpilot/shared` refer to the original
workspace. Once the code a work package needed has been ported, the corresponding files here can be
deleted.
