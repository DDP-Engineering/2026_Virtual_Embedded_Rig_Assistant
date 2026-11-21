# DeepSeek, Moonshot AI and Kimi For Coding protocol bindings

## Routes and key ownership

| Preset | Catalog | Exact inference POST | API key header |
|---|---|---|---|
| DeepSeek | https://api.deepseek.com/models | https://api.deepseek.com/chat/completions | Authorization: Bearer |
| Moonshot AI | https://api.moonshot.ai/v1/models | https://api.moonshot.ai/v1/chat/completions | Authorization: Bearer |
| Kimi For Coding | Explicit model entry | https://api.kimi.ai/coding/v1/messages?beta=true | x-api-key |

The pinned Anthropic adapter uses the Messages SDK's beta resource. The Kimi request identifies
VERA in User-Agent. Core denies inference outside the registered POST, refuses redirects on both
transports and resolves only the connection's credential slot. Catalog discovery can use the
editor's draft key for the selected service. Account entitlements are established by the service.
A successful listing governs unsaved choices, including when the list is empty. A saved model
remains selectable and documented examples remain available when listing is unavailable.

DeepSeek's catalog supplies model name, text/image input, context, output ceiling and compatible
effort levels when published. Moonshot's catalog supplies text/image input and context when
published. Its reasoning flag enables native transcript handling. An effort selector requires
documented levels. An explicit false reasoning flag means reasoning is unavailable. Sparse entries leave missing metadata unverified. A successful Kimi Code
probe for a manually entered ID without an exact VERA profile leaves tool support unverified
because the service can answer on a fallback model.

## Reasoning and tool continuation

DeepSeek uses the thinking object to enable or disable thinking and reasoning_effort for low,
high and max. Moonshot Kimi K3 is always thinking and uses reasoning_effort for the same levels.
The Chat Completions adapter returns assistant reasoning_content and the tool call, then sends
them back with the matching tool_call_id on the tool response. An unset effort preserves the
service default.

Known Kimi Code models use adaptive Messages thinking and output_config.effort. The assistant's
thinking and tool_use blocks precede the user tool_result with the matching tool_use_id. The
pinned kimi-for-coding profile accepts an empty thinking signature. VERA leaves effort unset
unless selected. It offers text and image input according to each exact model profile.

Sources: [DeepSeek models](https://api-docs.deepseek.com/api/list-models/),
[DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/),
[Moonshot model list](https://platform.kimi.ai/docs/api/list-models),
[Moonshot K3](https://platform.kimi.ai/docs/guide/kimi-k3-quickstart),
[Kimi Code models](https://www.kimi.com/code/docs/en/kimi-code/models) and
[Kimi Code Messages configuration](https://www.kimi.com/code/docs/en/third-party-tools/claude-code).
The pinned pi-ai 1.1.0 metadata and adapter code supply compatibility details.
