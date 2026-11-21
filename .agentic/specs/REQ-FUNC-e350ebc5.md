# Hosted inference catalog and transport

| Preset | Chat Completions base | Catalog and metadata |
|---|---|---|
| Fireworks AI | `https://api.fireworks.ai/inference/v1` | `https://api.fireworks.ai/v1/accounts/fireworks/models`. The native `models` envelope exposes resource names, text-chat evidence, serverless availability, context length and tool and image flags. Read bounded pages using `pageSize` and `pageToken` on the fixed URL. Require serverless availability and evidence of chat through its conversation configuration, a tools flag or an exact documented profile. Explicit deployment IDs can be entered manually. |
| Together AI | `https://api.together.ai/v1` | `GET /v1/models`, using the native model array or the OpenAI list envelope. Only explicitly chat-typed entries or entries with no type are candidates. Use `display_name` and `context_length` where valid. The authenticated listing does not establish tools or modalities. |
| Groq | `https://api.groq.com/openai/v1` | `GET /openai/v1/models`, with OpenAI-style `data`. Exclude inactive and known audio or moderation-only entries. Use valid `context_window` and `max_completion_tokens`. Individual model documentation establishes tool use and input capabilities. |
| Cerebras | `https://api.cerebras.ai/v1` | Authenticated `GET /v1/models` returns OpenAI-style `data`. Supplement capabilities from exact documented model profiles. Limits vary by account tier and deployment. Use the configured limits for this catalog. |

Store bearer keys in the existing bound credential slot. Requests to the catalog and completion routes refuse redirects.
Preserve complete case-sensitive IDs. Valid live fields take precedence over the corresponding documented profile fields.
Unknown tool and input capabilities stay unverified. Catalog shape or identity errors return the typed failure. Unsupported listings and empty usable lists retain manual entry. Bad optional capability fields contribute no metadata.
HTTP 401 and 403 report authentication failure. HTTP 429 uses the shared rate limit diagnostic and preserves a supplied retry delay.
Cancellation propagates through the existing gateway to both request types.

## Evidence

- OBSERVED Fireworks [quickstart](https://docs.fireworks.ai/getting-started/quickstart), [catalog schema](https://docs.fireworks.ai/api-reference/list-models), [text inference and deployment IDs](https://docs.fireworks.ai/guides/querying-text-models) [chat schema](https://docs.fireworks.ai/api-reference/post-chatcompletions) and [GLM 5.3 Flash capability page](https://fireworks.ai/models/fireworks/glm-5p3-flash).
- OBSERVED Together [OpenAI compatibility](https://docs.together.ai/docs/inference/openai-compatibility), [chat reference](https://docs.together.ai/reference/chat-completions), [serverless model tables](https://docs.together.ai/docs/serverless/models) [reasoning and continuation fields](https://docs.together.ai/docs/inference/chat/reasoning#handle-reasoning-tokens) and its Python SDK [list method](https://github.com/togethercomputer/together-python/blob/v1.5.35/src/together/resources/models.py) and [model type](https://github.com/togethercomputer/together-python/blob/v1.5.35/src/together/types/models.py).
- OBSERVED Groq [API reference](https://console.groq.com/docs/api-reference), [model list](https://console.groq.com/docs/models), [local tool use](https://console.groq.com/docs/tool-use/overview) and [vision](https://console.groq.com/docs/vision).
- OBSERVED Cerebras [authenticated list](https://inference-docs.cerebras.ai/api-reference/models/list-models), [chat reference](https://inference-docs.cerebras.ai/api-reference/chat-completions), [public model schema](https://inference-docs.cerebras.ai/api-reference/models/public-models) [tool use](https://inference-docs.cerebras.ai/capabilities/tool-use) [reasoning and tool continuation guide](https://inference-docs.cerebras.ai/capabilities/reasoning) and the published tier-dependent limits for [GPT-OSS](https://inference-docs.cerebras.ai/models/openai-oss) and [Qwen 3.8](https://inference-docs.cerebras.ai/models/qwen-3.8-27b).
- OBSERVED Installed pi-ai 1.1.0 supplies OpenAI Completions adapters and service-specific model IDs in `dist/providers/data/{fireworks,together,groq,cerebras}.json`. Its Fireworks provider-wide base also serves Anthropic Messages. Use the Chat Completions model base ending in `/inference/v1`.
- UNKNOWN Account access, actual service behavior and model entitlements under RULING-001.
