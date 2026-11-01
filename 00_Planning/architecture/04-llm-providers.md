# 04 — LLM providers and credentials

Describes the implementation as of 2026-11-01 (master, 33e72b8 plus working tree). Written on
2026-10-09 as a plan and updated to the code; code paths are relative to `05_Software/src/`.

PURPOSE: specify how VERA reaches models — the OpenAI API, OpenAI-compatible custom endpoints
(including LM Studio with model discovery) and the ChatGPT subscription — plus model selection,
reasoning, connection tests, credentials, errors, timeouts and usage.
DONE-WHEN (for the work packages that implement it): each provider passes `providers.test` against
its real service in a manual smoke run (`--vera-smoke-provider <id>`, §4); automated model tests use
replay or a scripted loopback endpoint, never a real model (L11, 08 §3).

## 1. Providers in 1.0

| Provider id | UI label | Auth | Wiring | Models |
|---|---|---|---|---|
| `openai` | OpenAI | API key, required | pi-ai `openaiProvider()` in the **api** collection with store-only key auth (no `OPENAI_API_KEY` or OAuth fallback) | pi-ai built-in catalog; `GET /v1/models` only as the test's reachability probe |
| `chatgpt` | ChatGPT subscription | Sign in with ChatGPT (OAuth, §6) | pi-ai `openaiProvider()` OAuth in the **subscription** collection; Responses API at `https://api.openai.com/v1` | live account catalog (§3) |
| `custom:<slug>` | the name the user gives; presets LM Studio, Ollama, Other | optional API key | pi-ai `createProvider()` with `openAICompletionsApi()`, built per request | the configured model plus ids from `GET {baseUrl}/models`; LM Studio: discovered profiles (§2) |
| `replay` | none (test builds only, `VERA_REPLAY_DIR`) | none | `ReplayGateway` (`core/llm/replay.ts`), selected by provider id in main | one per `*.jsonl` scenario |

- A model reference is `<provider>/<model>` (`modelReferenceSchema`, `shared/src/providers.ts:10-14`).
  The gateway is `createPiAiGateway` (`core/llm/providers.ts:175`); main's `ProviderGateway`
  (`main/provider-gateway.ts`) owns its lifetime and adds discovery, catalogs and tests.
- Two pi-ai collections exist because the API-key provider and the subscription both use pi-ai's
  `openai` id; the subscription collection maps the stored credential `chatgpt` to that id
  (`core/llm/providers.ts:98-134`).
- Several custom endpoints may coexist (at most 100; names unique ignoring case, slugs unique).
  OpenAI can be added once.
- Settings › Providers shows two groups: "Subscriptions" (ChatGPT) and "API / local connections"
  (OpenAI and custom endpoints) with Add (preset OpenAI, LM Studio, Ollama or Other), Edit, Remove and
  Test (`renderer/components/providers.tsx`).
- The CLI (`apps/cli/src/run.ts`) supports `--provider replay|openai|custom`; the OpenAI key comes from
  `OPENAI_API_KEY`. The CLI has no ChatGPT sign-in.
- Azure OpenAI and Anthropic: Not implemented as of 2026-11-01 (post-1.0, ADR-0002).

## 2. Custom endpoints

| Field | Rule or default |
|---|---|
| `name` | required, at most 80 characters, unique ignoring case; the slug (NFKD, lower case, `[a-z0-9-]`) is derived on creation and kept on rename |
| `baseUrl` | required, `http(s)://host[:port]/…/v1`. Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`, llama.cpp `http://localhost:8080/v1` |
| `apiKey` | optional; kept in the credential store, never in settings; keyless servers receive the placeholder `not-needed` |
| `model` | required; the default model and the one the connection test uses |
| `contextWindow` | 32 768 |
| `maxOutputTokens` | 4 096; `contextWindow − maxOutputTokens − max(1024, ⌈5 % of window⌉)` must stay positive |
| `supportsTools` | recorded by `providers.test` when the saved default model is tested (`main/provider-gateway.ts:78-80`) |
| `protocol`, `models` | LM Studio only: `"lmstudio"` and one profile per model (below) |

