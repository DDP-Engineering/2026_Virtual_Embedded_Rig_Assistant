# ADR-0002: Model access through pi-ai

Date: 2026-10-09
Status: Accepted; implemented with deviations (see Implementation status)

## Context
VERA needs the OpenAI API with a key, OpenAI-compatible endpoints (Ollama, LM Studio, llama.cpp,
vLLM, corporate gateways), and ChatGPT-subscription sign-in; streaming with tool calls; token usage;
a pluggable credential store; and a scripted provider for deterministic tests.
`@earendil-works/pi-ai` 1.1.0 provides all of these: "Sign in with ChatGPT" on its OpenAI
provider, `createProvider()` with the OpenAI-completions API for custom endpoints, a `CredentialStore`
contract with locked OAuth refresh, and `fauxProvider()`. The reference code in `09_Others/benchpilot-reference/` uses it,
including the in-process ChatGPT sign-in with pi-ai's callback server on 127.0.0.1:1455.
Its dependency `@earendil-works/pi-telemetry` holds contracts only, with no exporter.

## Decision
VERA reaches every model through pi-ai, pinned exactly, wrapped in `src/libraries/core/src/llm/`. It keeps
two `Models` collections: **api** (OpenAI with a key, custom endpoints) and **subscription** (OpenAI
with the ChatGPT OAuth credential), because both use pi-ai's `openai` provider id with different
credentials. Session messages are persisted in pi-ai's message shape.

## Alternatives considered
- Vercel AI SDK: mature, but no ChatGPT-subscription sign-in.
- The official `openai` SDK plus an own OAuth implementation: VERA would maintain a sign-in flow
  that OpenAI may change at any time.
- LangChain.js: heavy, with abstractions that do not fit a single-user tool loop.

## Consequences
- pi-ai evolves fast (its 1.x line already moved from a global API to collections). Exact pins,
  one wrapper module and replay tests keep upgrades contained; each upgrade is its own work package.
- Persisting pi-ai's message shape couples stored sessions to it; a future change of library needs a
  message migration.
- The ChatGPT callback port 1455 is shared with the Codex CLI; VERA reports the conflict clearly.
- Anthropic, Azure OpenAI and other providers are small additions.
- The reference `llm/` module (`09_Others/benchpilot-reference/src/apps/server/src/llm/`) (gateway, providers, ChatGPT sign-in, credentials, replay) is the
  starting code.

## Implementation status (2026-11-01)
- pi-ai 1.1.0 pinned exactly (`src/libraries/core/package.json:29`), wrapped in
  `src/libraries/core/src/llm/` (`providers.ts`, `gateway.ts`, `replay.ts`, `chatgpt-catalog.ts`).
- Two collections as decided: `createCollections` returns **api** (OpenAI with a key, store-only
  auth) and **subscription** (OpenAI with the ChatGPT OAuth credential) (`llm/providers.ts:98-133`).
- Deviation: custom OpenAI-compatible endpoints (including the LM Studio profile) are not in the
  **api** collection; each request builds its own one-provider `Models` (`llm/providers.ts:31-64`,
  `283-286`).
- Deviation: the scripted test provider is VERA's own `ReplayGateway` (`llm/replay.ts:100`);
  pi-ai's `fauxProvider()` is not used.
- The wrapper is not the only importer: desktop main imports pi-ai for `registerBunOAuthFlows`
  (`src/apps/desktop/src/main/index.ts:5,69`) and in the instrumented `chatgpt-probe.ts`;
  `core/src/agent` and `core/src/sessions` import pi-ai message types.
- Messages are stored verbatim in pi-ai's shape (`messages.content_json`,
  `core/src/storage/schema.ts:17-19`); the port 1455 conflict is reported
  (`src/apps/desktop/src/main/chatgpt-auth.ts:187`). Addition: a live ChatGPT model list
  (`llm/providers.ts:183-230`).
- Open: Anthropic, Azure OpenAI and other providers are not added.
