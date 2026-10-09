# 04 — LLM providers and credentials

PURPOSE: specify how VERA reaches models — the OpenAI API, OpenAI-compatible custom endpoints and the
ChatGPT subscription — plus model selection, connection tests, credentials, errors and usage.
DONE-WHEN (for the work packages that implement it): each provider passes `providers.test` against
its real service in a manual smoke run, and the replay provider drives every automated test (L11).

## 1. Providers in 1.0

| Provider id | UI label | Auth | Wiring | Models |
|---|---|---|---|---|
| `openai` | OpenAI API | API key | pi-ai `openaiProvider()` in the **api** collection | pi-ai catalog |
| `chatgpt` | ChatGPT subscription | Sign in with ChatGPT (OAuth) | pi-ai `openaiProvider()` in the **subscription** collection with the OAuth credential | pi-ai catalog, models the subscription allows |
| `custom:<slug>` | the name the user gives | optional API key | pi-ai `createProvider()` with `openAICompletionsApi()` | configured, or listed from `GET /models` |
| `replay` | none (test builds only) | none | VERA's `LlmGateway` replay implementation (08 §3) | scripted |

- Two pi-ai collections are needed because the API-key provider and the subscription both use pi-ai's
  `openai` provider id with different credentials. BenchPilot validated this arrangement; its
  `llm/providers.ts` is the starting code.
- Several custom endpoints may coexist, for example Ollama and LM Studio.
- Azure OpenAI (pi-ai's Azure Responses provider) and Anthropic are small additions after 1.0.

## 2. Custom endpoints

| Field | Rule or default |
|---|---|
| `name` | required, unique; the slug is derived from it |
| `baseUrl` | required, `http(s)://host[:port]/v1`. Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`, llama.cpp `http://localhost:8080/v1` |
| `apiKey` | optional; keyless servers receive a placeholder value |
| `model` | required |
| `contextWindow` | 32 768 |
| `maxOutputTokens` | 4 096 |
| `supportsTools` | set by the connection test (§4) |

Compatibility flags stay conservative: plain `system` role, no `store`, no `reasoning_effort`.

## 3. Model selection

- Precedence: per-session override (composer) → workbench default (`agent.model`) → app default.
- Switching models mid-session is allowed; pi-ai carries the context across providers.
- A model without tool support can chat; the UI warns that tools are off for it.

## 4. Connection test (`providers.test`)

Each step reports pass, fail or skipped:
1. Reachability: `GET /models` (skipped when the server does not offer it).
2. Authentication and model: a one-line completion, "Reply with OK".
3. Tool calling: one request offering an `echo` tool; passes when the model calls it.
4. Streaming: the answer arrived in more than one delta.

## 5. Credentials

- Port `CredentialStore` (`packages/core/src/ports.ts`), implemented in
  `apps/desktop/src/main/credentials.ts` over `<userData>/credentials.json`; every secret value is
  encrypted with `safeStorage.encryptString`. BenchPilot's `llm/credentials.ts` is the starting code.
- It satisfies pi-ai's `CredentialStore` contract (`read`, `list`, `modify`, `delete`). `modify` runs
  under a mutex because OAuth refresh writes through it.
- If `safeStorage.isEncryptionAvailable()` is false, or Linux reports the `basic_text` backend, VERA
  asks before storing secrets; on refusal it keeps them in memory for the running session only.
- The renderer sees `{ configured: true, hint: "sk-…a1B2" }`, never a value (L7).
- `core/llm/scrub.ts` removes every known key and token from error text before it reaches events,
  logs or the database.

## 6. ChatGPT subscription sign-in

Starting code: BenchPilot's `llm/oauth.ts` (in-process sign-in through pi-ai's callback server).

```
providers.chatgpt.login
  → subscription.login("openai", "oauth", { signal, notify, prompt }, { agentName: "VERA", getDeviceId })
  → notify auth_url  → app.openExternal(url): the system browser opens the sign-in page
  → pi-ai's callback server on 127.0.0.1:1455 receives the redirect → credential stored
  → prompt manual_code (fallback) → the UI shows a paste box for the redirect URL
providers.chatgpt.cancel → abort; frees port 1455
providers.chatgpt.status → { connected, expiresAt }; pi-ai refreshes tokens itself
providers.chatgpt.logout → delete the credential
```

- Timeout 10 minutes. If port 1455 is busy, the error names the likely cause: another sign-in in
  progress, often the Codex CLI.
- `getDeviceId` returns the installation id from settings.

## 7. Errors

| Condition | `VeraError.code` | UI |
|---|---|---|
| No network, DNS failure, refused connection | `OFFLINE` | "Cannot reach {endpoint}" with Retry |
| 401 or 403 | `PROVIDER` (`auth`) | link to the provider settings |
| 429 | `PROVIDER` (`rate_limit`) | the retry-after time when given |
| Context too long | `PROVIDER` (`context`) | suggests a new session until compaction (M5) |
| Any other provider error | `PROVIDER` | the scrubbed provider message |

A provider error ends the turn with `turn.done { stopReason: "error" }`; the session stays usable.

## 8. Usage

pi-ai reports token usage per response. VERA emits `usage.updated` and shows input, output and
context tokens in the session footer. Money cost is shown for the `openai` provider only.

NOTES:
- Replay scripts and test switches: 08 §3.
- Work packages cite this file as `04 §n`.