Compatibility flags stay conservative: `supportsStore`, `supportsDeveloperRole` and
`supportsReasoningEffort` are false (plain `system` role, no `store`); cost is zero
(`core/llm/providers.ts:31-47`). LM Studio reasoning is the one exception (§9).

LM Studio (`providers.discover`, `main/provider-discovery.ts`): the editor reads
`GET {origin}/api/v1/models` (LM Studio's own REST API; 10 s, 2 MiB cap, redirects refused) and keeps
`llm` and `vlm` models with name, maximum and loaded context length, tool training and reasoning
options. The user chooses the default model and edits per-model context window (at most the loaded or
maximum length), output limit (default `min(4096, window / 4)`), default reasoning and temperature
(0–2). Chat then uses the OpenAI-compatible `/v1` route. A draft key is used for that one request; a
saved key is sent only to the saved origin.

## 3. Model selection

- Precedence: per-session override (composer model picker, `session.model.set`) → workbench default
  (`agent.model`, a text field in the workbench editor) → app default (`settings.defaultModel`)
  (`main/provider-gateway.ts:40-46`, `core/llm/gateway.ts:10-18`).
- The app default has no settings control. ChatGPT sign-in sets it to `chatgpt/<first catalog model>`
  when it is empty; sign-out clears it when it points at `chatgpt/` (`main/chatgpt-auth.ts:172-179`,
  `229-232`). Replay test builds default to `replay/<first scenario>`.
- The composer picker lists "Default model", the models of the configured OpenAI and custom providers
  and, while signed in, the ChatGPT models; it is disabled while a turn runs
  (`renderer/components/session/composer.tsx:62-87`, `213-241`).
- Switching models mid-session is allowed; pi-ai carries the context across providers.
- A model without tool support: `supportsTools` is recorded and reported, but the agent still offers
  its tools and the UI shows no warning. The "tools are off" warning is Not implemented as of
  2026-11-01.
- Before every request the agent calls `prepareModel` and `capabilities`
  (`core/agent/runtime.ts:161-163`), which return `contextWindow`, `maxOutputTokens`,
  `safetyMargin = max(1024, ⌈5 % of window⌉)` and `inputBudget = window − output − margin`; for
  `openai` the output is capped at `min(16 384, model maximum, window − margin − 1)`
  (`core/llm/providers.ts:67-97`). A model switch recomputes the budget; it never reuses the previous
  model's window. Invalid limits fail with `INVALID`.
- ChatGPT catalog: `GET https://api.openai.com/v1/models` with the OAuth token and, when known, the
  `ChatGPT-Account-ID` header; only `visibility: "list"` entries, with the account's context window and
  reasoning levels; cached up to 5 minutes (honouring `Cache-Control`) and refetched when the token
  changes (`core/llm/providers.ts:183-248`, `core/llm/chatgpt-catalog.ts`).

## 4. Connection test (`providers.test`)

Each step reports pass, fail or skipped (`core/llm/connection.ts`):
1. Reachability: `GET /models` with the key; 404, 405 or 501 count as skipped. For `openai` a missing
   key fails here; for `chatgpt` this step is the catalog fetch.
2. Authentication and model: "Reply with OK."; passes on non-empty text.
3. Tool calling: one request offering an `echo` tool; passes when the model calls it with exactly
   `{ text: string }`.
4. Streaming: asks for one sentence; passes when the text arrived in more than one provider delta.

Steps 2–4 request at most 256 output tokens; 3 and 4 are skipped when 2 fails. The UI has a Test
button per saved connection that opens a step list with localized errors; it is disabled while the
form holds unsaved edits (`renderer/components/provider-test.tsx`). The ChatGPT card has no Test
button. Smoke run: `--vera-smoke-provider <id>` prints the result and exits 0 when every step passes,
reachability may be skipped (`main/index.ts:697-717`).

## 5. Credentials

- Port `CredentialStore` (`core/src/ports.ts:42`), implemented by `CredentialFile`
  (`main/credentials.ts`) over `<userData>/credentials.json` (`schemaVersion: 1`, strict
  schema; another version or invalid content gives INVALID before decryption; entries
  `{ encoding, value (base64), weak }`); writes are atomic and serialized in one queue. It satisfies
  pi-ai's `read`, `list`, `modify`, `delete`.
- Credential ids: `openai`, `custom:<slug>`, `chatgpt`, `web:exa|tavily|brave` (§11).
- Secure storage means `safeStorage.isEncryptionAvailable()` and not Linux `basic_text`. Without it,
  saving a key returns `consent-required` and a dialog asks: yes stores it marked weak (shown as "Saved
  without secure encryption"; base64 plain text when encryption is unavailable); no keeps it in memory
  for this run ("Available only for this run"). Refreshed ChatGPT tokens keep the account's choice
  (`main/subscription-store.ts`).
- The renderer sees `{ configured, hint: "sk-…a1B2", storage: encrypted | unprotected | memory }`,
  never a value (L7); the hint is the first 3 and last 4 characters, none for keys of 7 characters or
  fewer (`main/provider-settings.ts:129-135`). Settings reject secret-like field names
  (`shared/src/providers.ts:95-104`).
- Save and Remove change key and configuration together and roll the key back on failure
  (`checkpoint`, `main/credentials.ts`).
- `core/llm/scrub.ts` replaces every registered secret, and its JSON-escaped form, with `[REDACTED]`.
  Stored, submitted, refreshed and pasted secrets register with the logger; streamed text and tool
  deltas pass `core/llm/stream-scrub.ts`, so a secret split across deltas is still caught; app events
  are scrubbed before they reach the renderer (`main/index.ts:109-112`).

## 6. ChatGPT subscription sign-in

Implementation: `main/chatgpt-auth.ts`; UI `renderer/components/chatgpt.tsx`.

```
providers.chatgpt.login { storageConsent? }
  → state "consent-required" when storage is not secure and no choice was given
  → subscription.login("openai", "oauth", { signal, notify, prompt }, { agentName: "VERA", getDeviceId })
  → notify auth_url → confirmed openExternal: the system browser opens the sign-in page
  → pi-ai's callback server on 127.0.0.1:1455 receives the redirect → credential `chatgpt` stored
  → prompt manual_code (fallback) → state "manual" + promptId; the UI shows a paste box for the redirect URL
providers.chatgpt.login { manualCode, promptId } → completes that prompt
providers.chatgpt.cancel → abort; waits for the provider so port 1455 is freed
providers.chatgpt.status → { connected, expiresAt?, state: idle|pending|manual|error|consent-required, promptId?, error? }
providers.chatgpt.logout → cancel, delete the credential, clear a `chatgpt/` app default
```

- Timeout 10 minutes (`chatgpt.timeout`). A busy port 1455 (`EADDRINUSE`) gives `chatgpt.portBusy`,
  which names an unfinished Codex CLI sign-in as the likely cause; a browser failure gives
  `chatgpt.browserFailed`; anything else `chatgpt.loginFailed`.
- `getDeviceId` returns `settings.installationId`. pi-ai refreshes tokens itself; the UI shows the
  expiry with "renews automatically"; the ChatGPT card and the composer poll the status every second.

## 7. Errors

`mapProviderError` (`core/llm/errors.ts`):

| Condition | `VeraError.code` | UI (`en`) |
|---|---|---|
| No network, DNS failure, refused connection | `OFFLINE` (`errors.OFFLINE`, `endpoint`) | "Cannot reach {endpoint}. Retry."; the transcript offers Retry |
| 401 or 403, or no stored key | `PROVIDER` (`auth`) | text points to Providers settings; no link |
| 429 | `PROVIDER` (`rate_limit`) | the `retry-after` value when given |
| Provider rejects context size despite preflight (status body or message matches context/token limit) | `PROVIDER` (`context`) | explains the limit; suggests reducing input or checking the configured window |
| Any other provider error | `PROVIDER` (`provider.failure`) | the scrubbed provider message |

- Requests may go only to the provider endpoint's origin (otherwise `DENIED`); redirects are refused.
- A provider error ends the turn with `turn.done { stopReason: "error" }`; the session stays usable.
  Local preflight exhaustion is handled before any provider request: `CONTEXT_LIMIT`, message key
  `context.budget_exceeded`, and `turn.done { stopReason: "limit" }` (03 §2;
  `core/agent/runtime.ts:238-249`). It is distinct from a provider failure. There is no automatic retry
  with the same oversized request.

## 8. Usage

pi-ai reports token usage per response. VERA emits `usage.updated` with input and output tokens, the
context estimate, input budget, reserved output, window, safety margin, compaction status and
request-view tokens (03 §2, §8); estimated counts are labelled and do not overwrite actual provider
usage. The UI shows a context-percentage gauge in the composer and the counts with the model in the
Context window dialog (06 §3); there is no session footer. Money cost: Not implemented as of
2026-11-01 (no cost display; custom and replay models report zero cost).

## 9. Reasoning

- Options come from the model: ChatGPT catalog `supported_reasoning_levels` (without `ultra`); LM Studio
  `capabilities.reasoning.allowed_options` and its default. `openai` API-key models and plain custom
  endpoints offer none.
- The composer shows a reasoning picker only when the selected model has options
  (`renderer/components/session/reasoning-picker.tsx`); `session.reasoning.get` / `.set` keep the choice
  per session. "Default" leaves the level to the server or to the LM Studio profile. A stored level
  the new model does not support is dropped (`core/sessions/service.ts:439-456`); in a session request
  it is ignored, outside a session it is `INVALID`.
- Wire format: Completions API `reasoning_effort`, Responses API `reasoning.effort`
  (`core/llm/providers.ts:445-484`). LM Studio maps `off` to `none` and `on` to the model's default or
  `medium`. ChatGPT models map `off` to no effort, so the server chooses by default.

## 10. Timeouts and limits

| What | Value |
|---|---|
| Model request | pi-ai `timeoutMs: 30000` (HTTP request timeout), `maxRetries: 0`, SSE transport |
| `GET /models` (custom list, OpenAI probe) | 30 s; at most 10 000 ids |
| ChatGPT catalog | 30 s; cached at most 5 minutes |
| LM Studio discovery | 10 s; 2 MiB |
| ChatGPT sign-in | 10 minutes |
| Connection test | at most 256 output tokens per step |

## 11. Web access providers (reference)

Settings › Web access, separate from Providers: on/off, provider Exa (default, anonymous), Tavily
(anonymous or key) or Brave Search (key required, search only), authentication anonymous or API key,
key entry with the storage consent of §5, Test with cancel, Remove key (`shared/src/web-access.ts`,
`main/web-access.ts`, `renderer/components/web-access.tsx`). Keys use the credential ids
`web:<provider>`. Tool behaviour and egress: 03 (web tools contract) and 01 §8.

NOTES:
- Replay scripts and test switches: 08 §3. `ReplayGateway` reads one scenario per `*.jsonl` in
  `VERA_REPLAY_DIR`; model `replay/<name>`, or `replay/auto` matching the first line's `match` regex;
  fixed 32 768 window and 4 096 output, tools supported; text streams in 40-character chunks.
- The starting code in `09_Others/benchpilot-reference/apps/server/src/llm/` (`providers.ts`,
  `credentials.ts`, `oauth.ts`) is superseded by the files named above.
- Work packages cite this file as `04 §n`.
