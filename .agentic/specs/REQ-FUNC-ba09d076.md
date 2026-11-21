# International MiniMax and Z.AI connections

## Routes and credential source

| Preset | POST path | Authentication and key source | Documented model choices |
|---|---|---|---|
| MiniMax API | `https://api.minimax.io/anthropic/v1/messages` | `x-api-key`, MiniMax pay-as-you-go API key | `MiniMax-M3.1-Flash`, `MiniMax-M3` |
| MiniMax M Plan | `https://api.minimax.io/anthropic/v1/messages` | `x-api-key`, MiniMax subscription key | `MiniMax-M3.1-Flash` |
| Z.AI API | `https://api.z.ai/api/paas/v4/chat/completions` | Bearer, Z.AI Standard API Key | `glm-5.3`, `glm-5.3-flash` |
| Z.AI GLM Coding Plan | `https://api.z.ai/api/coding/paas/v4/chat/completions` | Bearer, Z.AI Personal Coding Plan or Team Plan key | `glm-5.3`, `glm-5.3-flash` |

Every connection uses one explicit model or one of its documented profiles. Account eligibility can vary. VERA checks the documented MiniMax `sk-api-` or `sk-cp-` key prefix before saving the credential and again before sending a request. The key source chosen by the user controls provider billing, and Z.AI additionally documents endpoint-specific billing for some keys. Saved configurations bind the key slot to the preset ID, international binding, protocol and route. Failed requests cannot try another slot or route.

MiniMax M3.1 Flash accepts five effort values in `output_config.effort` and always uses reasoning. MiniMax M3 supports off and adaptive thinking. The adapter keeps the signed thinking block before `tool_use` and returns the matching `tool_result`. Z.AI GLM-5.3 and GLM-5.3-Flash require thinking and accept low, high or max effort. The two routes use `max_tokens`, preserved thinking with `clear_thinking: false`, and `tool_stream: true` when tools are provided. Continuations send the returned `reasoning_content`, original tool call and matching tool result.

Z.AI limits Coding Plan use to the tools in its published list. VERA shows that restriction in the preset editor and help. VERA does not present itself as another client. All scripted requests disable redirects and SDK retries. The test suite exercises local fixtures only.

## Service references

- [MiniMax pay-as-you-go and subscription setup](https://platform.minimax.io/docs/guides/quickstart-preparation)
- [MiniMax Messages protocol](https://platform.minimax.io/docs/api-reference/text-chat-anthropic)
- [MiniMax interleaved thinking and tool calls](https://platform.minimax.io/docs/guides/text-m3-function-call)
- [MiniMax M Plan quickstart](https://platform.minimax.io/docs/m-plan/quickstart)
- [MiniMax API and M Plan key prefixes](https://platform.minimax.io/docs/m-plan/minimax-cli)
- [Z.AI key management and billing](https://docs.z.ai/devpack/notice/api-key-management)
- [Z.AI GLM Coding Plan setup](https://docs.z.ai/devpack/quick-start)
- [Z.AI Coding Plan tool eligibility](https://docs.z.ai/devpack/tool/others#supported-tools)
- [Z.AI preserved thinking](https://docs.z.ai/guides/capabilities/thinking-mode)
- [GLM-5.3 model](https://docs.z.ai/guides/llm/glm-5.3)
- [GLM-5.3-Flash model](https://docs.z.ai/guides/vlm/glm-5.3-flash)
